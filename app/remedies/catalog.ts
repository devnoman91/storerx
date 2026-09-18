/**
 * Where each rule's problem is actually resolved.
 *
 * Kept out of the rule files on purpose: a rule's job is to detect, and the
 * detection logic should not change when the place a merchant fixes something
 * moves. Every rule ID in app/rules must appear here — `tests/remedies` fails
 * the build if one is missing.
 */

import type { RuleRemedy } from "./types";

/** Product copy and SEO fields: editable in admin, and StoreRx can draft them. */
const productCopy = (suggestion: RuleRemedy["suggestion"]): RuleRemedy => ({
  kind: "admin",
  area: "product",
  suggestion,
});

const product: RuleRemedy = { kind: "admin", area: "product" };
const collection: RuleRemedy = { kind: "admin", area: "collection" };
const theme = (template?: string): RuleRemedy => ({ kind: "theme", area: "theme", ref: template });
const settings = (page: string): RuleRemedy => ({ kind: "settings", area: "settings", ref: page });
const messaging = (template?: string): RuleRemedy => ({
  kind: "messaging",
  area: "theme",
  ref: template,
});

export const RULE_REMEDIES: Record<string, RuleRemedy> = {
  // Homepage — storefront structure and messaging.
  "home.hero.cta": messaging("index"),
  "home.announcement": theme("index"),
  "home.featured": theme("index"),
  "home.trust": messaging("index"),
  "home.popups": theme("index"),
  "home.nav": theme("index"),
  "home.contact": theme("index"),

  // Collections — merchandising sits in admin, layout in the theme.
  "coll.filters": theme("collection"),
  "coll.card.price": theme("collection"),
  "coll.card.atc": theme("collection"),
  "coll.thin": collection,
  "coll.image.consistency": theme("collection"),
  "coll.description": collection,
  "coll.empty": collection,

  // Product pages — the heaviest split between admin data and theme layout.
  "prod.reviews.fold": theme("product"),
  "prod.cta.sticky": theme("product"),
  "prod.price.near.cta": theme("product"),
  "prod.desc.short": productCopy("product_description"),
  "prod.desc.long": productCopy("product_description"),
  "prod.faq": theme("product"),
  "prod.trust.badges": theme("product"),
  "prod.crosssell": theme("product"),
  "prod.variants.oos": product,
  "prod.seo.title": productCopy("seo_title"),
  "prod.seo.meta": productCopy("seo_meta"),
  "prod.schema": theme("product"),

  // Cart — all theme-level.
  "cart.drawer": theme("cart"),
  "cart.shipping.bar": theme("cart"),
  "cart.upsell": theme("cart"),
  "cart.trust": theme("cart"),
  "cart.discount.prominent": theme("cart"),
  "cart.express": theme("cart"),

  // Checkout — Shopify settings, not layout.
  "chk.express": settings("payments"),
  "chk.guest": settings("checkout"),

  // Images — the catalog lives in admin; only lazy-loading is the theme's job.
  "img.alt": { kind: "admin", area: "product", suggestion: "alt_text" },
  "img.size": product,
  "img.dims.large": product,
  "img.dims.small": product,
  "img.count": product,
  "img.ratio": product,
  "img.duplicate": product,
  "img.lazy": theme(),

  // Performance — theme work, except app weight, which is an app decision.
  "perf.score.low": theme(),
  "perf.lcp.slow": theme(),
  "perf.cls.high": theme(),
  "perf.tbt.high": theme(),
  "perf.inp.slow": theme(),
  "perf.js.weight": theme(),
  "perf.apps.weight": settings("apps"),
  "perf.apps.blocking": settings("apps"),
  "perf.render.blocking": theme(),
  "perf.fonts.count": theme(),
  "perf.image.weight": theme(),
};

/**
 * A rule with no entry is treated as advice rather than guessing at a
 * destination — a wrong "Edit in Shopify Admin" link is worse than none.
 */
export const DEFAULT_REMEDY: RuleRemedy = { kind: "messaging" };

export function remedyForRule(ruleId: string): RuleRemedy {
  return RULE_REMEDIES[ruleId] ?? DEFAULT_REMEDY;
}
