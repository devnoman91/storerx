import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CatalogProduct } from "../../app/collectors/images";
import { toImageData } from "../../app/collectors/images";
import {
  checkCatalogImages,
  checkDuplicateImages,
  checkProductImages,
} from "../../app/rules/images";
import type { Finding } from "../../app/rules/types";
import { calculateStoreHealth, collapseCatalogFindings } from "../../app/scoring";

const catalog = JSON.parse(
  readFileSync(join(__dirname, "..", "fixtures", "images", "catalog.json"), "utf8"),
) as CatalogProduct[];

const product = (title: string) => catalog.find((p) => p.title === title)!;
const rules = (findings: Finding[]) => findings.map((f) => f.ruleId).sort();

describe("per-image checks", () => {
  it("flags an oversized, oversized-dimension original with measured evidence", () => {
    const found = checkProductImages(product("Purple Snowboard"));
    expect(rules(found)).toEqual(["img.count", "img.dims.large", "img.size"]);

    const size = found.find((f) => f.ruleId === "img.size")!;
    expect(size.evidence?.value).toBe("Original upload is 1.7 MB (PNG, 3097×3908)");
    expect(size.targetId).toBe("gid://shopify/MediaImage/11");
    expect(size.imageUrl).toBe("https://cdn.shopify.com/purple-1.png");
    expect(size.pageUrl).toBe("https://shop.myshopify.com/products/purple-snowboard");
    expect(size.targetTitle).toBe("Purple Snowboard");
  });

  it("reports nothing for a well-photographed product", () => {
    expect(checkProductImages(product("Healthy Hoodie"))).toEqual([]);
  });

  it("treats empty and missing alt text the same", () => {
    const alt = checkProductImages(product("Mixed Mug")).filter((f) => f.ruleId === "img.alt");
    expect(alt.map((f) => f.targetId)).toEqual([
      "gid://shopify/MediaImage/31",
      "gid://shopify/MediaImage/32",
    ]);
    expect(alt.every((f) => f.fixableByAI && f.fixType === "alt_text")).toBe(true);
  });

  it("flags images too small to zoom", () => {
    const small = checkProductImages(product("Mixed Mug")).filter((f) => f.ruleId === "img.dims.small");
    expect(small).toHaveLength(1);
    expect(small[0].title).toBe("Image is only 640×480 px");
  });
});

describe("per-product checks", () => {
  it("reports mixed proportions once per product, not once per image", () => {
    const ratio = checkProductImages(product("Mixed Mug")).filter((f) => f.ruleId === "img.ratio");
    expect(ratio).toHaveLength(1);
    expect(ratio[0].targetId).toBe("gid://shopify/Product/3");
  });

  it("does not divide by zero on an image with no height", () => {
    const found = checkProductImages(product("Hoodie Twin"));
    expect(found.every((f) => !f.evidence?.value.includes("Infinity"))).toBe(true);
    expect(found.every((f) => !f.evidence?.value.includes("NaN"))).toBe(true);
  });

  it("distinguishes a product with no images from one with too few", () => {
    const [count] = checkProductImages(product("Ghost Product"));
    expect(count.title).toBe("Product has no images");
    expect(count.imageUrl).toBeUndefined();
  });
});

describe("duplicate detection", () => {
  it("flags a separate upload with identical bytes and dimensions", () => {
    const dupes = checkDuplicateImages(catalog);
    expect(dupes.map((f) => f.targetId)).toEqual(["gid://shopify/MediaImage/41"]);
    expect(dupes[0].evidence?.value).toContain('as an image on "Healthy Hoodie"');
  });

  it("does not flag the same media deliberately shared between products", () => {
    // MediaImage/21 appears on both hoodie products under one ID.
    const dupes = checkDuplicateImages(catalog);
    expect(dupes.some((f) => f.targetId === "gid://shopify/MediaImage/21")).toBe(false);
  });
});

describe("rule 7: no format advice", () => {
  it("never recommends converting image formats", () => {
    const text = checkCatalogImages(catalog)
      .map((f) => `${f.title} ${f.evidence?.value ?? ""}`)
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/webp|avif|convert/);
  });
});

describe("collector mapping", () => {
  it("skips media that is still processing", () => {
    expect(toImageData({ id: "gid://shopify/MediaImage/9", status: "PROCESSING", image: null })).toBeNull();
  });

  it("carries original file size and MIME type through", () => {
    const image = toImageData({
      id: "gid://shopify/MediaImage/9",
      alt: null,
      mimeType: "image/png",
      image: { url: "https://cdn.shopify.com/x.png", width: 10, height: 20 },
      originalSource: { fileSize: 1234 },
    });
    expect(image).toMatchObject({ fileSize: 1234, mimeType: "image/png", altText: undefined });
  });
});

describe("scoring catalog findings", () => {
  const manyMissingAlt = (n: number): Finding[] =>
    Array.from({ length: n }, (_, i) => ({
      ruleId: "img.alt",
      page: "images",
      severity: "medium",
      title: "Image missing alt text",
      fixableByAI: true,
      targetId: `gid://shopify/MediaImage/${i}`,
    }));

  it("counts one image rule once however many images it hits", () => {
    const one = calculateStoreHealth(manyMissingAlt(1));
    const forty = calculateStoreHealth(manyMissingAlt(40));
    const seo = (h: typeof one) => h.categories.find((c) => c.category === "seo")!.score;

    // Per-image counting took 100 points off at 20 images: SEO would read 0.
    expect(seo(forty)).toBe(seo(one));
    expect(seo(forty)).toBe(95);
    expect(forty.totalIssues).toBe(1);
  });

  it("leaves page rules uncollapsed", () => {
    const pageFindings: Finding[] = ["a", "b"].map((id) => ({
      ruleId: "prod.reviews.fold",
      page: "product",
      severity: "high",
      title: "Reviews are below the fold on mobile",
      fixableByAI: false,
      pageUrl: `https://shop.myshopify.com/products/${id}`,
    }));
    expect(collapseCatalogFindings(pageFindings, (f) => f.page)).toHaveLength(2);
  });
});
