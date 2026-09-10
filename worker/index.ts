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

import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";
import {
  claimNextAudit,
  failAudit,
  reapStaleAudits,
  reportProgress,
  type ClaimedAudit,
} from "../app/queue.server";
import { collectAdminData } from "../app/collectors/admin";
import { explainFindings } from "../app/ai/prompts";
import { logUsage } from "../app/ai/generate";
import { SEVERITY_WEIGHTS, type Finding, type ShopData } from "../app/rules/types";
import { processAuditJob, type AuditProgress } from "./audit";

/**
 * How often to look for work when the queue is empty. Audits are not
 * latency-sensitive — a scan starting a few seconds late is invisible — and a
 * slower poll keeps a serverless Postgres from being held awake needlessly.
 */
const IDLE_POLL_MS = 10_000;

/** How often to reclaim audits abandoned by a dead worker. */
const REAP_INTERVAL_MS = 60_000;

/** Cap on findings sent to the LLM for explanation, highest severity first. */
const MAX_EXPLAINED_FINDINGS = 20;

let shuttingDown = false;

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

async function explain(
  findings: Finding[],
  shop: { domain: string; name: string | null; brandVoice: string | null },
): Promise<Map<string, string>> {
  const explanations = new Map<string, string>();
  if (findings.length === 0) return explanations;

  const ranked = [...findings]
    .sort((a, b) => SEVERITY_WEIGHTS[b.severity] - SEVERITY_WEIGHTS[a.severity])
    .slice(0, MAX_EXPLAINED_FINDINGS);

  try {
    const result = await explainFindings(ranked, {
      name: shop.name || shop.domain,
      brandVoice: shop.brandVoice || undefined,
    });
    for (const item of result.data.findings) {
      explanations.set(item.ruleId, `${item.explanation} ${item.recommendation}`.trim());
    }
    await logUsage(shop.domain, "explain", "gpt-4.1-mini", result.usage);
  } catch (error) {
    // An audit is still useful without prose — findings come from the rules.
    console.error(`[worker] explainFindings failed for ${shop.domain}:`, error);
  }

  return explanations;
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

  const result = await processAuditJob({ shopDomain, auditId }, shopData, onProgress);
  await progressWrites;

  const explanations = await explain(result.findings, shop);
  const targetTitles = buildTargetTitles(shopData);

  const counts = { high: 0, medium: 0, low: 0 };
  for (const finding of result.findings) counts[finding.severity]++;

  // One transaction so a partially-written audit is never shown as completed.
  await prisma.$transaction([
    prisma.finding.deleteMany({ where: { auditId } }),
    prisma.pageScore.deleteMany({ where: { auditId } }),
    prisma.finding.createMany({
      data: result.findings.map((finding) => ({
        auditId,
        ruleId: finding.ruleId,
        pageType: finding.page,
        severity: finding.severity,
        title: finding.title,
        explanation: explanations.get(finding.ruleId) || null,
        evidenceType: finding.evidence?.type || null,
        evidenceValue: finding.evidence?.value || null,
        fixableByAI: finding.fixableByAI,
        fixType: finding.fixType || null,
        targetId: finding.targetId || null,
        targetTitle: finding.targetId ? targetTitles.get(finding.targetId) || null : null,
      })),
    }),
    prisma.pageScore.createMany({
      data: result.pageResults.map((page) => ({
        auditId,
        pageType: page.pageType,
        pageUrl: page.url,
        croScore: page.croScore,
        perfScore: page.perfScore,
        issueCount: page.findings.length,
      })),
    }),
    prisma.audit.update({
      where: { id: auditId },
      data: {
        status: "completed",
        progress: 100,
        currentStep: null,
        overallScore: result.scores.overall,
        conversionScore: result.scores.conversion,
        uxScore: result.scores.ux,
        performanceScore: result.scores.performance,
        seoScore: result.scores.seo,
        productPagesScore: result.scores.productPages,
        totalIssues: result.findings.length,
        highCount: counts.high,
        mediumCount: counts.medium,
        lowCount: counts.low,
        completedAt: result.completedAt,
      },
    }),
  ]);

  console.log(
    `[worker] audit ${auditId} completed for ${shopDomain}: ` +
      `${result.findings.length} findings, score ${result.scores.overall}`,
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
      const { willRetry } = await failAudit(claimed, message);
      console.error(
        `[worker] audit ${claimed.id} failed on attempt ${claimed.attempts}` +
          `${willRetry ? " (will retry)" : " (giving up)"}: ${message}`,
      );
    }
  }

  return didWork;
}

async function main() {
  console.log(`[worker] polling for audits every ${IDLE_POLL_MS / 1000}s`);

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

  await prisma.$disconnect();
  console.log("[worker] stopped");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Don't hold the process open during shutdown.
    timer.unref?.();
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1); // second signal: force
    console.log(`[worker] ${signal} received, finishing current audit...`);
    shuttingDown = true;
  });
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
