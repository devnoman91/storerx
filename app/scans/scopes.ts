/**
 * Scan scopes: what each kind of scan fetches and which rules it runs.
 *
 * A store is scanned one area at a time — the homepage, product pages, SEO,
 * images, speed — never all at once. Each scan only fetches what its rules
 * need and only sends its own findings to the LLM, so it costs little time and
 * few tokens, and it only opens or closes issues for the rules it actually ran
 * (see app/issues/reconcile.ts). Between them the areas cover every rule.
 */

export type ScanScope =
  | "homepage"
  | "product"
  | "collection"
  | "seo"
  | "images"
  | "alt"
  | "speed"
  | "checkout"
  /** Retired: scans recorded before the store was scanned area by area. */
  | "full";

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
  // Retired. Kept so scans recorded before per-area scanning still read back.
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
  speed: {
    label: "Speed",
    description: "Loading speed, layout shift and app weight, measured by Google PageSpeed",
    pages: [],
    catalogImages: false,
    performance: true,
    checkout: false,
    includesRule: (id) => id.startsWith("perf."),
  },
  checkout: {
    label: "Checkout",
    description: "Express payments, guest checkout, shipping and payment options",
    pages: [],
    catalogImages: false,
    performance: false,
    checkout: true,
    includesRule: (id) => id.startsWith("chk."),
  },
};

/** The areas a merchant can scan, in the order they are offered. */
export const SCAN_SCOPE_ORDER: ScanScope[] = [
  "homepage",
  "product",
  "collection",
  "seo",
  "images",
  "alt",
  "speed",
  "checkout",
];

export function isScanScope(value: unknown): value is ScanScope {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SCAN_SCOPES, value);
}

/** Scopes a scan can be requested for. "full" is kept only to read old scans. */
export function isSelectableScope(value: unknown): value is ScanScope {
  return isScanScope(value) && SCAN_SCOPE_ORDER.includes(value);
}

/** Whether this scope needs storefront HTML (and so the storefront password). */
export function needsStorefront(scope: ScanScope): boolean {
  return SCAN_SCOPES[scope].pages.length > 0;
}
