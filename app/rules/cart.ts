/**
 * Cart page rules
 */

import type { Rule, RuleContext, Finding } from "./types";

function hasElement(html: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(p, "i").test(html));
}

export const cartRules: Rule[] = [
  {
    id: "cart.drawer",
    page: "cart",
    severity: "low",
    description: "Cart drawer (vs full page)",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const drawerPatterns = ["cart-drawer", "ajax-cart", "slide-cart", "mini-cart"];

      if (!hasElement(ctx.html, drawerPatterns)) {
        return {
          ruleId: "cart.drawer",
          page: "cart",
          severity: "low",
          title: "No cart drawer detected",
          evidence: { type: "text", value: "Cart drawers keep shoppers on the page" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "cart.shipping.bar",
    page: "cart",
    severity: "medium",
    description: "Free-shipping progress bar",
    fixableByAI: true,
    fixType: "shipping_bar",
    check: (ctx: RuleContext): Finding | null => {
      const shippingBarPatterns = [
        "shipping.*bar",
        "free.*shipping.*progress",
        "spend.*more",
        "away.*from.*free",
        "shipping.*threshold",
      ];

      if (!hasElement(ctx.html, shippingBarPatterns)) {
        return {
          ruleId: "cart.shipping.bar",
          page: "cart",
          severity: "medium",
          title: "No free-shipping progress bar",
          evidence: { type: "text", value: "Progress bars increase average order value" },
          fixableByAI: true,
          fixType: "shipping_bar",
        };
      }
      return null;
    },
  },

  {
    id: "cart.upsell",
    page: "cart",
    severity: "medium",
    description: "Upsells / add-ons in cart",
    fixableByAI: true,
    fixType: "crosssells",
    check: (ctx: RuleContext): Finding | null => {
      const upsellPatterns = [
        "upsell",
        "cross-sell",
        "you.*may.*also.*like",
        "add.*on",
        "frequently.*bought",
        "recommended",
        "complete.*order",
      ];

      if (!hasElement(ctx.html, upsellPatterns)) {
        return {
          ruleId: "cart.upsell",
          page: "cart",
          severity: "medium",
          title: "No upsells or add-ons in cart",
          evidence: { type: "text", value: "Cart upsells boost average order value" },
          fixableByAI: true,
          fixType: "crosssells",
        };
      }
      return null;
    },
  },

  {
    id: "cart.trust",
    page: "cart",
    severity: "medium",
    description: "Trust badges near checkout button",
    fixableByAI: true,
    fixType: "trust_badges",
    check: (ctx: RuleContext): Finding | null => {
      const trustPatterns = [
        "trust.*badge",
        "secure.*checkout",
        "ssl",
        "guarantee",
        "money.*back",
        "safe.*checkout",
      ];

      if (!hasElement(ctx.html, trustPatterns)) {
        return {
          ruleId: "cart.trust",
          page: "cart",
          severity: "medium",
          title: "No trust badges near checkout button",
          evidence: { type: "text", value: "Trust badges reduce checkout anxiety" },
          fixableByAI: true,
          fixType: "trust_badges",
        };
      }
      return null;
    },
  },

  {
    id: "cart.discount.prominent",
    page: "cart",
    severity: "low",
    description: "Discount field very prominent (encourages coupon hunting)",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      // Check if discount field is overly prominent
      const prominentPatterns = [
        "discount.*code.*required",
        "enter.*coupon",
        "have.*a.*code",
        "promo.*code",
      ];

      // This is a nuanced check - having a discount field is fine,
      // but making it the focus can cause abandonment
      // For now, just detect presence
      if (hasElement(ctx.html, prominentPatterns)) {
        return {
          ruleId: "cart.discount.prominent",
          page: "cart",
          severity: "low",
          title: "Discount field may encourage coupon hunting",
          evidence: { type: "text", value: "Prominent promo fields can cause abandonment" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "cart.express",
    page: "cart",
    severity: "medium",
    description: "Express checkout buttons shown",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const expressPatterns = [
        "shop.*pay",
        "shopify.*pay",
        "apple.*pay",
        "google.*pay",
        "paypal.*express",
        "express.*checkout",
        "dynamic.*checkout",
      ];

      if (!hasElement(ctx.html, expressPatterns)) {
        return {
          ruleId: "cart.express",
          page: "cart",
          severity: "medium",
          title: "No express checkout buttons in cart",
          evidence: { type: "text", value: "Express checkout reduces friction" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },
];

export default cartRules;
