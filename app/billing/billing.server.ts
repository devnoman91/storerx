/**
 * Shopify billing and plan usage.
 *
 * Shopify is the source of truth for what a merchant pays for. The Shop row
 * mirrors it (plan, subscriptionId, subscriptionStatus) so the dashboard and
 * worker can enforce limits without an API call; it is kept current by the
 * app_subscriptions/update webhook and re-synced from billing.check whenever
 * the Billing page loads.
 */

import type { Shop } from "@prisma/client";
import prisma from "../db.server";
import {
  PLANS,
  SHOPIFY_PLAN_NAMES,
  currentPeriodStart,
  EXPLAIN_TASK,
  isBillingUnavailableError,
  nextPeriodStart,
  planOf,
  scanAllowance,
  scanLimitMessage,
  startsNewPeriod,
  stateFromActiveSubscriptions,
  type Allowance,
  type PaidPlanKey,
  type PeriodUsage,
  type PlanSpec,
  type ShopBillingState,
} from "./plans";

type BillingShop = Pick<Shop, "id" | "plan" | "subscriptionId" | "subscriptionStatus" | "billingCycleStart" | "createdAt">;

/** The subset of the admin context billing needs. */
interface AdminBillingContext {
  admin: { graphql: (query: string) => Promise<Response> };
  billing: {
    check: (options: { isTest?: boolean }) => Promise<{
      appSubscriptions: Array<{ id: string; name: string; status: string; test: boolean; trialDays: number; currentPeriodEnd: string }>;
    }>;
    request: (options: { plan: string; isTest?: boolean; returnUrl?: string }) => Promise<never>;
    cancel: (options: { subscriptionId: string; isTest?: boolean; prorate?: boolean }) => Promise<unknown>;
  };
}

const SHOP_PLAN_QUERY = `#graphql
  query BillingShopPlan {
    shop {
      plan {
        partnerDevelopment
      }
    }
  }
`;

/**
 * Development stores cannot be charged, so their subscriptions must be test
 * charges (approved without payment). SHOPIFY_BILLING_TEST=true forces test
 * charges everywhere, for staging.
 */
export async function isTestBilling(admin: AdminBillingContext["admin"]): Promise<boolean> {
  if (process.env.SHOPIFY_BILLING_TEST === "true") return true;
  try {
    const response = await admin.graphql(SHOP_PLAN_QUERY);
    const body = (await response.json()) as { data?: { shop?: { plan?: { partnerDevelopment?: boolean } } } };
    return Boolean(body.data?.shop?.plan?.partnerDevelopment);
  } catch (error) {
    // Failing towards a real charge would make approval impossible on a dev
    // store; failing towards a test charge would give a real store a free plan.
    // Neither is safe to guess, so surface the error.
    throw new Error(`Could not read the store plan to set up billing: ${(error as Error).message}`);
  }
}

export function billingState(shop: Pick<Shop, "plan" | "subscriptionId" | "subscriptionStatus">): ShopBillingState {
  return {
    plan: planOf(shop.plan).key,
    subscriptionId: shop.subscriptionId,
    subscriptionStatus: shop.subscriptionStatus,
  };
}

/** Persist a billing change, starting a fresh usage period when the plan changed. */
export async function saveBillingState(shop: BillingShop, next: ShopBillingState): Promise<void> {
  const before = billingState(shop);
  const unchanged =
    before.plan === next.plan &&
    before.subscriptionId === next.subscriptionId &&
    before.subscriptionStatus === next.subscriptionStatus;
  if (unchanged) return;

  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      plan: next.plan,
      subscriptionId: next.subscriptionId,
      subscriptionStatus: next.subscriptionStatus,
      ...(startsNewPeriod(before, next) ? { billingCycleStart: new Date() } : {}),
    },
  });
}

export interface SubscriptionDetails {
  name: string;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
}

export type SyncResult =
  | { available: true; state: ShopBillingState; subscription: SubscriptionDetails | null }
  | { available: false };

/** Re-read the shop's subscription from Shopify and store it. */
export async function syncSubscription(
  shop: BillingShop,
  context: AdminBillingContext,
  isTest: boolean,
): Promise<SyncResult> {
  let subscriptions;
  try {
    ({ appSubscriptions: subscriptions } = await context.billing.check({ isTest }));
  } catch (error) {
    if (isBillingUnavailableError(error)) return { available: false };
    throw error;
  }

  const state = stateFromActiveSubscriptions(subscriptions);
  await saveBillingState(shop, state);
  const active = subscriptions.find((s) => s.id === state.subscriptionId);
  return {
    available: true,
    state,
    subscription: active
      ? { name: active.name, test: active.test, trialDays: active.trialDays, currentPeriodEnd: active.currentPeriodEnd ?? null }
      : null,
  };
}

export class BillingUnavailableError extends Error {
  constructor() {
    super(
      "Shopify only allows billing for apps with public distribution. Choose Public distribution " +
        "for StoreRx in the Partner Dashboard to enable paid plans.",
    );
  }
}

/**
 * Send the merchant to Shopify's approval screen. Resolves never: on success
 * billing.request throws a redirect Response, which the caller must rethrow.
 */
export async function requestPlan(
  context: AdminBillingContext,
  shopDomain: string,
  plan: PaidPlanKey,
  isTest: boolean,
): Promise<never> {
  const storeHandle = shopDomain.replace(/\.myshopify\.com$/, "");
  const apiKey = process.env.SHOPIFY_API_KEY;
  // Back inside the admin, so the merchant lands on the Billing page embedded.
  const returnUrl = apiKey
    ? `https://admin.shopify.com/store/${storeHandle}/apps/${apiKey}/app/billing?subscribed=1`
    : undefined;
  try {
    return await context.billing.request({ plan: SHOPIFY_PLAN_NAMES[plan], isTest, returnUrl });
  } catch (error) {
    if (error instanceof Response) throw error;
    if (isBillingUnavailableError(error)) throw new BillingUnavailableError();
    throw error;
  }
}

/** Cancel the paid subscription now, with a prorated refund, and drop to Free. */
export async function cancelPlan(shop: BillingShop, context: AdminBillingContext, isTest: boolean): Promise<void> {
  if (shop.subscriptionId) {
    try {
      await context.billing.cancel({ subscriptionId: shop.subscriptionId, isTest, prorate: true });
    } catch (error) {
      if (isBillingUnavailableError(error)) throw new BillingUnavailableError();
      throw error;
    }
  }
  await saveBillingState(shop, { plan: "free", subscriptionId: null, subscriptionStatus: "CANCELLED" });
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export interface ShopUsage {
  plan: PlanSpec;
  periodStart: Date;
  resetsAt: Date;
  usage: PeriodUsage;
}

export async function getShopUsage(shop: BillingShop, now: Date = new Date()): Promise<ShopUsage> {
  const anchor = shop.billingCycleStart ?? shop.createdAt;
  const periodStart = currentPeriodStart(anchor, now);

  // Failed scans are not counted: the merchant got nothing from them.
  const counted = { shopId: shop.id, createdAt: { gte: periodStart }, status: { not: "failed" } };
  const since = { shopId: shop.id, createdAt: { gte: periodStart } };
  const [scans, explanations, drafts] = await Promise.all([
    prisma.audit.count({ where: counted }),
    prisma.aiUsage.aggregate({ where: { ...since, task: EXPLAIN_TASK }, _sum: { units: true } }),
    // Every other task is copy drafted on request.
    prisma.aiUsage.aggregate({ where: { ...since, task: { not: EXPLAIN_TASK } }, _sum: { units: true } }),
  ]);

  return {
    plan: planOf(shop.plan),
    periodStart,
    resetsAt: nextPeriodStart(anchor, now),
    usage: {
      scans,
      aiExplanations: explanations._sum.units ?? 0,
      aiDrafts: drafts._sum.units ?? 0,
    },
  };
}

export type ScanCheck = { allowed: true } | { allowed: false; message: string };

export async function checkScanAllowed(shop: BillingShop): Promise<ScanCheck> {
  const { plan, usage, resetsAt } = await getShopUsage(shop);
  const result: Allowance = scanAllowance(plan, usage);
  return result.allowed ? { allowed: true } : { allowed: false, message: scanLimitMessage(plan, resetsAt) };
}

/**
 * Explanations the shop may still generate. Generous by design — see
 * PlanLimits — so a merchant checking their whole store is never left with
 * findings nobody explained.
 */
export async function explanationsRemaining(shop: BillingShop): Promise<number> {
  const { plan, usage } = await getShopUsage(shop);
  return Math.max(0, plan.limits.aiExplanations - usage.aiExplanations);
}

/** Pieces of copy the shop may still have drafted this period. */
export async function draftsRemaining(shop: BillingShop): Promise<number> {
  const { plan, usage } = await getShopUsage(shop);
  return Math.max(0, plan.limits.aiDrafts - usage.aiDrafts);
}

export { PLANS };
