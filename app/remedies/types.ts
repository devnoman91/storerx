/**
 * How a merchant acts on an issue.
 *
 * StoreRx never writes to the store. It detects a problem, explains it,
 * recommends the best solution, and then sends the merchant to the right
 * place to make the change themselves. What "the right place" is depends on
 * the issue, so every rule declares one of these — and the UI reads it to
 * decide which actions to offer.
 */
export type RemedyKind =
  /** Editable Shopify data (product copy, SEO fields, alt text, collections). */
  | "admin"
  /** A Shopify setting — checkout, payments, shipping, installed apps. */
  | "settings"
  /** Storefront structure: a section, block or template in the theme editor. */
  | "theme"
  /** Copy, positioning and messaging judgement — no single field to edit. */
  | "messaging";

/**
 * Concrete copy StoreRx can draft for the merchant to review and paste.
 * Only ever generated on request, one item at a time.
 */
export type SuggestionKind = "alt_text" | "seo_title" | "seo_meta" | "product_description";

/** Which part of Shopify admin an issue is resolved in. */
export type AdminArea = "product" | "collection" | "settings" | "theme";

/** Shopify settings pages StoreRx links to. */
export type SettingsPage = "checkout" | "payments" | "shipping" | "apps";

export interface RuleRemedy {
  kind: RemedyKind;
  area?: AdminArea;
  /**
   * Static destination for settings and theme remedies: a settings page slug
   * or a theme template name. Resource-scoped remedies (a product, a
   * collection) resolve their reference from the finding instead.
   */
  ref?: string;
  /** Copy StoreRx can draft for this issue, when the merchant asks for it. */
  suggestion?: SuggestionKind;
}
