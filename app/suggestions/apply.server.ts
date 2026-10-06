/**
 * Write an approved draft to the store, and take it back (server only).
 *
 * Runs in the request handler that received the merchant's approval: it is
 * two Admin API calls for one field, not the heavy work the worker exists
 * for, and the merchant is waiting to see that it happened.
 *
 * Applying does not resolve the issue. It moves it to awaiting verification,
 * like any change the merchant makes themselves — only a scan resolves.
 */

import type { Suggestion } from "@prisma/client";
import prisma from "../db.server";
import type { SuggestionKind } from "../remedies/types";
import { applyOperation, checkApply, checkUndo, type ApplyCheck } from "./apply";

interface AdminApiClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

const PRODUCT_FIELDS_QUERY = `#graphql
  query ApplyProductCurrent($id: ID!) {
    product(id: $id) {
      id
      descriptionHtml
      seo {
        title
        description
      }
    }
  }
`;

const MEDIA_ALT_QUERY = `#graphql
  query ApplyMediaCurrent($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        id
        alt
      }
    }
  }
`;

const GONE = "That item is no longer in your store.";

type Live = { found: true; value: string | null } | { found: false };

/** The value in the store right now, for the one field a draft is for. */
async function readLive(admin: AdminApiClient, kind: string, targetId: string): Promise<Live> {
  if ((kind as SuggestionKind) === "alt_text") {
    const response = await admin.graphql(MEDIA_ALT_QUERY, { variables: { id: targetId } });
    const body = (await response.json()) as { data?: { node?: { id?: string; alt?: string | null } | null } };
    const media = body.data?.node;
    return media?.id ? { found: true, value: media.alt ?? null } : { found: false };
  }

  const response = await admin.graphql(PRODUCT_FIELDS_QUERY, { variables: { id: targetId } });
  const body = (await response.json()) as {
    data?: {
      product?: {
        descriptionHtml: string | null;
        seo: { title: string | null; description: string | null } | null;
      } | null;
    };
  };
  const product = body.data?.product;
  if (!product) return { found: false };

  switch (kind as SuggestionKind) {
    case "seo_title":
      return { found: true, value: product.seo?.title ?? null };
    case "seo_meta":
      return { found: true, value: product.seo?.description ?? null };
    default:
      return { found: true, value: product.descriptionHtml };
  }
}

async function write(admin: AdminApiClient, kind: string, targetId: string, value: string): Promise<ApplyCheck> {
  const operation = applyOperation(kind, targetId, value);
  if (!operation) return { ok: false, error: "StoreRx cannot apply this kind of draft." };

  const response = await admin.graphql(operation.query, { variables: operation.variables });
  const body = (await response.json()) as {
    data?: Record<string, { userErrors?: Array<{ message: string }> } | null>;
  };
  const errors = body.data?.[operation.field]?.userErrors ?? [];
  if (errors.length > 0) {
    return { ok: false, error: `Shopify did not accept the change: ${errors[0].message}` };
  }
  if (!body.data?.[operation.field]) {
    return { ok: false, error: "Shopify did not accept the change. Nothing was changed." };
  }
  return { ok: true };
}

/** Write an approved draft to the store. */
export async function applySuggestion(admin: AdminApiClient, suggestion: Suggestion): Promise<ApplyCheck> {
  const live = await readLive(admin, suggestion.kind, suggestion.targetId);
  if (!live.found) return { ok: false, error: GONE };

  const check = checkApply({ ...suggestion, live: live.value });
  if (!check.ok) return check;

  const written = await write(admin, suggestion.kind, suggestion.targetId, suggestion.suggested!);
  if (!written.ok) return written;

  const now = new Date();
  await prisma.$transaction([
    prisma.suggestion.update({
      where: { id: suggestion.id },
      data: { appliedAt: now, previous: live.value ?? "" },
    }),
    // The merchant approved a change; a scan still has to confirm it worked.
    prisma.issue.updateMany({
      where: { id: suggestion.issueId, status: "open" },
      data: { status: "awaiting_verification", markedResolvedAt: now, verificationFailedAt: null },
    }),
  ]);
  return { ok: true };
}

/** Put back what was in the store before an applied draft. */
export async function undoSuggestion(admin: AdminApiClient, suggestion: Suggestion): Promise<ApplyCheck> {
  const live = await readLive(admin, suggestion.kind, suggestion.targetId);
  if (!live.found) return { ok: false, error: GONE };

  const check = checkUndo({ ...suggestion, live: live.value });
  if (!check.ok) return check;

  const written = await write(admin, suggestion.kind, suggestion.targetId, suggestion.previous ?? "");
  if (!written.ok) return written;

  await prisma.$transaction([
    prisma.suggestion.update({
      where: { id: suggestion.id },
      data: { appliedAt: null, previous: null },
    }),
    prisma.issue.updateMany({
      where: { id: suggestion.issueId, status: "awaiting_verification" },
      data: { status: "open", markedResolvedAt: null },
    }),
  ]);
  return { ok: true };
}
