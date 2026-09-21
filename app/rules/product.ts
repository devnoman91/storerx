/**
 * Product page rules — the heaviest set, and the closest to the sale.
 *
 * "Near the buy button" means inside the section that holds the add-to-cart
 * form (Page.buyArea): themes group title, price, options and the button into
 * one section, so that is the purchase area. Static HTML carries no layout, so
 * no rule here claims something is "above the fold" or "on mobile".
 *
 * Rules about the product itself — its description, its variants — read that
 * product's Admin data through `ctx.resourceId` rather than scraping the page,
 * because the page may truncate, reformat or lazy-load what the admin holds.
 */

import { pageFor, type Page } from "./page";
import { UNCHECKED, type ProductData, type Rule, type RuleContext, type RuleResult } from "./types";

/**
 * Class names review and rating widgets render with. "preview" is excluded:
 * it contains "review" and is a common name for image previews.
 */
const REVIEW_CLASS = /(?<!p)review|rating|jdgm|yotpo|okendo|loox|stamped|junip|\bspr-|\bstars?\b/i;

/** Review apps, by the script they load. */
const REVIEW_APPS =
  /judge\.me|judgeme|yotpo\.com|okendo\.io|loox\.io|stamped\.io|junip\.co|reviews\.io|fera\.ai|alireviews|rivyo|productreviews\.shopifycdn/i;

/** Reassurance shoppers look for next to the button. */
const TRUST_TEXT =
  /guarantee|secure (checkout|payment)|free (shipping|delivery|returns?)|money[- ]?back|\d+[- ]day (returns?|guarantee|trial)|warranty|easy returns/i;

const FAQ_HEADING = /faq|frequently asked|questions|size (guide|chart)|sizing|shipping|delivery|returns?/i;

const CROSS_SELL_HEADING =
  /you may also like|related products|frequently bought|pairs? (well|with)|complete the look|recommended|goes well with/i;

/** Class or id naming a sticky add-to-cart bar — not a sticky header. */
const STICKY_ATC = /sticky[-_]?(atc|add|cart|buy)|(atc|add[-_]to[-_]cart|buy)[-_]?(bar[-_]?)?sticky/i;

function reviewWidgets(page: Page, within: Element): Element[] {
  return page
    .all("[class], [itemprop]", within)
    .filter(
      (element) =>
        element.getAttribute("itemprop") === "aggregateRating" ||
        REVIEW_CLASS.test(element.getAttribute("class") ?? ""),
    );
}

/** The product this page shows, from Admin data — never a guess. */
function productOf(ctx: RuleContext): ProductData | undefined {
  if (!ctx.resourceId) return undefined;
  return ctx.shopData?.products.find((product) => product.id === ctx.resourceId);
}

function wordCount(html: string): number {
  return html
    .replace(/<[^>]*>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * The product's description as HTML: from the admin when the scan knows which
 * product this is, otherwise from the page.
 */
function descriptionOf(ctx: RuleContext): string | null {
  const product = productOf(ctx);
  if (product) return product.descriptionHtml;

  const page = pageFor(ctx.html);
  const element = page.main.querySelector(
    '.product__description, [class*="product__description"], [class*="product-description"], [class*="product-single__description"], [itemprop="description"]',
  );
  return element ? element.innerHTML : null;
}

export const productRules: Rule[] = [
  {
    id: "prod.reviews.fold",
    page: "product",
    severity: "high",
    description: "Reviews near the buy button",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const widgets = reviewWidgets(page, page.main);
      const reviewApp = page.scriptSources.some((src) => REVIEW_APPS.test(src));
      const ratedInData = JSON.stringify(page.jsonLd).includes('"aggregateRating"');

      if (widgets.length === 0) {
        // A review app is installed, or the data says there are ratings, but
        // nothing is in the HTML: the widget draws itself after the page
        // opens, so where it lands can't be seen here.
        if (reviewApp || ratedInData) return UNCHECKED;
        return {
          ruleId: "prod.reviews.fold",
          page: "product",
          severity: "high",
          title: "Product pages show no reviews",
          evidence: {
            type: "text",
            value: "No reviews, star rating or review app was found on this product page",
          },
        };
      }

      const buyArea = page.buyArea;
      if (!buyArea) return UNCHECKED;
      if (widgets.some((widget) => buyArea.contains(widget))) return null;

      return {
        ruleId: "prod.reviews.fold",
        page: "product",
        severity: "high",
        title: "Reviews aren't shown near the buy button",
        evidence: {
          type: "text",
          value: "Reviews appear on the page, but not in the section with the price and add-to-cart button",
        },
      };
    },
  },

  {
    id: "prod.cta.sticky",
    page: "product",
    severity: "medium",
    description: "A sticky add-to-cart bar",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      if (!page.addToCartForm) return UNCHECKED;

      const sticky = page
        .all("[class], [id]")
        .some((element) => STICKY_ATC.test(`${element.getAttribute("class") ?? ""} ${element.id}`));
      if (sticky) return null;

      return {
        ruleId: "prod.cta.sticky",
        page: "product",
        severity: "medium",
        title: "No sticky add-to-cart bar on product pages",
        evidence: {
          type: "text",
          value: "Once a shopper scrolls past the add-to-cart button, nothing keeps it within reach",
        },
      };
    },
  },

  {
    id: "prod.price.near.cta",
    page: "product",
    severity: "high",
    description: "Price near the buy button",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const buyArea = page.buyArea;
      if (!buyArea) return UNCHECKED;
      if (page.hasPrice(buyArea)) return null;

      return {
        ruleId: "prod.price.near.cta",
        page: "product",
        severity: "high",
        title: "Price isn't shown near the add-to-cart button",
        evidence: {
          type: "text",
          value: "No price was found in the section with the add-to-cart button",
        },
      };
    },
  },

  {
    id: "prod.desc.short",
    page: "product",
    severity: "medium",
    description: "Description length",
    check: (ctx: RuleContext): RuleResult => {
      const html = descriptionOf(ctx);
      if (html === null) return UNCHECKED;

      const words = wordCount(html);
      if (words >= 80) return null;

      return {
        ruleId: "prod.desc.short",
        page: "product",
        severity: "medium",
        title: words === 0 ? "Product has no description" : `Product description is only ${words} words`,
        evidence: {
          type: "text",
          value: `${words} word${words === 1 ? "" : "s"}; 80 or more gives shoppers and search engines enough to go on`,
        },
      };
    },
  },

  {
    id: "prod.desc.long",
    page: "product",
    severity: "low",
    description: "Structure in a long description",
    check: (ctx: RuleContext): RuleResult => {
      const html = descriptionOf(ctx);
      if (html === null) return UNCHECKED;

      const words = wordCount(html);
      const structured = /<(h[2-6]|ul|ol|table)\b/i.test(html);
      if (words <= 600 || structured) return null;

      return {
        ruleId: "prod.desc.long",
        page: "product",
        severity: "low",
        title: "Product description is long and has no structure",
        evidence: { type: "text", value: `${words} words with no headings or lists to scan` },
      };
    },
  },

  {
    id: "prod.faq",
    page: "product",
    severity: "medium",
    description: "FAQ, size guide or shipping information",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const headings = page.all(
        'summary, h2, h3, h4, h5, [role="tab"], [class*="accordion" i] button, [class*="collapsible" i]',
        page.main,
      );
      if (headings.some((heading) => FAQ_HEADING.test(page.text(heading)))) return null;

      return {
        ruleId: "prod.faq",
        page: "product",
        severity: "medium",
        title: "Product page has no FAQ, size guide or shipping information",
        evidence: {
          type: "text",
          value: "No section heading mentions FAQs, sizing, shipping or returns",
        },
      };
    },
  },

  {
    id: "prod.trust.badges",
    page: "product",
    severity: "medium",
    description: "Reassurance near the buy button",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const buyArea = page.buyArea;
      if (!buyArea) return UNCHECKED;

      if (TRUST_TEXT.test(page.text(buyArea))) return null;
      if (page.has('[class*="trust" i]', buyArea)) return null;
      const badgeImage = page
        .all("img[alt]", buyArea)
        .some((img) => /secure|guarantee|trust|badge|payment/i.test(img.getAttribute("alt") ?? ""));
      if (badgeImage) return null;

      return {
        ruleId: "prod.trust.badges",
        page: "product",
        severity: "medium",
        title: "No reassurance near the add-to-cart button",
        evidence: {
          type: "text",
          value: "The purchase section mentions no guarantee, secure checkout, free shipping or easy returns",
        },
      };
    },
  },

  {
    id: "prod.crosssell",
    page: "product",
    severity: "medium",
    description: "Related products or cross-sells",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const section = page.has(
        'product-recommendations, complementary-products, [class*="related" i], [class*="recommend" i], [class*="upsell" i], [class*="cross-sell" i], [class*="complementary" i]',
        page.main,
      );
      if (section) return null;

      const heading = page
        .all("h2, h3, h4", page.main)
        .some((element) => CROSS_SELL_HEADING.test(page.text(element)));
      if (heading) return null;

      return {
        ruleId: "prod.crosssell",
        page: "product",
        severity: "medium",
        title: "No related products or cross-sells on product pages",
        evidence: {
          type: "text",
          value: "No recommendations section or related-products heading was found",
        },
      };
    },
  },

  {
    id: "prod.variants.oos",
    page: "product",
    severity: "high",
    description: "Sold-out variants are marked",
    check: (ctx: RuleContext): RuleResult => {
      const product = productOf(ctx);
      // Which product this page shows has to be known, or every page would
      // be judged against the same product.
      if (!product) return UNCHECKED;
      if (product.variants.length <= 1) return null;
      const soldOut = product.variants.filter((variant) => !variant.available);
      if (soldOut.length === 0) return null;

      const page = pageFor(ctx.html);
      const picker = page.all(
        'variant-selects, variant-radios, fieldset, select[name*="option" i], select[name="id"], [class*="variant" i], [class*="swatch" i]',
        page.main,
      );
      const marked = picker.some(
        (element) =>
          page.has('[disabled], .disabled, [class*="sold-out" i], [class*="unavailable" i], [class*="soldout" i]', element) ||
          /sold out|unavailable/i.test(page.text(element)),
      );
      if (marked) return null;

      return {
        ruleId: "prod.variants.oos",
        page: "product",
        severity: "high",
        title: "Sold-out variants aren't marked as unavailable",
        evidence: {
          type: "text",
          value: `${soldOut.length} of ${product.variants.length} variants are sold out, but the options on the page don't show which`,
        },
      };
    },
  },

  {
    id: "prod.seo.title",
    page: "product",
    severity: "medium",
    description: "SEO title length",
    check: (ctx: RuleContext): RuleResult => {
      const title = pageFor(ctx.html).doc.title.trim();

      if (!title) {
        return {
          ruleId: "prod.seo.title",
          page: "product",
          severity: "medium",
          title: "SEO title is missing",
          evidence: { type: "text", value: "The page has no <title>" },
        };
      }

      if (title.length <= 60) return null;
      return {
        ruleId: "prod.seo.title",
        page: "product",
        severity: "medium",
        title: `SEO title is ${title.length} characters`,
        evidence: {
          type: "text",
          value: `"${title}" — search results cut titles off after about 60 characters`,
        },
      };
    },
  },

  {
    id: "prod.seo.meta",
    page: "product",
    severity: "medium",
    description: "Meta description length",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const meta = page
        .all("meta[name]")
        .find((element) => element.getAttribute("name")?.toLowerCase() === "description");
      const description = meta?.getAttribute("content")?.trim() ?? "";

      if (!description) {
        return {
          ruleId: "prod.seo.meta",
          page: "product",
          severity: "medium",
          title: "Meta description is missing",
          evidence: { type: "text", value: "The page has no meta description, so search engines pick their own snippet" },
        };
      }

      if (description.length <= 160) return null;
      return {
        ruleId: "prod.seo.meta",
        page: "product",
        severity: "medium",
        title: `Meta description is ${description.length} characters`,
        evidence: {
          type: "text",
          value: `"${description.slice(0, 157)}…" — search results cut descriptions off after about 160 characters`,
        },
      };
    },
  },

  {
    id: "prod.schema",
    page: "product",
    severity: "low",
    description: "Product structured data",
    check: (ctx: RuleContext): RuleResult => {
      const page = pageFor(ctx.html);
      const types = page.structuredDataTypes();
      // ProductGroup is how products with variants are described; Google
      // accepts it, and current Dawn emits it rather than Product.
      if (types.has("Product") || types.has("ProductGroup")) return null;
      if (page.has('[itemtype*="schema.org/Product"]')) return null;

      return {
        ruleId: "prod.schema",
        page: "product",
        severity: "low",
        title: "Product structured data is missing",
        evidence: {
          type: "text",
          value: types.size
            ? `The page describes itself as ${[...types].join(", ")}, but not as a Product`
            : "The page has no structured data, so search results can't show price or availability",
        },
      };
    },
  },
];

export default productRules;
