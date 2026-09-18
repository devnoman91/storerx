/**
 * Rule types for StoreRx audit engine
 *
 * Rule IDs follow the pattern: page.topic.detail
 * e.g., prod.reviews.fold, cart.shipping.bar
 */

export type PageType = "homepage" | "collection" | "product" | "cart" | "checkout" | "images" | "perf";

export type Severity = "high" | "medium" | "low";

export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  high: 10,
  medium: 5,
  low: 2,
};

/**
 * What a rule returns when it could not look at what it checks — an empty
 * cart has no checkout button to put trust badges beside. Distinct from
 * `null`, which means "checked, and it passed": a passing check resolves an
 * open issue and counts towards a category's coverage, and an unchecked one
 * must do neither.
 */
export const UNCHECKED = Symbol.for("storerx.rule.unchecked");
export type Unchecked = typeof UNCHECKED;

export type RuleResult = Finding | null | Unchecked;

export interface RuleContext {
  /** Raw HTML of the page */
  html: string;
  /**
   * Admin GID of the product or collection this page shows, when the scan
   * knows it. Lets product rules read that product's own data rather than
   * guessing which one the page is about.
   */
  resourceId?: string;
  /** Parsed DOM (if needed) */
  document?: Document;
  /** Mobile screenshot path */
  mobileScreenshot?: string;
  /** Desktop screenshot path */
  desktopScreenshot?: string;
  /** Lighthouse metrics */
  lighthouse?: LighthouseMetrics;
  /** Shop admin data */
  shopData?: ShopData;
}

export interface LighthouseMetrics {
  performanceScore: number;
  lcp: number; // Largest Contentful Paint (seconds)
  cls: number; // Cumulative Layout Shift
  /**
   * Interaction to Next Paint (ms). Only available as CrUX field data, so it
   * is undefined for stores with too little traffic — rules must treat
   * undefined as "unknown", never as "good".
   */
  inp?: number;
  tbt: number; // Total Blocking Time (ms)
  totalJsWeight: number; // bytes
  totalCssWeight: number; // bytes
  totalImageWeight: number; // bytes
  /** Number of render-blocking resources. */
  renderBlockingCount: number;
  /** Number of font files requested. */
  fontCount: number;
  thirdPartyScripts: ThirdPartyScript[];
}

export interface ThirdPartyScript {
  /** Script URL, or the entity name when Lighthouse groups by entity. */
  url: string;
  size: number; // transfer size in bytes
  blocking: boolean;
  /** Main-thread blocking time in ms. */
  blockingTimeMs: number;
  appName?: string; // Matched app name if known
}

export interface ShopData {
  domain: string;
  products: ProductData[];
  collections: CollectionData[];
  checkoutSettings: CheckoutSettings;
  installedApps: string[];
  /**
   * Storefront is behind Shopify's password page. Development stores always
   * are, and cannot turn it off without a paid plan.
   */
  passwordProtected: boolean;
}

export interface ProductData {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  descriptionWordCount: number;
  images: ImageData[];
  hasReviews: boolean;
  reviewCount?: number;
  reviewRating?: number;
  variants: VariantData[];
  seoTitle?: string;
  seoDescription?: string;
  hasStructuredData: boolean;
}

export interface CollectionData {
  id: string;
  title: string;
  handle: string;
  productCount: number;
  hasDescription: boolean;
  hasFilters: boolean;
}

export interface ImageData {
  id: string;
  url: string;
  altText?: string;
  width: number;
  height: number;
  fileSize?: number; // bytes, of the original upload
  mimeType?: string;
}

export interface VariantData {
  id: string;
  title: string;
  available: boolean;
  price: string;
}

/**
 * Checkout settings, limited to what the Admin API actually reports.
 *
 * Shipping rates need an extra scope, and payment gateways and tipping are not
 * exposed at all. Rules for those used to run against hardcoded placeholder
 * values — one fired for every store, two could never fire — so they were
 * retired rather than kept on guesses.
 */
export interface CheckoutSettings {
  /** Customers can check out without logging in (`customerAccountsV2`). */
  guestCheckoutEnabled: boolean;
  /**
   * Wallets the shop's payment setup *supports* (`supportedDigitalWallets`).
   * Shopify does not report whether each is switched on, so rules must not
   * claim a wallet is enabled or disabled.
   */
  shopPaySupported: boolean;
  applePaySupported: boolean;
  googlePaySupported: boolean;
}

export interface Finding {
  /** Rule ID: page.topic.detail */
  ruleId: string;
  /** Which page type this applies to */
  page: PageType;
  /** Severity level */
  severity: Severity;
  /** Short title for the issue */
  title: string;
  /** Evidence: selector, text snippet, or screenshot crop path */
  evidence?: {
    type: "selector" | "text" | "screenshot";
    value: string;
  };
  /**
   * The resource this is edited on in Shopify admin, when the rule knows it —
   * an image finding is edited on its product, not on the image itself.
   * Where it is edited at all comes from app/remedies/catalog.ts.
   */
  adminRef?: string;
  /** Target resource ID if applicable (product ID, image ID, etc.) */
  targetId?: string;
  /**
   * Storefront URL the rule ran against. Set by the audit for page rules;
   * catalog rules (images) set it to the affected product's page.
   */
  pageUrl?: string;
  /** Human label for targetId, when the rule already knows it. */
  targetTitle?: string;
  /** CDN URL of the affected image, so the UI can show a thumbnail. */
  imageUrl?: string;
}

export interface Rule {
  /** Unique rule ID: page.topic.detail */
  id: string;
  /** Which page type(s) this rule applies to */
  page: PageType | PageType[];
  /** Severity level */
  severity: Severity;
  /** Short description of what the rule checks */
  description: string;
  /**
   * Returns a Finding when the problem is present, null when the check
   * passed, and UNCHECKED when the page did not contain what the check needs.
   */
  check: (ctx: RuleContext) => RuleResult;
}
