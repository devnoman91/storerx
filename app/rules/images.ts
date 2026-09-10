/**
 * Image audit rules
 * Deterministic checks on product images
 */

import type { Rule, RuleContext, Finding, ImageData } from "./types";

// These rules are run per-image, not per-page
// The context will contain a single image to check

export interface ImageCheckContext {
  image: ImageData;
  productId: string;
  productTitle: string;
  allProductImages: ImageData[];
}

export function checkImage(ctx: ImageCheckContext): Finding[] {
  const findings: Finding[] = [];
  const { image, productId, productTitle, allProductImages } = ctx;

  // img.alt - Alt text missing
  if (!image.altText || image.altText.trim() === "") {
    findings.push({
      ruleId: "img.alt",
      page: "images",
      severity: "medium",
      title: `Image missing alt text`,
      evidence: { type: "text", value: productTitle },
      fixableByAI: true,
      fixType: "alt_text",
      targetId: image.id,
    });
  }

  // img.size - File size > 500KB
  if (image.fileSize && image.fileSize > 500 * 1024) {
    const sizeMB = (image.fileSize / (1024 * 1024)).toFixed(2);
    findings.push({
      ruleId: "img.size",
      page: "images",
      severity: "medium",
      title: `Image file size too large (${sizeMB}MB)`,
      evidence: { type: "text", value: `${productTitle} - should be under 500KB` },
      fixableByAI: true,
      fixType: "image_compress",
      targetId: image.id,
    });
  }

  // img.dims.large - Dimensions > 2048px
  if (image.width > 2048 || image.height > 2048) {
    findings.push({
      ruleId: "img.dims.large",
      page: "images",
      severity: "low",
      title: `Image dimensions too large (${image.width}x${image.height})`,
      evidence: { type: "text", value: `${productTitle} - max recommended 2048px` },
      fixableByAI: false,
      targetId: image.id,
    });
  }

  // img.dims.small - Dimensions < 800px
  if (image.width < 800 && image.height < 800) {
    findings.push({
      ruleId: "img.dims.small",
      page: "images",
      severity: "medium",
      title: `Image too small (${image.width}x${image.height})`,
      evidence: { type: "text", value: `${productTitle} - min recommended 800px` },
      fixableByAI: false,
      targetId: image.id,
    });
  }

  // img.ratio - Mixed aspect ratios within a product
  if (allProductImages.length > 1) {
    const firstRatio = allProductImages[0].width / allProductImages[0].height;
    const currentRatio = image.width / image.height;
    const ratioDiff = Math.abs(firstRatio - currentRatio);

    if (ratioDiff > 0.1) {
      findings.push({
        ruleId: "img.ratio",
        page: "images",
        severity: "medium",
        title: "Inconsistent aspect ratio",
        evidence: { type: "text", value: `${productTitle} - images have mixed proportions` },
        fixableByAI: false,
        targetId: image.id,
      });
    }
  }

  return findings;
}

// Check product-level image issues
export function checkProductImages(
  productId: string,
  productTitle: string,
  images: ImageData[]
): Finding[] {
  const findings: Finding[] = [];

  // img.count - Less than 3 images per product
  if (images.length < 3) {
    findings.push({
      ruleId: "img.count",
      page: "images",
      severity: "medium",
      title: `Product has only ${images.length} image${images.length === 1 ? "" : "s"}`,
      evidence: { type: "text", value: `${productTitle} - recommend 3+ images` },
      fixableByAI: false,
      targetId: productId,
    });
  }

  // Check each image
  for (const image of images) {
    const imageFindings = checkImage({
      image,
      productId,
      productTitle,
      allProductImages: images,
    });
    findings.push(...imageFindings);
  }

  return findings;
}

// img.duplicate - Duplicate images (hash) - would need actual hash comparison
export function checkDuplicateImages(
  allImages: Array<{ image: ImageData; productId: string; productTitle: string }>
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Map<string, { productId: string; productTitle: string }>();

  for (const { image, productId, productTitle } of allImages) {
    // Use URL as a simple proxy for duplicate detection
    // Real implementation would use perceptual hash
    const key = image.url.split("?")[0]; // Remove query params

    if (seen.has(key)) {
      const original = seen.get(key)!;
      findings.push({
        ruleId: "img.duplicate",
        page: "images",
        severity: "low",
        title: "Duplicate image detected",
        evidence: {
          type: "text",
          value: `Same image used in "${productTitle}" and "${original.productTitle}"`,
        },
        fixableByAI: false,
        targetId: image.id,
      });
    } else {
      seen.set(key, { productId, productTitle });
    }
  }

  return findings;
}

// Placeholder rules for page-level checks (lazy loading, srcset)
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
          evidence: { type: "text", value: "Check theme settings for image optimization" },
          fixableByAI: false,
        };
      }
      return null;
    },
  },
];

export default imageRules;
