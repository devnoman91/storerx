/**
 * Cart page rules
 *
 * StoreRx fetches /cart in a fresh session, so the cart is empty. An empty
 * cart shows no checkout button, no express checkout, no upsells and no
 * discount field — themes only render those once something is added. A rule
 * that needs a filled cart returns UNCHECKED on an empty one: reporting "no
 * express checkout" because the cart had nothing in it would be a false
 * finding on every store.
 *
 * The cart drawer is the exception: it is part of the page layout, present
 * whether or not the cart has anything in it.
 */

import { pageFor, type Page } from "./page";
import { UNCHECKED, type Rule, type RuleContext, type RuleResult } from "./types";

/** Line items. `updates[]` is Shopify's own quantity field name, on every theme. */
const LINE_ITEM = '[name="updates[]"], [name^="updates["], [id^="CartItem-"], .cart-item';

const TRUST_TEXT =
  /guarantee|secure (checkout|payment)|money[- ]?back|\d+[- ]day (returns?|guarantee)|easy returns|ssl/i;

const UPSELL_HEADING =
  /you may also like|frequently bought|add[- ]?ons?|complete your (order|look)|recommended|goes well with/i;

function hasItems(page: Page): boolean {
  return page.has(LINE_ITEM, page.main);
}

export const cartRules: Rule[] = [
  {
    id: "cart.drawer",
    page: "cart",
    severity: "low",
    description: "A cart drawer or popup",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      // A notification popup keeps shoppers on the page just as a drawer does.
      const inPage = page.has(
        'cart-drawer, cart-notification, [id*="CartDrawer" i], [id*="cart-drawer" i], [class*="cart-drawer" i], [class*="mini-cart" i], [class*="ajax-cart" i], [class*="side-cart" i], [class*="slide-cart" i], [class*="cart-notification" i]',
      );
      if (inPage) return null;

      return {
        ruleId: "cart.drawer",
        page: "cart",
        severity: "low",
        title: "Adding to cart takes shoppers away from the page",
        evidence: {
          type: "text",
          value: "No cart drawer or add-to-cart popup was found, so adding a product sends shoppers to the cart page",
        },
      };
    },
  },

  {
    id: "cart.shipping.bar",
    page: "cart",
    severity: "medium",
    description: "Free-shipping progress",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const bar =
        page.has(
          '[class*="free-shipping" i], [class*="shipping-bar" i], [class*="shipping-progress" i], progress, [role="progressbar"]',
          page.main,
        ) || /away from free|spend .{1,15} more|more (to|for) free (shipping|delivery)|free shipping/i.test(page.text(page.main));
      if (bar) return null;
      // Most bars only appear once there is something in the cart.
      if (!hasItems(page)) return UNCHECKED;

      return {
        ruleId: "cart.shipping.bar",
        page: "cart",
        severity: "medium",
        title: "No free-shipping progress in the cart",
        evidence: { type: "text", value: "The cart doesn't tell shoppers how close they are to free shipping" },
      };
    },
  },

  {
    id: "cart.upsell",
    page: "cart",
    severity: "medium",
    description: "Upsells or add-ons",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      if (!hasItems(page)) return UNCHECKED;

      const section = page.has(
        '[class*="upsell" i], [class*="cross-sell" i], [class*="recommend" i], product-recommendations',
        page.main,
      );
      const heading = page.all("h2, h3, h4", page.main).some((h) => UPSELL_HEADING.test(page.text(h)));
      if (section || heading) return null;

      return {
        ruleId: "cart.upsell",
        page: "cart",
        severity: "medium",
        title: "No upsells or add-ons in the cart",
        evidence: { type: "text", value: "The cart suggests nothing else to add" },
      };
    },
  },

  {
    id: "cart.trust",
    page: "cart",
    severity: "medium",
    description: "Reassurance near the checkout button",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      if (!hasItems(page)) return UNCHECKED;

      const button = page.main.querySelector('[name="checkout"]');
      if (!button) return UNCHECKED;
      const area = button.closest('.shopify-section, section, form, [class*="footer" i]') ?? page.main;

      if (TRUST_TEXT.test(page.text(area))) return null;
      if (page.has('[class*="trust" i]', area)) return null;
      const badgeImage = page
        .all("img[alt]", area)
        .some((img) => /secure|guarantee|trust|badge/i.test(img.getAttribute("alt") ?? ""));
      if (badgeImage) return null;

      return {
        ruleId: "cart.trust",
        page: "cart",
        severity: "medium",
        title: "No reassurance near the checkout button",
        evidence: {
          type: "text",
          value: "The checkout area mentions no guarantee, secure checkout or easy returns",
        },
      };
    },
  },

  {
    id: "cart.discount.prominent",
    page: "cart",
    severity: "low",
    description: "A discount code field",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      if (!hasItems(page)) return UNCHECKED;

      const field = page.has(
        'input[name="discount"], input[name*="discount" i], input[id*="discount" i], [class*="discount-code" i] input',
        page.main,
      );
      if (!field) return null;

      return {
        ruleId: "cart.discount.prominent",
        page: "cart",
        severity: "low",
        title: "A discount code field is shown in the cart",
        evidence: {
          type: "text",
          value: "Shoppers without a code may leave to search for one before checking out",
        },
      };
    },
  },

  {
    id: "cart.express",
    page: "cart",
    severity: "medium",
    description: "Express checkout buttons",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      if (!hasItems(page)) return UNCHECKED;

      const express = page.has(
        '.additional-checkout-buttons, [class*="dynamic-checkout" i], shopify-accelerated-checkout-cart, [data-shopify*="dynamic-checkout"], shopify-buy-it-now-button',
        page.main,
      );
      if (express) return null;

      return {
        ruleId: "cart.express",
        page: "cart",
        severity: "medium",
        title: "No express checkout buttons in the cart",
        evidence: {
          type: "text",
          value: "The cart offers no Shop Pay, Apple Pay or Google Pay buttons beside checkout",
        },
      };
    },
  },
];

export default cartRules;
