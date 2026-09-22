/**
 * Plans, limits and subscription state (FEATURES.md §11).
 *
 * Pure functions only, so the rules that decide what a merchant can do are
 * unit-tested without Shopify or a database. Shopify billing calls live in
 * app/billing/billing.server.ts.
 *
 * Limits are counted over a rolling 30-day usage period that restarts when the
 * merchant changes plan. Scan limits protect PageSpeed quota and worker time.
 *
 * The two AI limits are deliberately different in kind. Explanations are cheap
 * (0.034 cents each, measured), written once per rule per shop and cached, and
 * there are only ~55 rules — so the whole lifetime of a store's explanations
 * costs about two cents, and the limit exists only as a backstop. Drafted copy
 * is what a merchant can run up without bound, and costs several times more per
 * call, so that is what the plans actually meter.
 */

export type PlanKey = "free" | "starter" | "growth" | "pro";

export interface PlanLimits {
  /** Scans per usage period, of any area. null = unlimited. */
  scans: number | null;
  /**
   * Explanations of found issues. An explanation is written once per rule per
   * shop and cached, and there are only ~55 rules, so a shop's whole lifetime
   * of explanations costs around two cents — measured, not estimated. This
   * limit is a backstop against a pathological loop, not a lever: a merchant
   * checking their whole store must never run out, or the product stops
   * explaining itself halfway through.
   */
  aiExplanations: number;
  /**
   * Copy drafted on request — alt text, SEO titles, descriptions. Unbounded by
   * anything but the merchant's clicking, and several times pricier per call
   * (vision for images, a larger model for descriptions), so this is the limit
   * that actually meters cost.
   */
  aiDrafts: number;
}

export interface PlanSpec {
  key: PlanKey;
  label: string;
  /** USD per 30 days. */
  price: number;
  summary: string;
  features: string[];
  limits: PlanLimits;
}

/** Days of free trial Shopify gives on a paid plan before the first charge. */
export const TRIAL_DAYS = 7;

export const USAGE_PERIOD_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export const PLANS: Record<PlanKey, PlanSpec> = {
  free: {
    key: "free",
    label: "Free",
    price: 0,
    summary: "See where your store loses sales",
    features: [
      "9 scans a month — one of every area",
      "Every issue explained",
      "5 pieces of copy drafted for you",
    ],
    limits: { scans: 9, aiExplanations: 100, aiDrafts: 5 },
  },
  starter: {
    key: "starter",
    label: "Starter",
    price: 19,
    summary: "Weekly check-ups for a growing store",
    features: [
      "60 scans a month — every area, weekly",
      "Every issue explained",
      "100 pieces of copy drafted a month",
    ],
    limits: { scans: 60, aiExplanations: 500, aiDrafts: 100 },
  },
  growth: {
    key: "growth",
    label: "Growth",
    price: 49,
    summary: "Scan as often as you change your store",
    features: ["Unlimited scans", "Every issue explained", "500 pieces of copy drafted a month"],
    limits: { scans: null, aiExplanations: 2000, aiDrafts: 500 },
  },
  pro: {
    key: "pro",
    label: "Pro",
    price: 99,
    summary: "For high-volume stores and agencies",
    features: [
      "Unlimited scans",
      "Every issue explained",
      "2,000 pieces of copy drafted a month",
      "Priority support",
    ],
    limits: { scans: null, aiExplanations: 5000, aiDrafts: 2000 },
  },
};

export const PLAN_ORDER: PlanKey[] = ["free", "starter", "growth", "pro"];

export type PaidPlanKey = Exclude<PlanKey, "free">;

export const PAID_PLANS: PaidPlanKey[] = ["starter", "growth", "pro"];

/**
 * Names registered in the Shopify billing config. The name is what merchants
 * see on the approval screen and their invoice, and what Shopify sends back in
 * billing.check and app_subscriptions/update.
 */
export const SHOPIFY_PLAN_NAMES: Record<PaidPlanKey, string> = {
  starter: "StoreRx Starter",
  growth: "StoreRx Growth",
  pro: "StoreRx Pro",
};

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PLANS, value);
}

export function isPaidPlanKey(value: unknown): value is PaidPlanKey {
  return isPlanKey(value) && value !== "free";
}

/** Plan stored on the shop, tolerating unknown legacy values. */
export function planOf(value: string | null | undefined): PlanSpec {
  return isPlanKey(value) ? PLANS[value] : PLANS.free;
}

/** Map a Shopify subscription name back to a plan. Unknown names map to null. */
export function planFromSubscriptionName(name: string | null | undefined): PaidPlanKey | null {
  if (!name) return null;
  const wanted = name.trim().toLowerCase();
  for (const key of PAID_PLANS) {
    if (SHOPIFY_PLAN_NAMES[key].toLowerCase() === wanted) return key;
  }
  return null;
}

/**
 * Start of the usage period containing `now`. Periods run back to back in
 * 30-day steps from `anchor` (the last plan change, or install), so usage
 * resets on its own without a scheduled job.
 */
export function currentPeriodStart(anchor: Date, now: Date = new Date()): Date {
  const elapsed = now.getTime() - anchor.getTime();
  if (elapsed <= 0) return anchor;
  const periods = Math.floor(elapsed / (USAGE_PERIOD_DAYS * DAY_MS));
  return new Date(anchor.getTime() + periods * USAGE_PERIOD_DAYS * DAY_MS);
}

export function nextPeriodStart(anchor: Date, now: Date = new Date()): Date {
  return new Date(currentPeriodStart(anchor, now).getTime() + USAGE_PERIOD_DAYS * DAY_MS);
}

export interface Allowance {
  used: number;
  /** null = unlimited. */
  limit: number | null;
  /** Infinity when unlimited. */
  remaining: number;
  allowed: boolean;
}

export function allowance(used: number, limit: number | null): Allowance {
  if (limit === null) return { used, limit, remaining: Infinity, allowed: true };
  const remaining = Math.max(0, limit - used);
  return { used, limit, remaining, allowed: remaining > 0 };
}

export interface PeriodUsage {
  scans: number;
  aiExplanations: number;
  aiDrafts: number;
}

/** AiUsage rows for anything other than an explanation are drafted copy. */
export const EXPLAIN_TASK = "explain";

/** Whether another scan fits the plan. */
export function scanAllowance(plan: PlanSpec, usage: PeriodUsage): Allowance {
  return allowance(usage.scans, plan.limits.scans);
}

/** Scans the plan has left this period; null when the plan is unlimited. */
export function scansLeft(plan: PlanSpec, usage: PeriodUsage): number | null {
  return plan.limits.scans === null ? null : Math.max(0, plan.limits.scans - usage.scans);
}

/**
 * What an action is about to spend, said before it is spent.
 *
 * Drafted copy has always stated its cost up front; scans did not, so a
 * merchant on the Free plan could press "Re-scan" and find out afterwards that
 * it was their last one.
 */
export function scanCostNote(count: number, left: number | null): string {
  const scans = count === 1 ? "1 scan" : `${count} scans`;
  if (left === null) return `Uses ${scans} — your plan has no monthly limit.`;
  if (left === 0) return "You've used every scan on your plan this month.";
  return `Uses ${scans} of the ${left === 1 ? "1 left" : `${left} left`} on your plan this month.`;
}

/** Message shown when a scan is refused, naming the limit and when it resets. */
export function scanLimitMessage(plan: PlanSpec, resetsAt: Date): string {
  return (
    `You've used all ${plan.limits.scans} scans on the ${plan.label} plan this month. ` +
    `They reset on ${resetsAt.toDateString()}, or upgrade for more.`
  );
}

// ---------------------------------------------------------------------------
// Subscription state
// ---------------------------------------------------------------------------

export type SubscriptionStatus =
  | "ACTIVE"
  | "ACCEPTED"
  | "PENDING"
  | "CANCELLED"
  | "DECLINED"
  | "EXPIRED"
  | "FROZEN";

/** Billing fields stored on the Shop row. */
export interface ShopBillingState {
  plan: PlanKey;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
}

export interface SubscriptionEvent {
  id: string;
  name: string;
  status: string;
}

const ENDED_STATUSES: ReadonlySet<string> = new Set(["CANCELLED", "DECLINED", "EXPIRED", "FROZEN"]);
const LIVE_STATUSES: ReadonlySet<string> = new Set(["ACTIVE", "ACCEPTED"]);

/**
 * Apply an app_subscriptions/update event. Returns the new billing state, or
 * null when the event does not change what the shop is entitled to.
 *
 * Switching plans creates a new subscription and cancels the old one, and the
 * two webhooks can arrive in either order — so a cancellation only downgrades
 * the shop when it is for the subscription the shop is currently on.
 */
export function applySubscriptionEvent(
  current: ShopBillingState,
  event: SubscriptionEvent,
): ShopBillingState | null {
  const status = event.status.trim().toUpperCase();
  const plan = planFromSubscriptionName(event.name);

  if (LIVE_STATUSES.has(status)) {
    if (!plan) return null; // not one of our plans
    if (current.plan === plan && current.subscriptionId === event.id && current.subscriptionStatus === status) {
      return null;
    }
    return { plan, subscriptionId: event.id, subscriptionStatus: status };
  }

  if (ENDED_STATUSES.has(status)) {
    const isCurrent =
      current.subscriptionId === event.id ||
      // Plan set before the subscription id was recorded.
      (current.subscriptionId === null && plan !== null && current.plan === plan);
    if (!isCurrent) return null;
    return { plan: "free", subscriptionId: null, subscriptionStatus: status };
  }

  // PENDING: the merchant has not approved it yet; nothing changes.
  return null;
}

export interface ActiveSubscription {
  id: string;
  name: string;
  status: string;
}

/**
 * Billing state from Shopify's own list of active subscriptions (billing.check).
 * Authoritative: it corrects anything a missed webhook left behind.
 */
export function stateFromActiveSubscriptions(subscriptions: ActiveSubscription[]): ShopBillingState {
  for (const subscription of subscriptions) {
    const plan = planFromSubscriptionName(subscription.name);
    if (plan && LIVE_STATUSES.has(subscription.status.toUpperCase())) {
      return { plan, subscriptionId: subscription.id, subscriptionStatus: subscription.status.toUpperCase() };
    }
  }
  return { plan: "free", subscriptionId: null, subscriptionStatus: null };
}

/** Whether moving between these states starts a new usage period. */
export function startsNewPeriod(before: ShopBillingState, after: ShopBillingState): boolean {
  return before.plan !== after.plan || before.subscriptionId !== after.subscriptionId;
}

/**
 * Shopify refuses the Billing API for apps that are not publicly distributed
 * (custom apps, or an app whose distribution is not chosen yet).
 */
export function isBillingUnavailableError(error: unknown): boolean {
  const parts: string[] = [];
  if (error instanceof Error) parts.push(error.message);
  // BillingError carries userErrors in errorData; GraphqlQueryError in body.
  const details = error as { errorData?: unknown; body?: unknown } | null;
  for (const data of [details?.errorData, details?.body]) {
    if (data === undefined) continue;
    try {
      parts.push(JSON.stringify(data));
    } catch {
      // ignore unserialisable error data
    }
  }
  return /public distribution|custom app|cannot use the billing api|billing api is not available/i.test(parts.join(" "));
}
