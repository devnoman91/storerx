import { describe, expect, it } from "vitest";
import { productRules } from "../../app/rules/product";
import { UNCHECKED, type ProductData, type RuleContext, type ShopData } from "../../app/rules/types";
import { checked, fixture, run } from "./helpers";

const dawn = fixture("dawn", "product");
const check = (id: string, ctx: RuleContext) => checked(run(productRules, id, ctx));
const html = (h: string): RuleContext => ({ html: h });

const ID = "gid://shopify/Product/1";

function product(overrides: Partial<ProductData> = {}): ProductData {
  return {
    id: ID,
    title: "Flex Bag",
    handle: "flex-bag",
    descriptionHtml: "<p>" + "word ".repeat(120) + "</p>",
    descriptionWordCount: 120,
    images: [],
    hasReviews: false,
    variants: [
      { id: "v1", title: "Tan", available: true, price: "10.00" },
      { id: "v2", title: "Black", available: true, price: "10.00" },
    ],
    hasStructuredData: true,
    ...overrides,
  };
}

/** A page for one product, with that product's Admin data attached. */
function withProduct(page: string, data: ProductData, others: ProductData[] = []): RuleContext {
  return { html: page, resourceId: data.id, shopData: { products: [...others, data] } as ShopData };
}

/** A purchase section: add-to-cart form, with whatever else it is given. */
const buySection = (inner: string) =>
  `<section class="shopify-section"><form action="/cart/add">${inner}<button>Add to cart</button></form></section>`;

describe("prod.reviews.fold", () => {
  it("fires when a product page shows no reviews at all", () => {
    expect(check("prod.reviews.fold", html(dawn))?.title).toBe("Product pages show no reviews");
  });

  it("can't tell where reviews land when an app draws them after load", () => {
    const withApp = dawn.replace("</head>", '<script src="https://cdn.judge.me/widget.js"></script></head>');
    expect(run(productRules, "prod.reviews.fold", html(withApp))).toBe(UNCHECKED);
  });

  it("passes when reviews sit in the purchase section", () => {
    const page = `<main>${buySection('<span class="price">$10</span><div class="jdgm-preview-badge"></div>')}</main>`;
    expect(check("prod.reviews.fold", html(page))).toBeNull();
  });

  it("fires when reviews are only further down the page", () => {
    const page = `<main>${buySection('<span class="price">$10</span>')}
      <section class="shopify-section"><div class="jdgm-widget"></div></section></main>`;
    expect(check("prod.reviews.fold", html(page))?.title).toBe("Reviews aren't shown near the buy button");
  });

  it("does not mistake an image preview for a review", () => {
    const page = `<main>${buySection('<div class="product-media-preview"></div>')}</main>`;
    expect(check("prod.reviews.fold", html(page))?.title).toBe("Product pages show no reviews");
  });
});

describe("prod.cta.sticky", () => {
  it("fires on Dawn, which has no sticky add-to-cart bar", () => {
    expect(check("prod.cta.sticky", html(dawn))?.ruleId).toBe("prod.cta.sticky");
  });

  it("passes on a sticky add-to-cart bar, not a sticky header", () => {
    const stickyHeader = `<header class="header--sticky"></header><main>${buySection("")}</main>`;
    expect(check("prod.cta.sticky", html(stickyHeader))?.ruleId).toBe("prod.cta.sticky");
    const stickyBar = `<main>${buySection("")}<div class="sticky-atc"></div></main>`;
    expect(check("prod.cta.sticky", html(stickyBar))).toBeNull();
  });

  it("can't judge a page with no add-to-cart form", () => {
    expect(run(productRules, "prod.cta.sticky", html("<main><p>Sold out</p></main>"))).toBe(UNCHECKED);
  });
});

describe("prod.price.near.cta", () => {
  it("passes when the purchase section shows the price", () => {
    expect(check("prod.price.near.cta", html(dawn))).toBeNull();
  });

  it("fires when it doesn't", () => {
    expect(check("prod.price.near.cta", html(`<main>${buySection("<h1>Bag</h1>")}</main>`))?.ruleId).toBe(
      "prod.price.near.cta",
    );
  });
});

describe("prod.desc.short and prod.desc.long", () => {
  it("read the description from the product's Admin data", () => {
    expect(check("prod.desc.short", withProduct(dawn, product()))).toBeNull();
    const short = check("prod.desc.short", withProduct(dawn, product({ descriptionHtml: "<p>A good bag.</p>" })));
    expect(short?.title).toBe("Product description is only 3 words");
  });

  it("count an empty description as zero words, not one", () => {
    const empty = check("prod.desc.short", withProduct(dawn, product({ descriptionHtml: "" })));
    expect(empty?.title).toBe("Product has no description");
  });

  it("flag a long description only when it has no structure", () => {
    const wall = "<p>" + "word ".repeat(700) + "</p>";
    expect(check("prod.desc.long", withProduct(dawn, product({ descriptionHtml: wall })))?.ruleId).toBe(
      "prod.desc.long",
    );
    const listed = wall + "<ul><li>Leather</li></ul>";
    expect(check("prod.desc.long", withProduct(dawn, product({ descriptionHtml: listed })))).toBeNull();
  });

  it("can't check when the product is unknown and the page has no description", () => {
    expect(run(productRules, "prod.desc.short", html("<main></main>"))).toBe(UNCHECKED);
  });
});

describe("prod.faq", () => {
  it("passes on Dawn's Shipping & Returns section", () => {
    expect(check("prod.faq", html(dawn))).toBeNull();
  });

  it("fires when no section heading covers questions, sizing or shipping", () => {
    expect(check("prod.faq", html("<main><h2>Details</h2></main>"))?.ruleId).toBe("prod.faq");
  });
});

describe("prod.trust.badges", () => {
  it("passes on Dawn's free shipping and returns promise in the purchase section", () => {
    expect(check("prod.trust.badges", html(dawn))).toBeNull();
  });

  it("fires when the purchase section offers no reassurance", () => {
    expect(check("prod.trust.badges", html(`<main>${buySection("$10")}</main>`))?.ruleId).toBe(
      "prod.trust.badges",
    );
  });

  it("ignores reassurance that is not near the button", () => {
    const page = `<header>Free shipping on everything</header><main>${buySection("$10")}</main>`;
    expect(check("prod.trust.badges", html(page))?.ruleId).toBe("prod.trust.badges");
  });
});

describe("prod.crosssell", () => {
  it("passes on Dawn's product recommendations", () => {
    expect(check("prod.crosssell", html(dawn))).toBeNull();
  });

  it("fires when nothing else is suggested", () => {
    expect(check("prod.crosssell", html(`<main>${buySection("$10")}</main>`))?.ruleId).toBe("prod.crosssell");
  });
});

describe("prod.variants.oos", () => {
  const soldOut = product({
    variants: [
      { id: "v1", title: "Tan", available: true, price: "10.00" },
      { id: "v2", title: "Black", available: false, price: "10.00" },
    ],
  });

  it("passes when the page marks sold-out options, as Dawn does", () => {
    expect(check("prod.variants.oos", withProduct(dawn, soldOut))).toBeNull();
  });

  it("fires when options give no sign which are sold out", () => {
    const page = `<main>${buySection('<fieldset><input type="radio" value="Tan"><input type="radio" value="Black"></fieldset>')}</main>`;
    expect(check("prod.variants.oos", withProduct(page, soldOut))?.evidence?.value).toBe(
      "1 of 2 variants are sold out, but the options on the page don't show which",
    );
  });

  it("judges the product on the page, not the store's first product", () => {
    // The old rule always read products[0], whichever page it was checking.
    const page = `<main>${buySection('<fieldset><input type="radio"><input type="radio"></fieldset>')}</main>`;
    const inStock = product({ id: "gid://shopify/Product/2" });
    expect(check("prod.variants.oos", withProduct(page, inStock, [soldOut]))).toBeNull();
  });

  it("can't check without knowing which product the page shows", () => {
    expect(run(productRules, "prod.variants.oos", html(dawn))).toBe(UNCHECKED);
  });
});

describe("prod.seo.title", () => {
  it("passes on a title within 60 characters", () => {
    expect(check("prod.seo.title", html(dawn))).toBeNull();
  });

  it("fires on a long or missing title", () => {
    const long = `<title>${"x".repeat(70)}</title>`;
    expect(check("prod.seo.title", html(long))?.title).toBe("SEO title is 70 characters");
    expect(check("prod.seo.title", html("<main></main>"))?.title).toBe("SEO title is missing");
  });
});

describe("prod.seo.meta", () => {
  it("fires on Dawn's over-long meta description", () => {
    expect(check("prod.seo.meta", html(dawn))?.title).toMatch(/^Meta description is \d+ characters$/);
  });

  it("reads the tag whatever order its attributes are in", () => {
    // The old pattern needed name= before content=, so this read as missing.
    const page = '<head><meta content="A short summary." NAME="Description"></head>';
    expect(check("prod.seo.meta", html(page))).toBeNull();
  });

  it("fires when there is none", () => {
    expect(check("prod.seo.meta", html("<head></head>"))?.title).toBe("Meta description is missing");
  });
});

describe("prod.schema", () => {
  it("passes on Dawn's ProductGroup", () => {
    expect(check("prod.schema", html(dawn))).toBeNull();
  });

  it("passes on a top-level ProductGroup or on microdata", () => {
    const group = '<script type="application/ld+json">{"@type":"ProductGroup"}</script>';
    expect(check("prod.schema", html(group))).toBeNull();
    expect(check("prod.schema", html('<div itemtype="https://schema.org/Product"></div>'))).toBeNull();
  });

  it("fires, naming what the page does describe itself as", () => {
    const org = '<script type="application/ld+json">{"@type":"Organization"}</script>';
    expect(check("prod.schema", html(org))?.evidence?.value).toBe(
      "The page describes itself as Organization, but not as a Product",
    );
  });
});
