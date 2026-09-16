/**
 * Which Shopify resource a draft is written for.
 *
 * Not the same as the resource the merchant edits: alt text belongs to the
 * image, but it is edited on the product page, so an image issue carries both
 * a `targetId` (the image) and an `adminRef` (its product). Drafting the
 * wrong one produces a description of the product where alt text was wanted.
 */

import type { SuggestionKind } from "../remedies/types";

export interface DraftTargetSource {
  suggestionKind: string | null;
  targetId: string | null;
  adminRef: string | null;
}

export function draftTargetFor(issue: DraftTargetSource): string | null {
  if (!issue.suggestionKind) return null;
  const kind = issue.suggestionKind as SuggestionKind;
  // Alt text is a property of the image itself; everything else StoreRx
  // drafts is a field on the product.
  return kind === "alt_text" ? issue.targetId : issue.adminRef;
}
