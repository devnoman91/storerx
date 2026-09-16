/**
 * Wording for issues that group many rows into one prescription.
 *
 * Catalog rules fire once per image or product, so their stored title reads
 * like "Image missing alt text" — true of one row, wrong as a heading for
 * forty. These rewrite the heading around the count. Shared by the dashboard
 * and the issue detail page so both say the same thing.
 */

import {
  IMAGE_MAX_DIMENSION,
  IMAGE_MIN_DIMENSION,
  IMAGE_SIZE_LIMIT_BYTES,
  MIN_IMAGES_PER_PRODUCT,
} from "../rules/images";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const CATALOG_TITLES: Record<string, (n: number) => string> = {
  "img.alt": (n) => `${plural(n, "image is", "images are")} missing alt text`,
  "img.size": (n) =>
    `${plural(n, "image is", "images are")} over ${Math.round(IMAGE_SIZE_LIMIT_BYTES / 1024)} KB`,
  "img.dims.large": (n) =>
    `${plural(n, "image is", "images are")} larger than ${IMAGE_MAX_DIMENSION} px`,
  "img.dims.small": (n) =>
    `${plural(n, "image is", "images are")} smaller than ${IMAGE_MIN_DIMENSION} px`,
  "img.count": (n) =>
    `${plural(n, "product has", "products have")} fewer than ${MIN_IMAGES_PER_PRODUCT} images`,
  "img.ratio": (n) => `${plural(n, "product mixes", "products mix")} image proportions`,
  "img.duplicate": (n) => `${plural(n, "image looks", "images look")} like a duplicate upload`,
};

/** Count-aware heading for a catalog rule, or null to keep the stored title. */
export function catalogTitle(ruleId: string, count: number): string | null {
  return CATALOG_TITLES[ruleId]?.(count) ?? null;
}
