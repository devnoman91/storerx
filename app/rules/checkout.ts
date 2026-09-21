/**
 * Checkout settings rules
 *
 * Checkout layout is controlled by Shopify, so these rules read settings from
 * the Admin API rather than page HTML. Only settings the API actually reports
 * are checked: shipping rates, payment gateways and tipping are not exposed
 * (or need extra scopes), and rules that ran on placeholder values for them
 * were retired — see CheckoutSettings in ./types.
 */

import type { Rule, RuleContext, Finding } from "./types";

export const checkoutRules: Rule[] = [
  {
    id: "chk.express",
    page: "checkout",
    severity: "high",
    description: "Express wallets supported",
    check: (ctx: RuleContext): Finding | null => {
      const settings = ctx.shopData?.checkoutSettings;
      if (!settings) return null;

      const anyWallet =
        settings.shopPaySupported || settings.applePaySupported || settings.googlePaySupported;
      if (anyWallet) return null;

      // Shopify reports which wallets the payment setup *supports*, not which
      // are switched on — so this can only say none are available, never
      // that one is turned off.
      return {
        ruleId: "chk.express",
        page: "checkout",
        severity: "high",
        title: "Your payment setup doesn't support express wallets",
        evidence: {
          type: "text",
          value:
            "Shopify reports no support for Shop Pay, Apple Pay or Google Pay on this store's payment setup",
        },
      };
    },
  },

  {
    id: "chk.guest",
    page: "checkout",
    severity: "high",
    description: "Guest checkout",
    check: (ctx: RuleContext): Finding | null => {
      const settings = ctx.shopData?.checkoutSettings;
      if (!settings || settings.guestCheckoutEnabled) return null;

      return {
        ruleId: "chk.guest",
        page: "checkout",
        severity: "high",
        title: "Customers must log in before they can check out",
        evidence: {
          type: "text",
          value: "Customer accounts are set to require login at checkout",
        },
      };
    },
  },
];

export default checkoutRules;
