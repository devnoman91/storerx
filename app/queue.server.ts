/**
 * Audit job queue (server only).
 *
 * The `Audit` table *is* the queue — there is no external broker. Workers
 * claim `pending` rows with `SELECT ... FOR UPDATE SKIP LOCKED`, which is
 * atomic, so any number of workers can run without double-processing a job.
 *
 * Request handlers may only enqueue. Every heavy step (page fetches,
 * PageSpeed, OpenAI) runs in `worker/index.ts`.
 */

import prisma from "./db.server";

/** An audit still "running" after this long is assumed dead and reclaimed. */
export const STALE_AUDIT_MS = 15 * 60 * 1000;

/** Claims allowed per audit before it is abandoned, so a crash can't loop. */
export const MAX_ATTEMPTS = 2;

export interface ClaimedAudit {
  id: string;
  shopId: string;
  attempts: number;
}

/**
 * Add an audit to the queue. Returns the existing one if a scan is already
 * queued or running for this shop, so a double-click cannot start two.
 */
export async function enqueueAudit(shopId: string): Promise<{ id: string; created: boolean }> {
  const inFlight = await prisma.audit.findFirst({
    where: {
      shopId,
      status: { in: ["pending", "running"] },
      createdAt: { gte: new Date(Date.now() - STALE_AUDIT_MS) },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (inFlight) return { id: inFlight.id, created: false };

  const audit = await prisma.audit.create({
    data: { shopId, status: "pending" },
    select: { id: true },
  });
  return { id: audit.id, created: true };
}

/**
 * Atomically claim the oldest pending audit and mark it running.
 *
 * `FOR UPDATE SKIP LOCKED` makes concurrent workers skip rows another worker
 * is already claiming rather than blocking on them. Prisma's query API cannot
 * express this, hence raw SQL.
 */
export async function claimNextAudit(): Promise<ClaimedAudit | null> {
  const rows = await prisma.$queryRaw<ClaimedAudit[]>`
    UPDATE "Audit" SET
      status = 'running',
      "startedAt" = NOW(),
      progress = 0,
      attempts = attempts + 1,
      error = NULL
    WHERE id = (
      SELECT id FROM "Audit"
      WHERE status = 'pending' AND attempts < ${MAX_ATTEMPTS}
      ORDER BY "createdAt"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, "shopId", attempts
  `;
  return rows[0] ?? null;
}

/** Record progress from a running job. Never throws — progress is advisory. */
export async function reportProgress(
  auditId: string,
  progress: number,
  currentStep: string | null,
): Promise<void> {
  try {
    await prisma.audit.update({
      where: { id: auditId },
      data: { progress, currentStep },
    });
  } catch (error) {
    console.error(`[queue] progress update failed for ${auditId}:`, error);
  }
}

/**
 * Mark a failed audit. It returns to `pending` for one more try while it has
 * attempts left, otherwise it stays `failed`.
 */
export async function failAudit(
  audit: ClaimedAudit,
  message: string,
): Promise<{ willRetry: boolean }> {
  const willRetry = audit.attempts < MAX_ATTEMPTS;
  await prisma.audit.update({
    where: { id: audit.id },
    data: {
      status: willRetry ? "pending" : "failed",
      currentStep: null,
      error: message.slice(0, 500),
    },
  });
  return { willRetry };
}

/**
 * Reclaim audits whose worker died mid-run, so they retry instead of showing
 * a scan that never finishes. Cheap enough to call from a loader.
 */
export async function reapStaleAudits(shopId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_AUDIT_MS);

  const retryable = await prisma.audit.updateMany({
    where: {
      ...(shopId ? { shopId } : {}),
      status: "running",
      createdAt: { lt: cutoff },
      attempts: { lt: MAX_ATTEMPTS },
    },
    data: { status: "pending", currentStep: null, error: "Scan timed out, retrying" },
  });

  const exhausted = await prisma.audit.updateMany({
    where: {
      ...(shopId ? { shopId } : {}),
      status: { in: ["pending", "running"] },
      createdAt: { lt: cutoff },
      attempts: { gte: MAX_ATTEMPTS },
    },
    data: { status: "failed", currentStep: null, error: "Scan timed out" },
  });

  return retryable.count + exhausted.count;
}
