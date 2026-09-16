/**
 * Audit worker — `npm run worker`.
 *
 * Polls the `Audit` table for pending jobs, claims one atomically, and runs
 * the audit: collects shop data, runs the deterministic rule engine, asks the
 * LLM only to *explain* what the rules found, then persists findings and
 * scores.
 *
 * No message broker. Postgres holds the queue (see app/queue.server.ts).
 */

import { hostname } from "node:os";
import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";
import {
  claimNextAudit,
  clearHeartbeat,
  failAudit,
  HEARTBEAT_INTERVAL_MS,
  reapStaleAudits,
  recordHeartbeat,
  reportProgress,
  type ClaimedAudit,
} from "../app/queue.server";
import { collectAdminData } from "../app/collectors/admin";
import { openStorefrontSession } from "../app/collectors/storefront";
import { collectCatalogImages } from "../app/collectors/images";
import { NonRetryableError, StorefrontLockedError } from "../app/errors";
import { EXPLAIN_PROMPT_VERSION, explainFindings } from "../app/ai/prompts";
import { logUsage } from "../app/ai/generate";
import { aiExplanationsRemaining } from "../app/billing/billing.server";
import type { Shop } from "@prisma/client";
import { SEVERITY_WEIGHTS, type Finding, type ShopData } from "../app/rules/types";
import { processAuditJob, type AuditProgress } from "./audit";
import { recordScan } from "../app/issues/store.server";
import { SCAN_SCOPES, isScanScope, needsStorefront, type ScanScope } from "../app/scans/scopes";
import {
  explanationContextHash,
  partitionByCache,
  type Explanation,
} from "../app/issues/explanations";

/**
 * How often to look for work when the queue is empty. Audits are not
 * latency-sensitive — a scan starting a few seconds late is invisible — and a
 * slower poll keeps a serverless Postgres from being held awake needlessly.
 */
const IDLE_POLL_MS = 10_000;

/** How often to reclaim audits abandoned by a dead worker. */
const REAP_INTERVAL_MS = 60_000;

/** Cap on distinct rules sent to the LLM for explanation, highest severity first. */
const MAX_EXPLAINED_RULES = 25;

const WORKER_ID = `${hostname()}:${process.pid}`;

let shuttingDown = false;

/** Resolves the current idle sleep early, so shutdown doesn't wait it out. */
let wakeFromSleep: (() => void) | null = null;

/** Build targetId -> human label lookups so findings can name what they point at. */
function buildTargetTitles(shopData: ShopData): Map<string, string> {
  const titles = new Map<string, string>();
  for (const product of shopData.products) {
    titles.set(product.id, product.title);
    for (const image of product.images) {
      titles.set(image.id, `${product.title} — image`);
    }
  }
  for (const collection of shopData.collections) {
    titles.set(collection.id, collection.title);
  }
  return titles;
}

/**
 * Explanations per rule, reusing what was already generated for this shop.
 * Only rules never explained before — or explained under an older prompt or
 * brand voice — are sent to the LLM, so re-scanning an unchanged store costs
 * no tokens.
 */
async function explainWithCache(
  findings: Finding[],
  shop: Shop,
): Promise<{ explanations: Map<string, Explanation>; generated: number; reused: number }> {
  // One entry per rule: the explanation is the same wherever the rule fired.
  const byRule = new Map<string, Finding>();
  for (const finding of findings) {
    if (!byRule.has(finding.ruleId)) byRule.set(finding.ruleId, finding);
  }
  if (byRule.size === 0) return { explanations: new Map(), generated: 0, reused: 0 };

  const shopName = shop.name || shop.domain;
  const contextHash = explanationContextHash({
    promptVersion: EXPLAIN_PROMPT_VERSION,
    shopName,
    brandVoice: shop.brandVoice,
  });
  const cached = await prisma.explanationCache.findMany({
    where: { shopId: shop.id, ruleId: { in: [...byRule.keys()] } },
  });
  const { hits, misses } = partitionByCache(byRule.keys(), cached, contextHash);
  const explanations = new Map(hits);
  if (misses.length === 0) return { explanations, generated: 0, reused: hits.size };

  // Plan allowance (FEATURES.md §11). Findings past it still show, with the
  // rule's own wording, and are explained once allowance is available again.
  const remaining = await aiExplanationsRemaining(shop);
  if (remaining === 0) {
    console.log(`[worker] ${shop.domain} has no AI explanations left this period; ${misses.length} rule(s) unexplained`);
    return { explanations, generated: 0, reused: hits.size };
  }

  const toExplain = misses
    .map((ruleId) => byRule.get(ruleId)!)
    .sort((a, b) => SEVERITY_WEIGHTS[b.severity] - SEVERITY_WEIGHTS[a.severity])
    .slice(0, Math.min(MAX_EXPLAINED_RULES, remaining));
  const requested = new Set(toExplain.map((finding) => finding.ruleId));

  try {
    const result = await explainFindings(toExplain, {
      name: shopName,
      brandVoice: shop.brandVoice || undefined,
    });
    const fresh = result.data.findings.filter((item) => requested.has(item.ruleId));
    for (const item of fresh) {
      explanations.set(item.ruleId, { explanation: item.explanation, recommendation: item.recommendation });
    }
    await prisma.$transaction(
      fresh.map((item) =>
        prisma.explanationCache.upsert({
          where: { shopId_ruleId: { shopId: shop.id, ruleId: item.ruleId } },
          create: {
            shopId: shop.id,
            ruleId: item.ruleId,
            contextHash,
            explanation: item.explanation,
            recommendation: item.recommendation,
          },
          update: { contextHash, explanation: item.explanation, recommendation: item.recommendation },
        }),
      ),
    );
    await logUsage(shop.domain, "explain", "gpt-4.1-mini", result.usage, fresh.length);
    return { explanations, generated: fresh.length, reused: hits.size };
  } catch (error) {
    // An audit is still useful without prose — findings come from the rules.
    console.error(`[worker] explainFindings failed for ${shop.domain}:`, error);
    return { explanations, generated: 0, reused: hits.size };
  }
}

async function runAudit(claimed: ClaimedAudit): Promise<void> {
  const { id: auditId, shopId } = claimed;

  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error(`Unknown shop for audit ${auditId}`);
  const shopDomain = shop.domain;

  // Serialise progress writes; processAuditJob fires onProgress without awaiting.
  let progressWrites: Promise<unknown> = Promise.resolve();
  const onProgress = (progress: AuditProgress) => {
    progressWrites = progressWrites.then(() =>
      reportProgress(auditId, progress.percent, progress.currentStep),
    );
  };

  const { admin } = await unauthenticated.admin(shopDomain);
  const shopData = await collectAdminData(admin);

  const scope: ScanScope = isScanScope(claimed.scope) ? claimed.scope : "full";
  const spec = SCAN_SCOPES[scope];

  // Only scans that read storefront pages need to get past the password page;
  // image and alt-text scans use the Admin API alone.
  let storefrontCookie: string | undefined;
  if (needsStorefront(scope) && shopData.passwordProtected) {
    if (!shop.storefrontPassword) {
      throw new StorefrontLockedError(
        "Your storefront is password-protected, so StoreRx can only see the password " +
          "page. Add your storefront password in StoreRx Settings to scan your real pages.",
      );
    }
    onProgress({ status: "running", currentStep: "Unlocking storefront", current: 0, total: 0, percent: 0 });
    storefrontCookie = await openStorefrontSession(shopDomain, shop.storefrontPassword);
  }

  const result = await processAuditJob({ shopDomain, auditId, scope }, shopData, onProgress, {
    storefrontCookie,
    collectImages: spec.catalogImages ? () => collectCatalogImages(admin, shopDomain) : undefined,
  });
  await progressWrites;

  // Only this scan's findings are explained, and cached rules cost nothing.
  const { explanations, generated, reused } = await explainWithCache(result.findings, shop);

  const outcome = await recordScan({
    shopId,
    auditId,
    scope,
    findings: result.findings,
    evaluatedRules: result.evaluatedRules,
    scannedUrls: result.scannedUrls,
    pageResults: result.pageResults,
    scores: result.scores,
    completedAt: result.completedAt,
    explanations,
    targetTitles: buildTargetTitles(shopData),
  });

  console.log(
    `[worker] ${spec.label.toLowerCase()} scan ${auditId} completed for ${shopDomain}: ` +
      `${result.findings.length} findings from ${result.evaluatedRules.length} rules; ` +
      `${outcome.newCount} new, ${outcome.resolved} fixed, ${outcome.stillOpen} still open; ` +
      `explanations ${generated} generated, ${reused} reused`,
  );
}

/**
 * Drain the queue, then resolve. Returns whether any job ran, so the caller
 * can poll immediately when busy and back off when idle.
 */
async function drain(): Promise<boolean> {
  let didWork = false;

  while (!shuttingDown) {
    const claimed = await claimNextAudit();
    if (!claimed) break;
    didWork = true;

    try {
      await runAudit(claimed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const { willRetry } = await failAudit(claimed, message, {
        retryable: !(error instanceof NonRetryableError),
      });
      console.error(
        `[worker] audit ${claimed.id} failed on attempt ${claimed.attempts}` +
          `${willRetry ? " (will retry)" : " (giving up)"}: ${message}`,
      );
    }
  }

  return didWork;
}

async function main() {
  console.log(`[worker] ${WORKER_ID} polling for audits every ${IDLE_POLL_MS / 1000}s`);

  // On its own timer rather than in the poll loop: an audit takes minutes, and
  // the dashboard must not decide the worker is dead while it is mid-audit.
  await recordHeartbeat(WORKER_ID);
  const heartbeat = setInterval(() => void recordHeartbeat(WORKER_ID), HEARTBEAT_INTERVAL_MS);

  let lastReapAt = 0;

  while (!shuttingDown) {
    try {
      if (Date.now() - lastReapAt > REAP_INTERVAL_MS) {
        const reaped = await reapStaleAudits();
        if (reaped > 0) console.log(`[worker] reclaimed ${reaped} stalled audit(s)`);
        lastReapAt = Date.now();
      }

      const didWork = await drain();
      if (didWork) continue; // more may have arrived while we worked
    } catch (error) {
      // Never let a transient DB error kill the loop.
      console.error("[worker] poll cycle failed:", error);
    }

    await sleep(IDLE_POLL_MS);
  }

  clearInterval(heartbeat);
  await clearHeartbeat(WORKER_ID);
  await prisma.$disconnect();
  console.log("[worker] stopped");
}

/**
 * Interruptible sleep. The timer is deliberately *not* unref'd: an idle worker
 * has nothing else holding the event loop open, so an unref'd timer let Node
 * decide the process was finished and exit the moment the queue emptied.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeFromSleep = null;
      resolve();
    }, ms);
    wakeFromSleep = () => {
      clearTimeout(timer);
      wakeFromSleep = null;
      resolve();
    };
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1); // second signal: force
    console.log(`[worker] ${signal} received, finishing current audit...`);
    shuttingDown = true;
    wakeFromSleep?.();
  });
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
