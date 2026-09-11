/**
 * Image rules (FEATURES.md §5)
 *
 * Deterministic checks over catalog image metadata from the Admin API —
 * no image is downloaded. Per-image findings carry the image and product so
 * the dashboard can group them into one prescription with a thumbnail list.
 *
 * Never recommend converting formats: Shopify's CDN already serves WebP/AVIF
 * and resized renditions (CLAUDE.md rule 7).
 */

import type { CatalogProduct } from "../collectors/images";
import type { Rule, RuleContext, Finding, ImageData } from "./types";

export const IMAGE_SIZE_LIMIT_BYTES = 500 * 1024;
export const IMAGE_MAX_DIMENSION = 2048;
export const IMAGE_MIN_DIMENSION = 800;
export const MIN_IMAGES_PER_PRODUCT = 3;
/** Relative spread in width/height ratio tolerated within one product. */
const RATIO_TOLERANCE = 0.1;

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

function formatType(mimeType?: string): string {
  return mimeType?.split("/")[1]?.toUpperCase() ?? "image";
}

function base(product: CatalogProduct, image?: ImageData) {
  return {
    page: "images" as const,
    pageUrl: product.url,
    targetTitle: product.title,
    imageUrl: image?.url ?? product.images[0]?.url,
  };
}

/** Per-image checks: alt text, file size, dimensions. */
export function checkImage(product: CatalogProduct, image: ImageData): Finding[] {
  const findings: Finding[] = [];
  const dims = `${image.width}×${image.height}`;

  if (!image.altText?.trim()) {
    findings.push({
      ...base(product, image),
      ruleId: "img.alt",
      severity: "medium",
      title: "Image missing alt text",
      evidence: { type: "text", value: `No alt text on an image of "${product.title}"` },
      fixableByAI: true,
      fixType: "alt_text",
      targetId: image.id,
    });
  }

  if (image.fileSize !== undefined && image.fileSize > IMAGE_SIZE_LIMIT_BYTES) {
    findings.push({
      ...base(product, image),
      ruleId: "img.size",
      severity: "medium",
      title: `Image file is ${formatBytes(image.fileSize)}`,
      evidence: {
        type: "text",
        value: `Original upload is ${formatBytes(image.fileSize)} (${formatType(image.mimeType)}, ${dims})`,
      },
      fixableByAI: true,
      fixType: "image_compress",
      targetId: image.id,
    });
  }

  if (image.width > IMAGE_MAX_DIMENSION || image.height > IMAGE_MAX_DIMENSION) {
    findings.push({
      ...base(product, image),
      ruleId: "img.dims.large",
      severity: "low",
      title: `Image is ${dims} px`,
      evidence: { type: "text", value: `${dims} px, above the ${IMAGE_MAX_DIMENSION} px guideline` },
      fixableByAI: false,
      targetId: image.id,
    });
  }

  if (image.width < IMAGE_MIN_DIMENSION && image.height < IMAGE_MIN_DIMENSION) {
    findings.push({
      ...base(product, image),
      ruleId: "img.dims.small",
      severity: "medium",
      title: `Image is only ${dims} px`,
      evidence: {
        type: "text",
        value: `${dims} px, below the ${IMAGE_MIN_DIMENSION} px needed to stay sharp when zoomed`,
      },
      fixableByAI: false,
      targetId: image.id,
    });
  }

  return findings;
}

/** Per-product checks: image count and mixed proportions — one finding each. */
export function checkProductImages(product: CatalogProduct): Finding[] {
  const findings: Finding[] = [];
  const { images } = product;

  if (images.length < MIN_IMAGES_PER_PRODUCT) {
    findings.push({
      ...base(product),
      ruleId: "img.count",
      severity: "medium",
      title:
        images.length === 0
          ? "Product has no images"
          : `Product has only ${images.length} image${images.length === 1 ? "" : "s"}`,
      evidence: {
        type: "text",
        value: `${images.length} of the recommended ${MIN_IMAGES_PER_PRODUCT}+ images`,
      },
      fixableByAI: false,
      targetId: product.id,
    });
  }

  // Compare the spread of proportions across the product, once — not each
  // image against the first, which reported one problem N-1 times.
  const ratios = images
    .filter((image) => image.width > 0 && image.height > 0)
    .map((image) => image.width / image.height);
  if (ratios.length > 1) {
    const min = Math.min(...ratios);
    const max = Math.max(...ratios);
    if ((max - min) / min > RATIO_TOLERANCE) {
      findings.push({
        ...base(product),
        ruleId: "img.ratio",
        severity: "medium",
        title: "Product images have mixed proportions",
        evidence: {
          type: "text",
          value: `Width ÷ height ranges from ${min.toFixed(2)} to ${max.toFixed(2)} across ${ratios.length} images`,
        },
        fixableByAI: false,
        targetId: product.id,
      });
    }
  }

  for (const image of images) {
    findings.push(...checkImage(product, image));
  }

  return findings;
}

/**
 * Likely duplicate uploads: distinct media with an identical original byte
 * size and dimensions. An exact byte-for-byte size match between different
 * photos is vanishingly rare, so this catches re-uploads without downloading
 * anything. Media shared between products has one ID and is not flagged —
 * reusing a file is deliberate, re-uploading it is not.
 */
export function checkDuplicateImages(products: CatalogProduct[]): Finding[] {
  const findings: Finding[] = [];
  const firstSeen = new Map<string, { id: string; product: CatalogProduct }>();
  const seenIds = new Set<string>();

  for (const product of products) {
    for (const image of product.images) {
      if (seenIds.has(image.id)) continue; // shared media, not a duplicate
      seenIds.add(image.id);
      if (image.fileSize === undefined) continue;

      const key = `${image.fileSize}:${image.width}x${image.height}`;
      const original = firstSeen.get(key);
      if (!original) {
        firstSeen.set(key, { id: image.id, product });
        continue;
      }

      findings.push({
        ...base(product, image),
        ruleId: "img.duplicate",
        severity: "low",
        title: "Image looks like a duplicate upload",
        evidence: {
          type: "text",
          value:
            original.product.id === product.id
              ? `Same ${formatBytes(image.fileSize)}, ${image.width}×${image.height} file uploaded twice to this product`
              : `Same ${formatBytes(image.fileSize)}, ${image.width}×${image.height} file as an image on "${original.product.title}"`,
        },
        fixableByAI: false,
        targetId: image.id,
      });
    }
  }

  return findings;
}

/** Run every catalog image check. */
export function checkCatalogImages(products: CatalogProduct[]): Finding[] {
  return [...products.flatMap(checkProductImages), ...checkDuplicateImages(products)];
}

// Page-level theme check (lazy loading / srcset), run against page HTML.
export const imageRules: Rule[] = [
  {
    id: "img.lazy",
    page: "images",
    severity: "low",
    description: "Images not lazy-loaded / no srcset",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const hasLazyLoading = /loading=["']lazy["']|data-src/i.test(ctx.html);
      const hasSrcset = /srcset/i.test(ctx.html);

      if (!hasLazyLoading && !hasSrcset) {
        return {
          ruleId: "img.lazy",
          page: "images",
          severity: "low",
          title: "Theme may not use lazy loading or responsive images",
          evidence: { type: "text", value: "No loading=\"lazy\" or srcset found in the page HTML" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },
];

export default imageRules;
