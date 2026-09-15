/**
 * Persist one completed scan: update the shop's issue list, store the scan's
 * findings snapshot, and mark the audit completed — all in one transaction.
 *
 * The transaction takes a per-shop advisory lock first. Two scans of the same
 * store (the queue avoids this, but two workers can still race) would
 * otherwise read the same issue list and overwrite each other's changes.
 */

import type { Finding } from "../rules/types";
import type { ScanScope } from "../scans/scopes";
import { collapseByRule } from "../scoring";
import prisma from "../db.server";
import type { Explanation } from "./explanations";
import { fingerprint, normalizePath } from "./identity";
import { reconcile } from "./reconcile";

export interface ScanRecord {
  shopId: string;
  auditId: string;
  scope: ScanScope;
  findings: Finding[];
  evaluatedRules: string[];
  scannedUrls: string[];
  pageResults: Array<{
    url: string;
    pageType: string;
    croScore: number;
    perfScore: number | null;
    findings: Finding[];
  }>;
  scores: {
    overall: number;
    conversion: number;
    ux: number;
    performance: number | null;
    seo: number;
    productPages: number;
  } | null;
  completedAt: Date;
  explanations: Map<string, Explanation>;
  targetTitles: Map<string, string>;
}

export interface ScanOutcome {
  opened: number;
  reopened: number;
  stillOpen: number;
  resolved: number;
  newCount: number;
}

/** Long enough for a large catalog's issue updates on a remote database. */
const TRANSACTION_TIMEOUT_MS = 60_000;

export async function recordScan(scan: ScanRecord): Promise<ScanOutcome> {
  const { shopId, auditId, completedAt, explanations, targetTitles } = scan;

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${shopId}))`;

      await seedFromLatestAudit(tx, shopId, auditId);

      const known = await tx.issue.findMany({ where: { shopId } });
      const earlierAudits = await tx.audit.findMany({
        where: { shopId, status: "completed", id: { not: auditId } },
        select: { evaluatedRules: true },
      });
      // A rule counts as already looked at if an earlier scan ran it, or an
      // issue from it is on record (scans from before rules were tracked).
      const previouslyEvaluated = new Set([
        ...earlierAudits.flatMap((audit) => audit.evaluatedRules),
        ...known.map((issue) => issue.ruleId),
      ]);

      const current = scan.findings.map((finding) => ({
        finding,
        ruleId: finding.ruleId,
        page: finding.page,
        pageUrl: finding.pageUrl ?? null,
        fingerprint: fingerprint(finding),
      }));

      const result = reconcile(
        known.map((issue) => ({ ...issue, page: issue.pageType, status: issue.status as "open" | "resolved" })),
        current,
        {
          evaluatedRules: new Set(scan.evaluatedRules),
          scannedPaths: new Set(scan.scannedUrls.map(normalizePath)),
        },
        previouslyEvaluated,
      );

      const details = (finding: Finding) => ({
        ruleId: finding.ruleId,
        pageType: finding.page,
        severity: finding.severity,
        title: finding.title,
        explanation: explanations.get(finding.ruleId)?.explanation ?? null,
        recommendation: explanations.get(finding.ruleId)?.recommendation ?? null,
        evidenceType: finding.evidence?.type ?? null,
        evidenceValue: finding.evidence?.value ?? null,
        pageUrl: finding.pageUrl ?? null,
        targetId: finding.targetId ?? null,
        targetTitle:
          finding.targetTitle ?? (finding.targetId ? targetTitles.get(finding.targetId) ?? null : null),
        imageUrl: finding.imageUrl ?? null,
        fixableByAI: finding.fixableByAI,
        fixType: finding.fixType ?? null,
      });

      if (result.opened.length > 0) {
        await tx.issue.createMany({
          data: result.opened.map(({ finding, isNew }) => ({
            shopId,
            fingerprint: finding.fingerprint,
            ...details(finding.finding),
            status: "open",
            firstSeenAt: completedAt,
            lastSeenAt: completedAt,
            lastSeenAuditId: auditId,
            openedAuditId: auditId,
            openedAsNew: isNew,
          })),
        });
      }
      for (const { issue, finding } of result.reopened) {
        await tx.issue.update({
          where: { id: issue.id },
          data: {
            ...details(finding.finding),
            status: "open",
            lastSeenAt: completedAt,
            lastSeenAuditId: auditId,
            openedAuditId: auditId,
            openedAsNew: true,
            resolvedAt: null,
            resolvedAuditId: null,
          },
        });
      }
      for (const { issue, finding } of result.stillOpen) {
        await tx.issue.update({
          where: { id: issue.id },
          data: { ...details(finding.finding), lastSeenAt: completedAt, lastSeenAuditId: auditId },
        });
      }
      if (result.resolved.length > 0) {
        await tx.issue.updateMany({
          where: { id: { in: result.resolved.map((issue) => issue.id) } },
          data: { status: "resolved", resolvedAt: completedAt, resolvedAuditId: auditId },
        });
      }

      // Snapshot of what this scan found, carrying each issue's history.
      const openedNew = new Map(result.opened.map(({ finding, isNew }) => [finding.fingerprint, isNew]));
      const reopenedKeys = new Set(result.reopened.map(({ issue }) => issue.fingerprint));
      const firstSeen = new Map(known.map((issue) => [issue.fingerprint, issue.firstSeenAt]));

      await tx.finding.deleteMany({ where: { auditId } });
      await tx.finding.createMany({
        data: current.map(({ finding, fingerprint: key }) => ({
          auditId,
          fingerprint: key,
          isNew: openedNew.get(key) === true || reopenedKeys.has(key),
          firstSeenAt: firstSeen.get(key) ?? completedAt,
          ...details(finding),
        })),
      });

      // Page scores only mean something for a scan that ran every page rule.
      await tx.pageScore.deleteMany({ where: { auditId } });
      if (scan.scope === "full") {
        await tx.pageScore.createMany({
          data: scan.pageResults.map((page) => ({
            auditId,
            pageType: page.pageType,
            pageUrl: page.url,
            croScore: page.croScore,
            perfScore: page.perfScore,
            issueCount: page.findings.length,
          })),
        });
      }

      const prescriptions = collapseByRule(scan.findings);
      const counts = { high: 0, medium: 0, low: 0 };
      for (const finding of prescriptions) counts[finding.severity]++;

      await tx.audit.update({
        where: { id: auditId },
        data: {
          status: "completed",
          progress: 100,
          currentStep: null,
          overallScore: scan.scores?.overall ?? null,
          conversionScore: scan.scores?.conversion ?? null,
          uxScore: scan.scores?.ux ?? null,
          performanceScore: scan.scores?.performance ?? null,
          seoScore: scan.scores?.seo ?? null,
          productPagesScore: scan.scores?.productPages ?? null,
          totalIssues: prescriptions.length,
          highCount: counts.high,
          mediumCount: counts.medium,
          lowCount: counts.low,
          evaluatedRules: scan.evaluatedRules,
          newCount: result.newCount,
          resolvedCount: result.resolvedCount,
          completedAt,
        },
      });

      return {
        opened: result.opened.length,
        reopened: result.reopened.length,
        stillOpen: result.stillOpen.length,
        resolved: result.resolvedCount,
        newCount: result.newCount,
      };
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 10_000 },
  );
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * A shop that was scanned before the issue list existed starts with an empty
 * list. Seed it from its latest completed scan, so the first scoped scan does
 * not make every other area's known issues disappear from the dashboard.
 */
async function seedFromLatestAudit(tx: Tx, shopId: string, currentAuditId: string): Promise<void> {
  if ((await tx.issue.count({ where: { shopId } })) > 0) return;

  const latest = await tx.audit.findFirst({
    where: { shopId, status: "completed", id: { not: currentAuditId } },
    orderBy: { completedAt: "desc" },
    include: { findings: true },
  });
  if (!latest || latest.findings.length === 0) return;

  const seenAt = latest.completedAt ?? latest.createdAt;
  const rows = new Map<string, (typeof latest.findings)[number]>();
  for (const row of latest.findings) {
    const key = row.fingerprint ?? fingerprint(row);
    if (!rows.has(key)) rows.set(key, row);
  }

  await tx.issue.createMany({
    data: [...rows].map(([key, row]) => ({
      shopId,
      fingerprint: key,
      ruleId: row.ruleId,
      pageType: row.pageType,
      severity: row.severity,
      title: row.title,
      explanation: row.explanation,
      recommendation: row.recommendation,
      evidenceType: row.evidenceType,
      evidenceValue: row.evidenceValue,
      pageUrl: row.pageUrl,
      targetId: row.targetId,
      targetTitle: row.targetTitle,
      imageUrl: row.imageUrl,
      fixableByAI: row.fixableByAI,
      fixType: row.fixType,
      status: "open",
      firstSeenAt: row.firstSeenAt ?? seenAt,
      lastSeenAt: seenAt,
      lastSeenAuditId: latest.id,
      openedAuditId: latest.id,
      openedAsNew: false,
    })),
  });
}
