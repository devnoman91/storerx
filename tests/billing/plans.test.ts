import { describe, it, expect } from "vitest";
import { CATEGORY_CHECK_COUNTS } from "../../app/scoring";
import {
  PLANS,
  SHOPIFY_PLAN_NAMES,
  allowance,
  applySubscriptionEvent,
  currentPeriodStart,
  isBillingUnavailableError,
  isPaidPlanKey,
  nextPeriodStart,
  planFromSubscriptionName,
  planOf,
  scanAllowance,
  scanCostNote,
  scansLeft,
  scansLeftNote,
  stateFromActiveSubscriptions,
  startsNewPeriod,
  type ShopBillingState,
} from "../../app/billing/plans";
import { SCAN_SCOPE_ORDER } from "../../app/scans/scopes";

const DAY = 24 * 60 * 60 * 1000;
const free: ShopBillingState = { plan: "free", subscriptionId: null, subscriptionStatus: null };
const onGrowth: ShopBillingState = { plan: "growth", subscriptionId: "gid://shopify/AppSubscription/1", subscriptionStatus: "ACTIVE" };

describe("plans", () => {
  it("maps Shopify subscription names back to plans", () => {
    expect(planFromSubscriptionName(SHOPIFY_PLAN_NAMES.starter)).toBe("starter");
    expect(planFromSubscriptionName("storerx pro ")).toBe("pro");
    expect(planFromSubscriptionName("Some other app plan")).toBeNull();
    expect(planFromSubscriptionName(null)).toBeNull();
  });

  it("treats unknown stored plans as Free and rejects forged plan names", () => {
    expect(planOf("enterprise").key).toBe("free");
    expect(isPaidPlanKey("free")).toBe(false);
    expect(isPaidPlanKey("toString")).toBe(false);
    expect(isPaidPlanKey("growth")).toBe(true);
  });

  it("gives higher plans at least as much as lower ones", () => {
    const order = [PLANS.free, PLANS.starter, PLANS.growth, PLANS.pro];
    const size = (n: number | null) => (n === null ? Infinity : n);
    for (let i = 1; i < order.length; i++) {
      expect(order[i].price).toBeGreaterThan(order[i - 1].price);
      expect(size(order[i].limits.scans)).toBeGreaterThanOrEqual(size(order[i - 1].limits.scans));
      expect(order[i].limits.aiDrafts).toBeGreaterThanOrEqual(order[i - 1].limits.aiDrafts);
      expect(order[i].limits.aiExplanations).toBeGreaterThanOrEqual(
        order[i - 1].limits.aiExplanations,
      );
    }
  });
});

describe("usage periods", () => {
  const anchor = new Date("2026-09-01T00:00:00Z");

  it("starts at the anchor during the first 30 days", () => {
    expect(currentPeriodStart(anchor, new Date(anchor.getTime() + 29 * DAY))).toEqual(anchor);
  });

  it("rolls forward in 30-day steps without a reset job", () => {
    const now = new Date(anchor.getTime() + 65 * DAY);
    expect(currentPeriodStart(anchor, now)).toEqual(new Date(anchor.getTime() + 60 * DAY));
    expect(nextPeriodStart(anchor, now)).toEqual(new Date(anchor.getTime() + 90 * DAY));
  });
});

describe("scan limits", () => {
  it("blocks another scan on Free once the month's scans are used", () => {
    expect(scanAllowance(PLANS.free, { scans: PLANS.free.limits.scans!, aiExplanations: 0, aiDrafts: 0 }).allowed).toBe(false);
    expect(scanAllowance(PLANS.free, { scans: 0, aiExplanations: 0, aiDrafts: 0 }).allowed).toBe(true);
  });

  it("gives Free enough scans to cover every area once", () => {
    expect(PLANS.free.limits.scans).toBeGreaterThanOrEqual(SCAN_SCOPE_ORDER.length);
  });

  it("never blocks unlimited plans", () => {
    expect(scanAllowance(PLANS.growth, { scans: 500, aiExplanations: 0, aiDrafts: 0 })).toMatchObject({ allowed: true, remaining: Infinity });
  });

  it("does not report negative remaining allowance", () => {
    expect(allowance(7, 5)).toEqual({ used: 7, limit: 5, remaining: 0, allowed: false });
  });
});

describe("subscription webhooks", () => {
  it("upgrades when a plan is approved", () => {
    const next = applySubscriptionEvent(free, { id: "gid://shopify/AppSubscription/9", name: SHOPIFY_PLAN_NAMES.starter, status: "ACTIVE" });
    expect(next).toEqual({ plan: "starter", subscriptionId: "gid://shopify/AppSubscription/9", subscriptionStatus: "ACTIVE" });
  });

  it("downgrades to Free when the current subscription is cancelled, frozen or expires", () => {
    for (const status of ["CANCELLED", "FROZEN", "EXPIRED", "cancelled"]) {
      const next = applySubscriptionEvent(onGrowth, { id: onGrowth.subscriptionId!, name: SHOPIFY_PLAN_NAMES.growth, status });
      expect(next?.plan, status).toBe("free");
    }
  });

  it("ignores the old subscription being cancelled after switching plans", () => {
    // Moved from Starter (id 1) to Growth (id 2); Starter's cancellation arrives late.
    const switched: ShopBillingState = { plan: "growth", subscriptionId: "gid://shopify/AppSubscription/2", subscriptionStatus: "ACTIVE" };
    expect(applySubscriptionEvent(switched, { id: "gid://shopify/AppSubscription/1", name: SHOPIFY_PLAN_NAMES.starter, status: "CANCELLED" })).toBeNull();
  });

  it("does nothing while a plan waits for approval, or for another app's plan", () => {
    expect(applySubscriptionEvent(free, { id: "x", name: SHOPIFY_PLAN_NAMES.pro, status: "PENDING" })).toBeNull();
    expect(applySubscriptionEvent(free, { id: "x", name: "Other plan", status: "ACTIVE" })).toBeNull();
  });

  it("ignores a repeat delivery", () => {
    expect(applySubscriptionEvent(onGrowth, { id: onGrowth.subscriptionId!, name: SHOPIFY_PLAN_NAMES.growth, status: "ACTIVE" })).toBeNull();
  });
});

describe("sync from Shopify", () => {
  it("uses the active StoreRx subscription", () => {
    const state = stateFromActiveSubscriptions([
      { id: "a", name: "Other", status: "ACTIVE" },
      { id: "b", name: SHOPIFY_PLAN_NAMES.pro, status: "ACTIVE" },
    ]);
    expect(state).toEqual({ plan: "pro", subscriptionId: "b", subscriptionStatus: "ACTIVE" });
  });

  it("falls back to Free with no active subscription", () => {
    expect(stateFromActiveSubscriptions([])).toEqual(free);
  });

  it("starts a new usage period only when the plan or subscription changes", () => {
    expect(startsNewPeriod(free, onGrowth)).toBe(true);
    expect(startsNewPeriod(onGrowth, { ...onGrowth, subscriptionStatus: "ACCEPTED" })).toBe(false);
  });
});

describe("billing availability", () => {
  it("recognises Shopify refusing billing for apps without public distribution", () => {
    expect(isBillingUnavailableError(new Error("Apps without a public distribution cannot use the Billing API"))).toBe(true);
    const withData = Object.assign(new Error("Error while billing the store"), {
      errorData: [{ message: "Custom apps cannot use the Billing API" }],
    });
    expect(isBillingUnavailableError(withData)).toBe(true);
    expect(isBillingUnavailableError(new Error("Throttled"))).toBe(false);
  });
});

describe("what a plan has to cover", () => {
  // Measured from real usage: one explanation costs 0.034 cents, is written
  // once per rule per shop, and is then cached forever. There are only this
  // many rules to explain, so a shop's lifetime explanation cost is ~2 cents.
  const RULES_THAT_CAN_FIRE = Object.values(CATEGORY_CHECK_COUNTS).reduce((a, b) => a + b, 0);

  it("lets every plan explain a whole store, including the free one", () => {
    // A merchant who checks all nine areas must not be handed findings that
    // nobody explained — that is the product failing, not a limit working.
    for (const plan of Object.values(PLANS)) {
      expect(plan.limits.aiExplanations, plan.key).toBeGreaterThan(RULES_THAT_CAN_FIRE);
    }
  });

  it("gives the free plan enough scans to see every area once", () => {
    expect(PLANS.free.limits.scans).toBeGreaterThanOrEqual(SCAN_SCOPE_ORDER.length);
  });

  it("meters drafts, which a merchant can run up without limit", () => {
    // Drafts are the cost that scales with clicking, so unlike explanations
    // they are deliberately scarce on the free plan.
    expect(PLANS.free.limits.aiDrafts).toBeLessThan(PLANS.free.limits.aiExplanations);
    expect(PLANS.pro.limits.aiDrafts).toBeGreaterThan(PLANS.free.limits.aiDrafts * 100);
  });
});

describe("what a scan costs", () => {
  const usage = { scans: 7, aiExplanations: 0, aiDrafts: 0 };

  it("counts what the plan has left, never below zero", () => {
    expect(scansLeft(PLANS.free, usage)).toBe(PLANS.free.limits.scans! - 7);
    expect(scansLeft(PLANS.free, { ...usage, scans: 999 })).toBe(0);
  });

  it("has no number to give on an unlimited plan", () => {
    const unlimited = { ...PLANS.pro, limits: { ...PLANS.pro.limits, scans: null } };
    expect(scansLeft(unlimited, usage)).toBeNull();
  });

  it("states the cost before the merchant spends it", () => {
    expect(scanCostNote(1, 3)).toBe("Uses 1 scan of the 3 left on your plan this month.");
    expect(scanCostNote(2, 2)).toBe("Uses 2 scans of the 2 left on your plan this month.");
    expect(scanCostNote(1, 1)).toBe("Uses 1 scan of the 1 left on your plan this month.");
  });

  it("says so plainly when there is nothing left to spend", () => {
    // The button that would spend it is disabled, so this explains why.
    expect(scanCostNote(3, 0)).toBe("You've used every scan on your plan this month.");
  });

  it("states the allowance where naming one button's price would be wrong", () => {
    expect(scansLeftNote(3)).toBe("3 scans left on your plan this month.");
    expect(scansLeftNote(1)).toBe("1 scan left on your plan this month.");
    expect(scansLeftNote(0)).toBe("You've used every scan on your plan this month.");
  });
});
