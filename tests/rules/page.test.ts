import { describe, expect, it } from "vitest";
import { Page, pageFor, productHandle } from "../../app/rules/page";
import { runRulesDetailed } from "../../app/rules";
import { fixture } from "./helpers";

describe("Page", () => {
  it("reads only what a shopper can see", () => {
    const page = new Page(`<html><head><meta property="og:image:secure_url" content="x"></head>
      <body><main><p>Hello</p><script>var isSearchTemplate = true</script>
      <style>.secure-badge{}</style></main></body></html>`);
    expect(page.text()).toBe("Hello");
  });

  it("keeps words in neighbouring elements apart", () => {
    // textContent would give "PriceSale", which no word pattern matches.
    const page = new Page("<main><span>Price</span><span>Sale</span></main>");
    expect(page.text()).toBe("Price Sale");
  });

  it("keeps script sources and JSON-LD, which rules still need", () => {
    const page = new Page(`<head><script src="https://static.klaviyo.com/onsite/js/x.js"></script>
      <script type="application/ld+json">{"@type":"ProductGroup"}</script>
      <script type="application/ld+json">{ not json</script></head><main></main>`);
    expect(page.scriptSources).toEqual(["https://static.klaviyo.com/onsite/js/x.js"]);
    expect(page.jsonLd).toHaveLength(1); // the broken block is skipped, not fatal
  });

  it("finds structured data types in arrays and @graph", () => {
    const page = new Page(`<script type="application/ld+json">
      {"@graph":[{"@type":"Organization"},{"@type":["Product","Thing"]}]}</script>`);
    expect([...page.structuredDataTypes()].sort()).toEqual(["Organization", "Product", "Thing"]);
  });

  it("counts one card per product however many links it has", () => {
    const page = new Page(`<main><ul>
      <li><a href="/products/mug"><img></a><a href="/products/mug?variant=2">Mug</a></li>
      <li><a href="/collections/x/products/cup">Cup</a></li></ul></main>`);
    expect(page.productCards()).toHaveLength(2);
  });

  it("parses a real theme without losing its structure", () => {
    // A lenient parser tried first dropped <body> and never found <main> on
    // this very page, which would have left every rule reading nothing.
    const page = new Page(fixture("dawn", "product"));
    expect(page.doc.body).not.toBeNull();
    expect(page.main.tagName).toBe("MAIN");
    expect(page.footer).not.toBeNull();
    expect(page.addToCartForm).not.toBeNull();
  });

  it("parses a page once for all the rules that read it", () => {
    const html = fixture("dawn", "home");
    expect(pageFor(html)).toBe(pageFor(html));
  });

  it("leaves an earlier page usable after a new one is parsed", () => {
    const home = pageFor(fixture("dawn", "home"));
    pageFor(fixture("dawn", "cart"));
    // The cache used to close evicted pages, which broke anyone holding one.
    expect(home.text(home.firstSection)).toContain("Shop now");
  });

  it("extracts product handles from any product link", () => {
    expect(productHandle("/products/blue-mug?variant=1")).toBe("blue-mug");
    expect(productHandle("/collections/all/products/cup#reviews")).toBe("cup");
    expect(productHandle("/pages/about")).toBeNull();
  });
});

describe("rules that cannot check a page", () => {
  it("are not counted as having checked it", () => {
    // An empty cart has no checkout button. If "couldn't look" counted as
    // "looked and it passed", scanning an empty cart would mark an open
    // trust-badge issue as verified.
    const run = runRulesDetailed("cart", { html: fixture("dawn", "cart") });
    expect(run.evaluated).toEqual(["cart.drawer"]);
    expect(run.findings).toEqual([]);
  });
});
