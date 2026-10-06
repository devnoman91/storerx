/**
 * Applying a draft to the store, once the merchant approves it.
 *
 * The only place StoreRx writes to a store, and only ever one field on one
 * resource per approval. Pure, so what is written — and when StoreRx refuses
 * to write — is tested without Shopify. The Admin API calls themselves are in
 * app/suggestions/apply.server.ts.
 */

import type { SuggestionKind } from "../remedies/types";

/**
 * The access scope each kind of draft needs to be applied. Both are optional
 * scopes (shopify.app.toml): a store is installed read-only and is asked for
 * these the first time the merchant chooses to have a draft applied.
 *
 * A kind with no entry cannot be applied. A FAQ has no field in Shopify to
 * write to — it goes into theme blocks, which only the merchant edits.
 */
const APPLY_SCOPE: Partial<Record<SuggestionKind, string>> = {
  seo_title: "write_products",
  seo_meta: "write_products",
  product_description: "write_products",
  // Alt text is a property of the file, not of the product it sits on.
  alt_text: "write_files",
};

/** Every scope applying can need, requested together so consent is asked once. */
export const APPLY_SCOPES: string[] = [...new Set(Object.values(APPLY_SCOPE))];

export function applyScopeFor(kind: string): string | null {
  return APPLY_SCOPE[kind as SuggestionKind] ?? null;
}

export function isAppliable(kind: string | null | undefined): boolean {
  return Boolean(kind && applyScopeFor(kind));
}

/** Whether the scopes a store has granted cover applying this kind of draft. */
export function canApply(kind: string, granted: Iterable<string>): boolean {
  const scope = applyScopeFor(kind);
  return scope !== null && new Set(granted).has(scope);
}

/**
 * Shopify reports an unset field as null and StoreRx stores a cleared one as
 * an empty string; they are the same value to a merchant.
 */
export function sameValue(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

export interface ApplyOperation {
  query: string;
  variables: Record<string, unknown>;
  /** The mutation's field in the response, where `userErrors` are reported. */
  field: "productUpdate" | "fileUpdate";
}

const PRODUCT_UPDATE = `#graphql
  mutation ApplyProductCopy($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const FILE_UPDATE = `#graphql
  mutation ApplyAltText($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * The mutation that writes `value` to the one field this kind of draft is
 * for. Used for undo as well: undoing is writing the previous value back.
 */
export function applyOperation(kind: string, targetId: string, value: string): ApplyOperation | null {
  switch (kind as SuggestionKind) {
    case "seo_title":
      return {
        query: PRODUCT_UPDATE,
        variables: { product: { id: targetId, seo: { title: value } } },
        field: "productUpdate",
      };
    case "seo_meta":
      return {
        query: PRODUCT_UPDATE,
        variables: { product: { id: targetId, seo: { description: value } } },
        field: "productUpdate",
      };
    case "product_description":
      return {
        query: PRODUCT_UPDATE,
        variables: { product: { id: targetId, descriptionHtml: value } },
        field: "productUpdate",
      };
    case "alt_text":
      return {
        query: FILE_UPDATE,
        variables: { files: [{ id: targetId, alt: value }] },
        field: "fileUpdate",
      };
    default:
      return null;
  }
}

export type ApplyCheck = { ok: true } | { ok: false; error: string };

/**
 * Whether a draft may be written over what is in the store now.
 *
 * A draft is shown beside the value it replaces. If the merchant has edited
 * that value since, approving would overwrite work they never saw compared —
 * so StoreRx refuses and asks for a fresh draft instead.
 */
export function checkApply(draft: {
  suggested: string | null;
  current: string | null;
  appliedAt: Date | null;
  live: string | null;
}): ApplyCheck {
  if (!draft.suggested) return { ok: false, error: "There is no draft to apply yet." };
  if (draft.appliedAt) return { ok: false, error: "This draft has already been applied." };
  if (!sameValue(draft.live, draft.current)) {
    return {
      ok: false,
      error:
        "This has been edited in your store since the draft was written, so StoreRx has not " +
        "replaced it. Draft another to compare against what is there now.",
    };
  }
  return { ok: true };
}

/**
 * Whether an applied draft may be undone. Only while the store still holds
 * exactly what StoreRx wrote — otherwise undo would discard a later edit.
 */
export function checkUndo(draft: {
  suggested: string | null;
  appliedAt: Date | null;
  live: string | null;
}): ApplyCheck {
  if (!draft.appliedAt) return { ok: false, error: "This draft has not been applied." };
  if (!sameValue(draft.live, draft.suggested)) {
    return {
      ok: false,
      error:
        "This has been edited in your store since StoreRx applied it, so there is nothing left " +
        "to undo. Change it in Shopify admin instead.",
    };
  }
  return { ok: true };
}
