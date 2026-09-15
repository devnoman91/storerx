/**
 * Scan scopes: what each kind of scan fetches and which rules it runs.
 *
 * A merchant can scan one area — the homepage, product pages, SEO, images —
 * instead of the whole store. A scoped scan only fetches what its rules need
 * and only sends its own findings to the LLM, so it costs less time and fewer
 * tokens. It also only opens or closes issues for the rules it actually ran
 * (see app/issues/reconcile.ts).
 */

export type ScanScope = "full" | "homepage" | "product" | "collection" | "seo" | "images" | "alt";

export type StorefrontArea = "homepage" | "collection" | "product";

export interface ScopeSpec {
  label: string;
  description: string;
  /** Storefront page types to fetch. Needs the storefront password on locked stores. */
  pages: StorefrontArea[];
  /** Read catalog image metadata through the Admin API (no storefront access). */
  catalogImages: boolean;
  /** Run PageSpeed Insights. */
  performance: boolean;
  /** Run checkout settings rules (Admin API). */
  checkout: boolean;
  includesRule: (ruleId: string) => boolean;
}

/** SEO rules live on product and collection pages but belong to the SEO scan. */
const SEO_RULES: ReadonlySet<string> = new Set([
  "prod.seo.title",
  "prod.seo.meta",
  "prod.schema",
  "coll.description",
]);

const ALT_TEXT_RULES: ReadonlySet<string> = new Set(["img.alt"]);

export const SCAN_SCOPES: Record<ScanScope, ScopeSpec> = {
  full: {
    label: "Full scan",
    description: "Every check: pages, SEO, images, speed and checkout",
    pages: ["homepage", "collection", "product"],
    catalogImages: true,
    performance: true,
    checkout: true,
    includesRule: () => true,
  },
  homepage: {
    label: "Homepage",
    description: "Conversion checks on your homepage",
    pages: ["homepage"],
    catalogImages: false,
    performance: false,
    checkout: false,
    includesRule: (id) => id.startsWith("home."),
  },
  product: {
    label: "Product pages",
    description: "Conversion checks on your top product pages",
    pages: ["product"],
    catalogImages: false,
    performance: false,
    checkout: false,
    includesRule: (id) => id.startsWith("prod.") && !SEO_RULES.has(id),
  },
  collection: {
    label: "Collections",
    description: "Conversion checks on your largest collections",
    pages: ["collection"],
    catalogImages: false,
    performance: false,
    checkout: false,
    includesRule: (id) => id.startsWith("coll.") && !SEO_RULES.has(id),
  },
  seo: {
    label: "SEO",
    description: "Page titles, meta descriptions, structured data, collection text",
    pages: ["product", "collection"],
    catalogImages: false,
    performance: false,
    checkout: false,
    includesRule: (id) => SEO_RULES.has(id),
  },
  images: {
    label: "Images",
    description: "File size, dimensions, image count, proportions, duplicates",
    pages: [],
    catalogImages: true,
    performance: false,
    checkout: false,
    includesRule: (id) => id.startsWith("img.") && !ALT_TEXT_RULES.has(id),
  },
  alt: {
    label: "Alt text",
    description: "Images missing alt text",
    pages: [],
    catalogImages: true,
    performance: false,
    checkout: false,
    includesRule: (id) => ALT_TEXT_RULES.has(id),
  },
};

export const SCAN_SCOPE_ORDER: ScanScope[] = [
  "full",
  "homepage",
  "product",
  "collection",
  "seo",
  "images",
  "alt",
];

export function isScanScope(value: unknown): value is ScanScope {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SCAN_SCOPES, value);
}

/** Whether this scope needs storefront HTML (and so the storefront password). */
export function needsStorefront(scope: ScanScope): boolean {
  return SCAN_SCOPES[scope].pages.length > 0;
}
