/**
 * A storefront page, parsed once, for rules to query.
 *
 * Rules used to run regular expressions over the raw HTML — head, scripts and
 * CSS included — so a meta tag's `secure_url` counted as a trust badge and a
 * script variable named `isSearchTemplate` counted as a search bar. This parses
 * the page with a spec-compliant HTML5 parser, keeps the few things rules need
 * from scripts (external script hosts, JSON-LD), then removes scripts, styles
 * and templates so that text matching only sees what a shopper can read.
 *
 * It cannot see layout: whether something is "above the fold" depends on CSS
 * and screen size, which static HTML does not carry. Rules use document
 * structure instead — "in the same section as the add-to-cart form", "the
 * first section of the page" — and say so in their wording.
 */

import { createRequire } from "node:module";
import type { JSDOM } from "jsdom";

/**
 * jsdom, loaded on first use. The web server imports the rule set (scoring
 * counts checks per category) but never parses a page; a top-level import made
 * every web process pay ~700ms and ~48MB at startup for a parser only the
 * worker uses.
 */
let jsdom: typeof import("jsdom") | null = null;
function loadJsdom(): typeof import("jsdom") {
  jsdom ??= createRequire(import.meta.url)("jsdom") as typeof import("jsdom");
  return jsdom;
}

/** Elements whose text a shopper never reads. */
const INVISIBLE = "script, style, noscript, template";

/** Containers that hold one product card in a grid. */
const CARD = 'li, article, .card-wrapper, .grid__item, [class*="product-card"], [class*="product-item"]';

/** A price: a currency symbol beside digits, or digits with a currency code. */
const MONEY = /(?:[$€£¥₹]|Rs\.?|kr|zł)\s?\d|\d[\d.,]*\s?(?:USD|EUR|GBP|CAD|AUD|INR|PKR)\b/i;

export class Page {
  readonly doc: Document;
  /** `<main>`, or the body when a theme has none. */
  readonly main: Element;
  /** Hosts of every external script — how installed apps show up in HTML. */
  readonly scriptSources: string[];
  /** Every parsed JSON-LD block. Unparseable blocks are skipped. */
  readonly jsonLd: unknown[];

  private readonly window: JSDOM["window"];
  private readonly texts = new WeakMap<Element, string>();

  constructor(html: string) {
    // A silent console: themes ship CSS jsdom cannot parse, which is noise.
    const { JSDOM, VirtualConsole } = loadJsdom();
    const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
    this.window = dom.window;
    this.doc = dom.window.document;

    this.scriptSources = [...this.doc.querySelectorAll("script[src]")]
      .map((script) => script.getAttribute("src") ?? "")
      .filter(Boolean);

    this.jsonLd = [];
    for (const script of this.doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        this.jsonLd.push(JSON.parse(script.textContent ?? ""));
      } catch {
        // A broken block is the theme's problem, not grounds to fail the page.
      }
    }

    for (const element of this.doc.querySelectorAll(INVISIBLE)) element.remove();

    this.main = this.doc.querySelector("main") ?? this.doc.body ?? this.doc.documentElement;
  }

  /**
   * Readable text of an element, whitespace-collapsed. Text nodes are joined
   * with spaces — `textContent` runs "Price" and "Sale" together as
   * "PriceSale", which breaks word matching.
   */
  text(element: Element | null | undefined = this.main): string {
    if (!element) return "";
    const cached = this.texts.get(element);
    if (cached !== undefined) return cached;

    const parts: string[] = [];
    const walker = this.doc.createTreeWalker(element, this.window.NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue?.trim();
      if (value) parts.push(value);
    }
    const text = parts.join(" ").replace(/\s+/g, " ");
    this.texts.set(element, text);
    return text;
  }

  all(selector: string, within: ParentNode = this.doc): Element[] {
    return [...within.querySelectorAll(selector)];
  }

  has(selector: string, within: ParentNode = this.doc): boolean {
    return within.querySelector(selector) !== null;
  }

  /** The page's `<header>`, if the theme marks one up. */
  get header(): Element | null {
    return this.doc.querySelector("header");
  }

  /** The page's footer: a `<footer>`, else a footer-named section. */
  get footer(): Element | null {
    return this.doc.querySelector("footer") ?? this.doc.querySelector('[class*="footer"], [id*="footer"]');
  }

  /**
   * The add-to-cart form in the main content. Carts, quick-add modals and
   * recommendation cards can hold their own forms; those are not the product
   * being sold on this page.
   */
  get addToCartForm(): Element | null {
    return this.main.querySelector('form[action*="/cart/add"]');
  }

  /**
   * The section around the add-to-cart form — what "near the buy button"
   * means here. Themes group title, price, options and the button into one
   * section, so the closest section is the purchase area.
   */
  get buyArea(): Element | null {
    const form = this.addToCartForm;
    if (!form) return null;
    return form.closest('.shopify-section, section, [class*="product__info"], [class*="product-info"]') ?? form;
  }

  /** The first section of the main content: what a visitor meets first. */
  get firstSection(): Element | null {
    return (
      this.main.querySelector(".shopify-section, section") ?? this.main.firstElementChild ?? null
    );
  }

  /** Whether an element's readable text includes a price. */
  hasPrice(element: Element): boolean {
    return this.has('.price, [class*="price"], .money', element) || MONEY.test(this.text(element));
  }

  /**
   * Product cards in the main content, one per product. Found from links to
   * product pages rather than theme class names, so it works on any theme.
   */
  productCards(): Element[] {
    const cards = new Map<string, Element>();
    for (const link of this.main.querySelectorAll('a[href*="/products/"]')) {
      const handle = productHandle(link.getAttribute("href"));
      if (!handle || cards.has(handle)) continue;
      cards.set(handle, link.closest(CARD) ?? link.parentElement ?? link);
    }
    return [...cards.values()];
  }

  /** Every `@type` in the page's JSON-LD, including arrays and `@graph`. */
  structuredDataTypes(): Set<string> {
    const types = new Set<string>();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      const type = record["@type"];
      if (typeof type === "string") types.add(type);
      if (Array.isArray(type)) type.forEach((t) => typeof t === "string" && types.add(t));
      if (record["@graph"]) visit(record["@graph"]);
    };
    this.jsonLd.forEach(visit);
    return types;
  }
}

/** `/products/blue-mug?variant=1` → `blue-mug`. */
export function productHandle(href: string | null): string | null {
  const match = href?.match(/\/products\/([^/?#]+)/);
  return match?.[1] ?? null;
}

/**
 * Most-recently-parsed page. Every rule for a page reads the same HTML one
 * after another, so a single entry parses each page exactly once without any
 * caller having to pass the parsed page around.
 *
 * An evicted page is left to the garbage collector, not closed: closing its
 * window would break anything still holding it, and with no scripts or timers
 * running there is nothing that needs stopping.
 */
let cached: { html: string; page: Page } | null = null;

export function pageFor(html: string): Page {
  if (cached?.html === html) return cached.page;
  cached = { html, page: new Page(html) };
  return cached.page;
}
