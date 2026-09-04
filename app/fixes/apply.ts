/**
 * Apply fixes to the store
 *
 * Each fix type has its own apply function.
 * All changes are made via Admin GraphQL or Theme App Extension settings.
 */

import type { Fix, ApplyFixOptions } from "./types";
import type { FixType } from "../rules/types";

/**
 * Apply a fix to the store
 */
export async function applyFix(options: ApplyFixOptions): Promise<void> {
  const { admin, fix } = options;

  switch (fix.type) {
    case "product_description":
      await applyProductDescription(admin, fix);
      break;
    case "seo_title":
    case "seo_meta":
      await applySeoUpdate(admin, fix);
      break;
    case "alt_text":
      await applyAltText(admin, fix);
      break;
    case "faq_block":
    case "trust_badges":
    case "crosssells":
    case "shipping_bar":
      await applyThemeAppExtension(admin, fix);
      break;
    case "image_compress":
      await applyImageCompress(admin, fix);
      break;
    default:
      throw new Error(`Unknown fix type: ${fix.type}`);
  }
}

async function applyProductDescription(
  admin: ApplyFixOptions["admin"],
  fix: Fix
): Promise<void> {
  // TODO: Use productUpdate mutation
  // const response = await admin.graphql(`
  //   mutation updateProduct($input: ProductInput!) {
  //     productUpdate(input: $input) {
  //       product { id }
  //       userErrors { field message }
  //     }
  //   }
  // `, {
  //   variables: {
  //     input: {
  //       id: fix.targetId,
  //       descriptionHtml: fix.after,
  //     },
  //   },
  // });
  throw new Error("Product description update not implemented");
}

async function applySeoUpdate(
  admin: ApplyFixOptions["admin"],
  fix: Fix
): Promise<void> {
  // TODO: Use productUpdate mutation with seo field
  throw new Error("SEO update not implemented");
}

async function applyAltText(
  admin: ApplyFixOptions["admin"],
  fix: Fix
): Promise<void> {
  // TODO: Use fileUpdate mutation for media alt text
  throw new Error("Alt text update not implemented");
}

async function applyThemeAppExtension(
  admin: ApplyFixOptions["admin"],
  fix: Fix
): Promise<void> {
  // TODO: Use metafieldsSet mutation for Theme App Extension data
  throw new Error("Theme App Extension update not implemented");
}

async function applyImageCompress(
  admin: ApplyFixOptions["admin"],
  fix: Fix
): Promise<void> {
  // TODO: Compress image with sharp, re-upload via fileUpdate
  throw new Error("Image compression not implemented");
}
