import { describe, expect, it } from "vitest";
import { checkoutRules } from "../../app/rules/checkout";
import type { CheckoutSettings, RuleContext, ShopData } from "../../app/rules/types";
import { checked } from "./helpers";

function ctx(overrides: Partial<CheckoutSettings> = {}): RuleContext {
  const checkoutSettings: CheckoutSettings = {
    guestCheckoutEnabled: true,
    shopPaySupported: true,
    applePaySupported: true,
    googlePaySupported: true,
    ...overrides,
  };
  return {
    html: "",
    shopData: { checkoutSettings } as ShopData,
  };
}

const rule = (id: string) => checkoutRules.find((r) => r.id === id)!;

describe("chk.express", () => {
  it("passes when the payment setup supports any express wallet", () => {
    expect(rule("chk.express").check(ctx())).toBeNull();
    expect(
      rule("chk.express").check(ctx({ shopPaySupported: false, applePaySupported: false })),
    ).toBeNull();
  });

  it("fires when no express wallet is supported", () => {
    const finding = checked(
      rule("chk.express").check(
        ctx({ shopPaySupported: false, applePaySupported: false, googlePaySupported: false }),
      ),
    );
    expect(finding?.ruleId).toBe("chk.express");
  });

  it("never claims a wallet is switched off — Shopify only reports support", () => {
    const finding = checked(
      rule("chk.express").check(
        ctx({ shopPaySupported: false, applePaySupported: false, googlePaySupported: false }),
      ),
    );
    const words = `${finding?.title} ${finding?.evidence?.value}`.toLowerCase();
    expect(words).not.toMatch(/\b(enabled|disabled|turned off|switched off)\b/);
  });
});

describe("chk.guest", () => {
  it("passes when guests can check out", () => {
    expect(rule("chk.guest").check(ctx({ guestCheckoutEnabled: true }))).toBeNull();
  });

  it("fires when login is required at checkout", () => {
    expect(checked(rule("chk.guest").check(ctx({ guestCheckoutEnabled: false })))?.ruleId).toBe(
      "chk.guest",
    );
  });
});

describe("checkout rules without data", () => {
  it("stay silent when checkout settings were not collected", () => {
    for (const r of checkoutRules) {
      expect(r.check({ html: "" }), r.id).toBeNull();
    }
  });

  it("only checks settings the Admin API reports", () => {
    // Shipping rates, payment gateways and tipping have no data behind them.
    expect(checkoutRules.map((r) => r.id).sort()).toEqual(["chk.express", "chk.guest"]);
  });
});
