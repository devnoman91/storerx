/**
 * Product page rules
 * The heaviest rule set - core to conversion
 */

import type { Rule, RuleContext, Finding, ProductData } from "./types";

// Helper to check if element exists above fold (first 800px on mobile)
function isAboveFold(html: string, selector: string): boolean {
  // In real implementation, we'd use the DOM + computed positions
  // For now, check if element appears in first portion of HTML
  const match = html.match(new RegExp(selector, "i"));
  if (!match) return false;
  // Rough heuristic: if it's in the first 30% of HTML, likely above fold
  return match.index! < html.length * 0.3;
}

// Helper to check if element exists
function hasElement(html: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp(p, "i").test(html));
}

// Helper to count words in HTML (strips tags)
function countWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.split(" ").length : 0;
}

export const productRules: Rule[] = [
  {
    id: "prod.reviews.fold",
    page: "product",
    severity: "high",
    description: "Reviews/rating visible above the fold",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const reviewPatterns = [
        "review",
        "rating",
        "stars?",
        "yotpo",
        "judge\\.me",
        "stamped",
        "loox",
        "junip",
        "okendo",
      ];

      const hasReviews = hasElement(ctx.html, reviewPatterns);
      if (!hasReviews) {
        return {
          ruleId: "prod.reviews.fold",
          page: "product",
          severity: "high",
          title: "Product pages lack reviews above the fold",
          evidence: { type: "text", value: "No reviews widget detected" },
          fixableByAI: false,
        };
      }

      // Check if above fold
      if (!isAboveFold(ctx.html, "review|rating|stars")) {
        return {
          ruleId: "prod.reviews.fold",
          page: "product",
          severity: "high",
          title: "Reviews are below the fold on mobile",
          evidence: { type: "text", value: "Reviews found but not visible immediately" },
          fixableByAI: false,
        };
      }

      return null;
    },
  },

  {
    id: "prod.cta.sticky",
    page: "product",
    severity: "medium",
    description: "Sticky add-to-cart on mobile",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const stickyPatterns = [
        "position:\\s*sticky",
        "position:\\s*fixed",
        "sticky-add-to-cart",
        "sticky-atc",
        "fixed-add-to-cart",
      ];

      // Check for sticky ATC patterns
      if (!hasElement(ctx.html, stickyPatterns)) {
        return {
          ruleId: "prod.cta.sticky",
          page: "product",
          severity: "medium",
          title: "Mobile add-to-cart button is below the fold",
          evidence: { type: "text", value: "No sticky add-to-cart detected" },
          fixableByAI: false,
        };
      }

      return null;
    },
  },

  {
    id: "prod.price.near.cta",
    page: "product",
    severity: "high",
    description: "Price, variants, stock, delivery info near CTA",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      // Check if price is present
      const pricePatterns = ["price", "\\$\\d+", "€\\d+", "£\\d+"];
      if (!hasElement(ctx.html, pricePatterns)) {
        return {
          ruleId: "prod.price.near.cta",
          page: "product",
          severity: "high",
          title: "Price not visible near add-to-cart button",
          evidence: { type: "text", value: "Price element not found near CTA" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },

  {
    id: "prod.desc.short",
    page: "product",
    severity: "medium",
    description: "Description is too short (< 80 words)",
    fixableByAI: true,
    fixType: "product_description",
    check: (ctx: RuleContext): Finding | null => {
      // Extract product description (look for common patterns)
      const descPatterns = [
        /<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*class="[^"]*product-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*id="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      ];

      let descHtml = "";
      for (const pattern of descPatterns) {
        const match = ctx.html.match(pattern);
        if (match) {
          descHtml = match[1];
          break;
        }
      }

      if (!descHtml) return null; // Can't find description

      const wordCount = countWords(descHtml);
      if (wordCount < 80) {
        return {
          ruleId: "prod.desc.short",
          page: "product",
          severity: "medium",
          title: `Product description is too short (${wordCount} words)`,
          evidence: { type: "text", value: `Only ${wordCount} words, recommend 80+ for SEO and conversion` },
          fixableByAI: true,
          fixType: "product_description",
        };
      }

      return null;
    },
  },

  {
    id: "prod.desc.long",
    page: "product",
    severity: "low",
    description: "Description is too long (> 600 words) with no structure",
    fixableByAI: true,
    fixType: "product_description",
    check: (ctx: RuleContext): Finding | null => {
      const descPatterns = [
        /<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      ];

      let descHtml = "";
      for (const pattern of descPatterns) {
        const match = ctx.html.match(pattern);
        if (match) {
          descHtml = match[1];
          break;
        }
      }

      if (!descHtml) return null;

      const wordCount = countWords(descHtml);
      const hasStructure = /<(h[2-6]|ul|ol|table)/i.test(descHtml);

      if (wordCount > 600 && !hasStructure) {
        return {
          ruleId: "prod.desc.long",
          page: "product",
          severity: "low",
          title: "Product description is long without structure",
          evidence: { type: "text", value: `${wordCount} words with no headings or lists` },
          fixableByAI: true,
          fixType: "product_description",
        };
      }

      return null;
    },
  },

  {
    id: "prod.faq",
    page: "product",
    severity: "medium",
    description: "FAQ / size guide / shipping & returns section",
    fixableByAI: true,
    fixType: "faq_block",
    check: (ctx: RuleContext): Finding | null => {
      const faqPatterns = [
        "faq",
        "frequently asked",
        "size guide",
        "sizing",
        "shipping.*returns",
        "returns.*shipping",
        "accordion",
      ];

      if (!hasElement(ctx.html, faqPatterns)) {
        return {
          ruleId: "prod.faq",
          page: "product",
          severity: "medium",
          title: "Product page lacks FAQ or size guide section",
          evidence: { type: "text", value: "No FAQ, size guide, or shipping info found" },
          fixableByAI: true,
          fixType: "faq_block",
        };
      }

      return null;
    },
  },

  {
    id: "prod.trust.badges",
    page: "product",
    severity: "medium",
    description: "Trust badges near CTA",
    fixableByAI: true,
    fixType: "trust_badges",
    check: (ctx: RuleContext): Finding | null => {
      const trustPatterns = [
        "trust-badge",
        "guarantee",
        "secure.*checkout",
        "free.*shipping",
        "money.*back",
        "ssl",
        "verified",
        "100%.*satisfaction",
      ];

      if (!hasElement(ctx.html, trustPatterns)) {
        return {
          ruleId: "prod.trust.badges",
          page: "product",
          severity: "medium",
          title: "No trust badges near add-to-cart button",
          evidence: { type: "text", value: "Trust badges help reduce purchase anxiety" },
          fixableByAI: true,
          fixType: "trust_badges",
        };
      }

      return null;
    },
  },

  {
    id: "prod.crosssell",
    page: "product",
    severity: "medium",
    description: "Cross-sells / related products / bundles",
    fixableByAI: true,
    fixType: "crosssells",
    check: (ctx: RuleContext): Finding | null => {
      const crosssellPatterns = [
        "related.*product",
        "you.*may.*also.*like",
        "frequently.*bought",
        "complete.*the.*look",
        "pair.*with",
        "bundle",
        "cross-sell",
        "upsell",
        "recommendations",
      ];

      if (!hasElement(ctx.html, crosssellPatterns)) {
        return {
          ruleId: "prod.crosssell",
          page: "product",
          severity: "medium",
          title: "No cross-sells or related products shown",
          evidence: { type: "text", value: "Cross-sells increase average order value" },
          fixableByAI: true,
          fixType: "crosssells",
        };
      }

      return null;
    },
  },

  {
    id: "prod.variants.oos",
    page: "product",
    severity: "high",
    description: "Out-of-stock variants not marked",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      // Check if there are variant selectors without OOS indication
      const hasVariants = hasElement(ctx.html, ["variant", "option.*selector", "swatch"]);
      const hasOosIndicator = hasElement(ctx.html, [
        "sold.*out",
        "out.*of.*stock",
        "unavailable",
        "disabled.*variant",
        "variant.*disabled",
      ]);

      // If has variants but no OOS indicators, flag it
      // Note: This is a heuristic - real implementation would check actual inventory
      if (hasVariants && !hasOosIndicator) {
        // Only flag if we detect potential OOS scenario (need shop data)
        if (ctx.shopData?.products?.[0]?.variants?.some((v) => !v.available)) {
          return {
            ruleId: "prod.variants.oos",
            page: "product",
            severity: "high",
            title: "Out-of-stock variants not clearly marked",
            evidence: { type: "text", value: "Customers may try to add unavailable items" },
            fixableByAI: false,
          };
        }
      }

      return null;
    },
  },

  {
    id: "prod.seo.title",
    page: "product",
    severity: "medium",
    description: "SEO title missing or > 60 chars",
    fixableByAI: true,
    fixType: "seo_title",
    check: (ctx: RuleContext): Finding | null => {
      const titleMatch = ctx.html.match(/<title[^>]*>(.*?)<\/title>/i);
      const seoTitle = titleMatch ? titleMatch[1].trim() : "";

      if (!seoTitle) {
        return {
          ruleId: "prod.seo.title",
          page: "product",
          severity: "medium",
          title: "SEO title is missing",
          evidence: { type: "text", value: "No <title> tag found" },
          fixableByAI: true,
          fixType: "seo_title",
        };
      }

      if (seoTitle.length > 60) {
        return {
          ruleId: "prod.seo.title",
          page: "product",
          severity: "medium",
          title: `SEO title is too long (${seoTitle.length} chars)`,
          evidence: { type: "text", value: `"${seoTitle.substring(0, 50)}..." - truncated in search results` },
          fixableByAI: true,
          fixType: "seo_title",
        };
      }

      return null;
    },
  },

  {
    id: "prod.seo.meta",
    page: "product",
    severity: "medium",
    description: "Meta description missing or > 160 chars",
    fixableByAI: true,
    fixType: "seo_meta",
    check: (ctx: RuleContext): Finding | null => {
      const metaMatch = ctx.html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
      const metaDesc = metaMatch ? metaMatch[1].trim() : "";

      if (!metaDesc) {
        return {
          ruleId: "prod.seo.meta",
          page: "product",
          severity: "medium",
          title: "Meta description is missing",
          evidence: { type: "text", value: "No meta description found" },
          fixableByAI: true,
          fixType: "seo_meta",
        };
      }

      if (metaDesc.length > 160) {
        return {
          ruleId: "prod.seo.meta",
          page: "product",
          severity: "medium",
          title: `Meta description is too long (${metaDesc.length} chars)`,
          evidence: { type: "text", value: "Truncated in search results" },
          fixableByAI: true,
          fixType: "seo_meta",
        };
      }

      return null;
    },
  },

  {
    id: "prod.schema",
    page: "product",
    severity: "low",
    description: "Product structured data (JSON-LD) missing",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const hasProductSchema =
        /application\/ld\+json[^>]*>[\s\S]*?"@type"\s*:\s*"Product"/i.test(ctx.html);

      if (!hasProductSchema) {
        return {
          ruleId: "prod.schema",
          page: "product",
          severity: "low",
          title: "Product structured data (JSON-LD) is missing",
          evidence: { type: "text", value: "Rich snippets won't appear in search results" },
          fixableByAI: false,
        };
      }

      return null;
    },
  },
];

export default productRules;
