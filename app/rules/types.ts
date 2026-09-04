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

export interface RuleContext {
  /** Raw HTML of the page */
  html: string;
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
  lcp: number; // Largest Contentful Paint (ms)
  cls: number; // Cumulative Layout Shift
  inp: number; // Interaction to Next Paint (ms)
  tbt: number; // Total Blocking Time (ms)
  totalJsWeight: number; // bytes
  totalCssWeight: number; // bytes
  totalImageWeight: number; // bytes
  thirdPartyScripts: ThirdPartyScript[];
}

export interface ThirdPartyScript {
  url: string;
  size: number; // bytes
  blocking: boolean;
  appName?: string; // Matched app name if known
}

export interface ShopData {
  domain: string;
  products: ProductData[];
  collections: CollectionData[];
  checkoutSettings: CheckoutSettings;
  installedApps: string[];
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
  fileSize?: number; // bytes
}

export interface VariantData {
  id: string;
  title: string;
  available: boolean;
  price: string;
}

export interface CheckoutSettings {
  guestCheckoutEnabled: boolean;
  expressCheckoutEnabled: boolean;
  shopPayEnabled: boolean;
  applePayEnabled: boolean;
  googlePayEnabled: boolean;
  shippingOptionsCount: number;
  paymentMethodsCount: number;
  tippingEnabled: boolean;
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
  /** Can this be fixed automatically by AI? */
  fixableByAI: boolean;
  /** Fix type if fixable */
  fixType?: FixType;
  /** Target resource ID if applicable (product ID, image ID, etc.) */
  targetId?: string;
}

export type FixType =
  | "product_description"
  | "seo_title"
  | "seo_meta"
  | "alt_text"
  | "faq_block"
  | "trust_badges"
  | "cta_copy"
  | "crosssells"
  | "shipping_bar"
  | "image_compress";

export interface Rule {
  /** Unique rule ID: page.topic.detail */
  id: string;
  /** Which page type(s) this rule applies to */
  page: PageType | PageType[];
  /** Severity level */
  severity: Severity;
  /** Short description of what the rule checks */
  description: string;
  /** Check function: returns a Finding if issue detected, null if passed */
  check: (ctx: RuleContext) => Finding | null;
  /** Can this issue be fixed by AI? */
  fixableByAI: boolean;
  /** Fix type if fixable */
  fixType?: FixType;
}
