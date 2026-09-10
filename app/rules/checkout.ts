/**
 * Checkout settings rules
 * Note: Checkout page layout is controlled by Shopify
 * These rules check Admin API settings, not HTML
 */

import type { Rule, RuleContext, Finding } from "./types";

export const checkoutRules: Rule[] = [
  {
    id: "chk.express",
    page: "checkout",
    severity: "high",
    description: "Shop Pay / Apple Pay / Google Pay enabled",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const settings = ctx.shopData?.checkoutSettings;
      if (!settings) return null;

      const expressEnabled =
        settings.shopPayEnabled ||
        settings.applePayEnabled ||
        settings.googlePayEnabled;

      if (!expressEnabled) {
        return {
          ruleId: "chk.express",
          page: "checkout",
          severity: "high",
          title: "No express checkout methods enabled",
          evidence: {
            type: "text",
            value: "Enable Shop Pay, Apple Pay, or Google Pay to reduce friction",
          },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "chk.guest",
    page: "checkout",
    severity: "high",
    description: "Guest checkout allowed",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const settings = ctx.shopData?.checkoutSettings;
      if (!settings) return null;

      if (!settings.guestCheckoutEnabled) {
        return {
          ruleId: "chk.guest",
          page: "checkout",
          severity: "high",
          title: "Guest checkout is disabled",
          evidence: {
            type: "text",
            value: "Forcing account creation causes abandonment",
          },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "chk.shipping.options",
    page: "checkout",
    severity: "low",
    description: "At least 2 shipping options",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const settings = ctx.shopData?.checkoutSettings;
      if (!settings) return null;

      if (settings.shippingOptionsCount < 2) {
        return {
          ruleId: "chk.shipping.options",
          page: "checkout",
          severity: "low",
          title: "Only one shipping option available",
          evidence: {
            type: "text",
            value: "Offer standard and express shipping options",
          },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "chk.payment.options",
    page: "checkout",
    severity: "medium",
    description: "At least 2 payment methods",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const settings = ctx.shopData?.checkoutSettings;
      if (!settings) return null;

      if (settings.paymentMethodsCount < 2) {
        return {
          ruleId: "chk.payment.options",
          page: "checkout",
          severity: "medium",
          title: "Limited payment options",
          evidence: {
            type: "text",
            value: "More payment options reduce checkout friction",
          },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "chk.tipping",
    page: "checkout",
    severity: "low",
    description: "Tipping enabled on non-service store",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const settings = ctx.shopData?.checkoutSettings;
      if (!settings) return null;

      // Only flag if tipping is enabled - merchant may have valid reason
      // This is informational, not necessarily a problem
      if (settings.tippingEnabled) {
        return {
          ruleId: "chk.tipping",
          page: "checkout",
          severity: "low",
          title: "Tipping is enabled at checkout",
          evidence: {
            type: "text",
            value: "Tipping may confuse customers on product-only stores",
          },
          fixableByAI: false,
        };
      }
      return null;
    },
  },
];

export default checkoutRules;
