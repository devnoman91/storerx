/**
 * Collection page rules
 *
 * Product cards are found from links to product pages (Page.productCards), not
 * theme class names, so the same checks work on any theme. Filters are read
 * from Shopify's own `filter.*` parameters, which every theme using Shopify's
 * Search & Discovery filtering renders.
 */

import { pageFor } from "./page";
import { UNCHECKED, type Rule, type RuleContext, type RuleResult } from "./types";

/** Relative spread in width/height ratio tolerated across a grid. */
const RATIO_TOLERANCE = 0.1;

export const collectionRules: Rule[] = [
  {
    id: "coll.filters",
    page: "collection",
    severity: "medium",
    description: "Filtering and sorting on collection pages",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      // Only Shopify's own `filter.*` fields count. The form around them also
      // holds the sort control, so its presence says nothing about filters.
      const hasFilter = page.has('[name^="filter."]');
      const hasSort = page.has('[name="sort_by"]');
      if (hasFilter && hasSort) return null;

      const missing = [!hasFilter && "filters", !hasSort && "sorting"].filter(Boolean).join(" or ");
      return {
        ruleId: "coll.filters",
        page: "collection",
        severity: "medium",
        title: `Collection pages have no ${missing}`,
        evidence: {
          type: "text",
          value: `No ${missing} controls were found. Filter apps that build their controls after the page opens can't be seen here.`,
        },
      };
    },
  },

  {
    id: "coll.card.price",
    page: "collection",
    severity: "high",
    description: "Prices shown on product cards",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const cards = page.productCards();
      if (cards.length === 0) return null;

      const withoutPrice = cards.filter((card) => !page.hasPrice(card));
      if (withoutPrice.length === 0) return null;

      return {
        ruleId: "coll.card.price",
        page: "collection",
        severity: "high",
        title: "Some product cards don't show a price",
        evidence: {
          type: "text",
          value: `${withoutPrice.length} of ${cards.length} product cards on this page show no price`,
        },
      };
    },
  },

  {
    id: "coll.card.atc",
    page: "collection",
    severity: "low",
    description: "Quick add-to-cart on product cards",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const cards = page.productCards();
      if (cards.length === 0) return null;

      const quickAdd = cards.some((card) =>
        page.has('form[action*="/cart/add"], [class*="quick-add" i], [class*="quick-shop" i], [class*="quickshop" i]', card),
      );
      if (quickAdd) return null;

      return {
        ruleId: "coll.card.atc",
        page: "collection",
        severity: "low",
        title: "Product cards have no quick add-to-cart",
        evidence: {
          type: "text",
          value: `None of the ${cards.length} product cards has an add-to-cart or quick-add button`,
        },
      };
    },
  },

  {
    id: "coll.thin",
    page: "collection",
    severity: "medium",
    description: "Collection has fewer than 4 products",
    check: (ctx: RuleContext): RuleResult => {
      const count = pageFor(ctx.html).productCards().length;
      // Empty is its own, more serious problem (coll.empty).
      if (count === 0 || count >= 4) return null;

      return {
        ruleId: "coll.thin",
        page: "collection",
        severity: "medium",
        title: `Collection has only ${count} product${count === 1 ? "" : "s"}`,
        evidence: { type: "text", value: `${count} product card${count === 1 ? "" : "s"} on this collection page` },
      };
    },
  },

  {
    id: "coll.image.consistency",
    page: "collection",
    severity: "medium",
    description: "Product card images share one shape",
    check: (ctx: RuleContext): RuleResult => {
      const cards = pageFor(ctx.html).productCards();
      if (cards.length < 2) return null; // nothing to compare

      // The first image on each card is its main photo; the second is often a
      // hover image of a different shape, which is deliberate.
      const ratios = cards
        .map((card) => card.querySelector("img[width][height]"))
        .map((img) => (img ? Number(img.getAttribute("width")) / Number(img.getAttribute("height")) : NaN))
        .filter((ratio) => Number.isFinite(ratio) && ratio > 0);

      // Without size attributes the shapes are unknown — which is not a pass.
      if (ratios.length < 2) return UNCHECKED;

      const min = Math.min(...ratios);
      const max = Math.max(...ratios);
      if ((max - min) / min <= RATIO_TOLERANCE) return null;

      return {
        ruleId: "coll.image.consistency",
        page: "collection",
        severity: "medium",
        title: "Product card images have mixed shapes",
        evidence: {
          type: "text",
          value: `Width ÷ height ranges from ${min.toFixed(2)} to ${max.toFixed(2)} across ${ratios.length} card images`,
        },
      };
    },
  },

  {
    id: "coll.description",
    page: "collection",
    severity: "low",
    description: "Collection has description text",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const description = page.all(
        '[class*="collection-hero__description"], [class*="collection__description"], [class*="collection-description"], [class*="collection-header"] .rte, [class*="collection-hero"] .rte',
        page.main,
      );
      if (description.some((element) => page.text(element).split(" ").length >= 5)) return null;

      return {
        ruleId: "coll.description",
        page: "collection",
        severity: "low",
        title: "Collection page has no description",
        evidence: {
          type: "text",
          value: "No collection description is shown above the products",
        },
      };
    },
  },

  {
    id: "coll.empty",
    page: "collection",
    severity: "high",
    description: "Published collection with no products",
    check: (ctx: RuleContext): RuleResult => {
      if (pageFor(ctx.html).productCards().length > 0) return null;

      return {
        ruleId: "coll.empty",
        page: "collection",
        severity: "high",
        title: "Collection is published with no products",
        evidence: { type: "text", value: "The collection page shows no product cards" },
      };
    },
  },
];

export default collectionRules;
