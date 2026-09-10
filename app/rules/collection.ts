/**
 * Collection page rules
 */

import type { Rule, RuleContext, Finding } from "./types";

function hasElement(html: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(p, "i").test(html));
}

export const collectionRules: Rule[] = [
  {
    id: "coll.filters",
    page: "collection",
    severity: "medium",
    description: "Filter + sort available",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const filterPatterns = ["filter", "facet", "refine"];
      const sortPatterns = ["sort", "order.*by"];

      const hasFilter = hasElement(ctx.html, filterPatterns);
      const hasSort = hasElement(ctx.html, sortPatterns);

      if (!hasFilter || !hasSort) {
        return {
          ruleId: "coll.filters",
          page: "collection",
          severity: "medium",
          title: "Collection lacks filtering or sorting options",
          evidence: {
            type: "text",
            value: `Missing: ${!hasFilter ? "filters" : ""}${!hasFilter && !hasSort ? " and " : ""}${!hasSort ? "sort" : ""}`,
          },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "coll.card.price",
    page: "collection",
    severity: "high",
    description: "Price visible on product cards",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const pricePatterns = ["price", "\\$\\d+", "€\\d+", "£\\d+"];
      const cardPatterns = ["product-card", "collection-product", "grid-item"];

      const hasCards = hasElement(ctx.html, cardPatterns);
      const hasPrice = hasElement(ctx.html, pricePatterns);

      if (hasCards && !hasPrice) {
        return {
          ruleId: "coll.card.price",
          page: "collection",
          severity: "high",
          title: "Product cards missing visible prices",
          evidence: { type: "text", value: "Price visibility is essential for browsing" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "coll.card.atc",
    page: "collection",
    severity: "low",
    description: "Quick add-to-cart on cards",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const quickAddPatterns = [
        "quick.*add",
        "add-to-cart.*card",
        "quick-shop",
        "quick-buy",
        "instant.*add",
      ];

      if (!hasElement(ctx.html, quickAddPatterns)) {
        return {
          ruleId: "coll.card.atc",
          page: "collection",
          severity: "low",
          title: "No quick add-to-cart on product cards",
          evidence: { type: "text", value: "Quick add reduces clicks to purchase" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "coll.thin",
    page: "collection",
    severity: "medium",
    description: "Collection has < 4 products",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      // Count product cards
      const cardMatches = ctx.html.match(/product-card|product-item|grid-item/gi) || [];
      const productCount = cardMatches.length;

      if (productCount > 0 && productCount < 4) {
        return {
          ruleId: "coll.thin",
          page: "collection",
          severity: "medium",
          title: `Collection has only ${productCount} products`,
          evidence: { type: "text", value: "Thin collections feel incomplete to shoppers" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "coll.image.consistency",
    page: "collection",
    severity: "medium",
    description: "Card images have mixed aspect ratios",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      // This would need actual image analysis
      // For now, check if aspect-ratio CSS is enforced
      const hasAspectRatio = hasElement(ctx.html, [
        "aspect-ratio",
        "padding-top.*%",
        "object-fit.*cover",
      ]);

      if (!hasAspectRatio) {
        return {
          ruleId: "coll.image.consistency",
          page: "collection",
          severity: "medium",
          title: "Product images may have inconsistent aspect ratios",
          evidence: { type: "text", value: "Consistent images look more professional" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "coll.description",
    page: "collection",
    severity: "low",
    description: "Collection has description (SEO)",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const descPatterns = [
        "collection-description",
        "collection__description",
        "category-description",
      ];

      if (!hasElement(ctx.html, descPatterns)) {
        return {
          ruleId: "coll.description",
          page: "collection",
          severity: "low",
          title: "Collection page lacks description text",
          evidence: { type: "text", value: "Descriptions help SEO and guide shoppers" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "coll.empty",
    page: "collection",
    severity: "high",
    description: "Empty collections published",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const emptyPatterns = [
        "no.*products",
        "collection.*empty",
        "0.*products",
        "nothing.*here",
      ];

      if (hasElement(ctx.html, emptyPatterns)) {
        return {
          ruleId: "coll.empty",
          page: "collection",
          severity: "high",
          title: "Empty collection is published",
          evidence: { type: "text", value: "Empty pages hurt SEO and frustrate visitors" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },
];

export default collectionRules;
