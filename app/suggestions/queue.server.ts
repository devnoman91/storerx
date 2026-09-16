/**
 * Draft queue (server only).
 *
 * Drafting copy needs an LLM — and for alt text, a vision call over the image
 * — so it cannot happen in a request handler. The `Suggestion` table is the
 * queue, claimed the same way audits are (app/queue.server.ts): one row at a
 * time, `FOR UPDATE SKIP LOCKED`, no broker.
 *
 * A draft is only ever read by the merchant. Nothing here writes to the store.
 */

import prisma from "../db.server";
import type { SuggestionKind } from "../remedies/types";

/** Claims allowed per draft before it is left failed. */
export const MAX_ATTEMPTS = 2;

/** A draft still running after this long is assumed dead and reclaimed. */
export const STALE_DRAFT_MS = 5 * 60 * 1000;

export type SuggestionStatus = "pending" | "ready" | "failed";

export interface ClaimedSuggestion {
  id: string;
  shopId: string;
  issueId: string;
  kind: string;
  targetId: string;
  attempts: number;
}

export interface DraftRequest {
  shopId: string;
  issueId: string;
  kind: SuggestionKind;
  targetId: string;
  targetTitle: string | null;
  imageUrl: string | null;
}

/**
 * Queue a draft, replacing any earlier one for the same resource. Asking
 * again is how a merchant says "try a different angle", so the previous
 * draft is cleared rather than shown alongside the new one.
 */
export async function requestDraft(request: DraftRequest): Promise<{ id: string }> {
  const { shopId, issueId, kind, targetId, targetTitle, imageUrl } = request;

  const suggestion = await prisma.suggestion.upsert({
    where: { issueId_targetId_kind: { issueId, targetId, kind } },
    create: { shopId, issueId, kind, targetId, targetTitle, imageUrl, status: "pending" },
    update: {
      status: "pending",
      attempts: 0,
      suggested: null,
      error: null,
      readyAt: null,
      targetTitle,
      imageUrl,
    },
    select: { id: true },
  });
  return { id: suggestion.id };
}

/** Atomically claim the oldest pending draft and mark it running. */
export async function claimNextSuggestion(): Promise<ClaimedSuggestion | null> {
  const rows = await prisma.$queryRaw<ClaimedSuggestion[]>`
    UPDATE "Suggestion" SET
      attempts = attempts + 1,
      error = NULL
    WHERE id = (
      SELECT candidate.id FROM "Suggestion" candidate
      WHERE candidate.status = 'pending'
        AND candidate.attempts < ${MAX_ATTEMPTS}
      ORDER BY candidate."createdAt"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, "shopId", "issueId", kind, "targetId", attempts
  `;
  return rows[0] ?? null;
}

export async function completeDraft(
  id: string,
  result: { current: string | null; suggested: string },
): Promise<void> {
  await prisma.suggestion.update({
    where: { id },
    data: {
      status: "ready",
      current: result.current,
      suggested: result.suggested,
      error: null,
      readyAt: new Date(),
    },
  });
}

/** Mark a failed draft, leaving it pending while it has attempts left. */
export async function failDraft(
  claimed: ClaimedSuggestion,
  message: string,
): Promise<{ willRetry: boolean }> {
  const willRetry = claimed.attempts < MAX_ATTEMPTS;
  await prisma.suggestion.update({
    where: { id: claimed.id },
    data: { status: willRetry ? "pending" : "failed", error: message.slice(0, 300) },
  });
  return { willRetry };
}

/**
 * Fail drafts whose worker died mid-run, so the merchant sees an error they
 * can retry instead of a spinner that never stops.
 */
export async function reapStaleDrafts(shopId?: string): Promise<number> {
  const result = await prisma.suggestion.updateMany({
    where: {
      ...(shopId ? { shopId } : {}),
      status: "pending",
      attempts: { gte: MAX_ATTEMPTS },
      createdAt: { lt: new Date(Date.now() - STALE_DRAFT_MS) },
    },
    data: { status: "failed", error: "Drafting timed out" },
  });
  return result.count;
}
