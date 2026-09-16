/**
 * Mandatory privacy compliance webhooks (customers/data_request,
 * customers/redact, shop/redact).
 *
 * StoreRx holds no customer personal data: audits read storefront pages,
 * products and images through the Admin API, never customers or orders. So
 * customer data requests and redactions have nothing to export or delete.
 * A shop redaction — sent 48 hours after uninstall — removes everything the
 * app stores for that shop.
 */

import prisma from "./db.server";

export type ComplianceTopic = "CUSTOMERS_DATA_REQUEST" | "CUSTOMERS_REDACT" | "SHOP_REDACT";

const COMPLIANCE_TOPICS: ReadonlySet<string> = new Set<ComplianceTopic>([
  "CUSTOMERS_DATA_REQUEST",
  "CUSTOMERS_REDACT",
  "SHOP_REDACT",
]);

/** Accept both "shop/redact" (header form) and "SHOP_REDACT" (enum form). */
export function normalizeComplianceTopic(topic: string): ComplianceTopic | null {
  const normalized = topic.trim().toUpperCase().replace(/[/.]/g, "_");
  return COMPLIANCE_TOPICS.has(normalized) ? (normalized as ComplianceTopic) : null;
}

export interface ShopRedaction {
  shops: number;
  sessions: number;
}

/**
 * Delete everything StoreRx holds for a shop. Deleting the Shop row cascades
 * to audits, findings, issues, fixes, AI usage and billing state; sessions are keyed by
 * domain rather than related, so they are removed explicitly.
 *
 * Idempotent: Shopify may deliver the same webhook more than once.
 */
export async function redactShopData(shopDomain: string): Promise<ShopRedaction> {
  const [shops, sessions] = await prisma.$transaction([
    prisma.shop.deleteMany({ where: { domain: shopDomain } }),
    prisma.session.deleteMany({ where: { shop: shopDomain } }),
  ]);
  return { shops: shops.count, sessions: sessions.count };
}

/**
 * Drop scans that were queued but not started for a shop that just
 * uninstalled, so the worker does not try to scan a store it can no longer
 * access. Data itself is kept until shop/redact, in case the merchant
 * reinstalls within 48 hours.
 */
export async function cancelQueuedAudits(shopDomain: string): Promise<number> {
  const result = await prisma.audit.updateMany({
    where: { status: "pending", shop: { domain: shopDomain } },
    data: { status: "failed", error: "App was uninstalled" },
  });
  return result.count;
}

/**
 * Uninstalling cancels the app subscription on Shopify's side. Mirror that
 * now rather than waiting for app_subscriptions/update, which Shopify may not
 * deliver once the app is gone.
 */
export async function endSubscription(shopDomain: string): Promise<void> {
  await prisma.shop.updateMany({
    where: { domain: shopDomain, plan: { not: "free" } },
    data: { plan: "free", subscriptionId: null, subscriptionStatus: "CANCELLED", billingCycleStart: new Date() },
  });
}
