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
import { calculateStoreHealth, collapseByRule, type ScorableIssue } from "../scoring";
import prisma from "../db.server";
import type { Explanation } from "./explanations";
import { fingerprint, normalizePath } from "./identity";
import { reconcile, type IssueStatus } from "./reconcile";
import { remedyForRule } from "../remedies/catalog";

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
  /**
   * Lighthouse score this scan measured, or null when it did not measure one.
   * The store score is recomputed from the shop's open issues after every
   * scan, so an area scan updates it too; the last measured speed score
   * carries over until a new speed scan replaces it.
   */
  performanceScore: number | null;
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
        known.map((issue) => ({ ...issue, page: issue.pageType, status: issue.status as IssueStatus })),
        current,
        {
          evaluatedRules: new Set(scan.evaluatedRules),
          scannedPaths: new Set(scan.scannedUrls.map(normalizePath)),
        },
        previouslyEvaluated,
      );

      const details = (finding: Finding) => {
        const advice = explanations.get(finding.ruleId);
        const remedy = remedyForRule(finding.ruleId);
        return {
          ruleId: finding.ruleId,
          pageType: finding.page,
          severity: finding.severity,
          title: finding.title,
          explanation: advice?.explanation ?? null,
          recommendation: advice?.recommendation ?? null,
          steps: advice?.steps ?? [],
          evidenceType: finding.evidence?.type ?? null,
          evidenceValue: finding.evidence?.value ?? null,
          pageUrl: finding.pageUrl ?? null,
          targetId: finding.targetId ?? null,
          targetTitle:
            finding.targetTitle ?? (finding.targetId ? targetTitles.get(finding.targetId) ?? null : null),
          imageUrl: finding.imageUrl ?? null,
          // Where the merchant acts. Settings and theme remedies name a fixed
          // destination; resource remedies take the id the scan recorded.
          remedy: remedy.kind,
          adminArea: remedy.area ?? null,
          adminRef: remedy.ref ?? finding.adminRef ?? finding.targetId ?? null,
          suggestionKind: remedy.suggestion ?? null,
        };
      };

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
            markedResolvedAt: null,
            verificationFailedAt: null,
          },
        });
      }
      for (const { issue, finding } of result.stillOpen) {
        await tx.issue.update({
          where: { id: issue.id },
          data: { ...details(finding.finding), lastSeenAt: completedAt, lastSeenAuditId: auditId },
        });
      }
      // Marked fixed, but this scan found it again. Back to open, and stamped
      // so the merchant is told the check did not pass rather than silently
      // losing the state they set.
      for (const { issue, finding } of result.verificationFailed) {
        await tx.issue.update({
          where: { id: issue.id },
          data: {
            ...details(finding.finding),
            status: "open",
            lastSeenAt: completedAt,
            lastSeenAuditId: auditId,
            markedResolvedAt: null,
            verificationFailedAt: completedAt,
          },
        });
      }
      if (result.resolved.length > 0) {
        await tx.issue.updateMany({
          where: { id: { in: result.resolved.map((issue) => issue.id) } },
          data: {
            status: "resolved",
            resolvedAt: completedAt,
            resolvedAuditId: auditId,
            verificationFailedAt: null,
          },
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

      await tx.pageScore.deleteMany({ where: { auditId } });
      if (scan.pageResults.length > 0) {
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

      // Store health after this scan: every issue still on the store, scored
      // together. A single-area scan only changes its own area's issues, so
      // the score moves by what this scan actually found or cleared.
      //
      // Issues awaiting verification count too. The merchant says they fixed
      // them, but no scan has confirmed it — improving the score on their word
      // would contradict the whole verification model.
      const open = await tx.issue.findMany({
        where: { shopId, status: { in: ["open", "awaiting_verification"] } },
        select: { ruleId: true, severity: true, pageType: true },
      });
      const scorable: ScorableIssue[] = open.map((issue) => ({
        ruleId: issue.ruleId,
        severity: issue.severity as ScorableIssue["severity"],
        page: issue.pageType,
      }));
      // Every rule this shop has ever had run, so a category is only scored
      // when something actually checked it. `previouslyEvaluated` also holds
      // rule IDs inferred from known issues, which is the right basis here too.
      const everEvaluated = new Set([...previouslyEvaluated, ...scan.evaluatedRules]);
      const health = calculateStoreHealth(scorable, {
        performanceScore: scan.performanceScore ?? (await lastMeasuredSpeed(tx, shopId, auditId)),
        evaluatedRules: everEvaluated,
      });
      // An unmeasured category is stored as null, never as a number. A zero
      // would read as "this store scored nothing" instead of "nothing was
      // measured", and the dashboard shows the two very differently.
      const scoreOf = (name: string) => {
        const category = health.categories.find((c) => c.category === name);
        return category?.measured ? category.score : null;
      };

      const prescriptions = collapseByRule(scan.findings);
      const counts = { high: 0, medium: 0, low: 0 };
      for (const finding of prescriptions) counts[finding.severity]++;

      await tx.audit.update({
        where: { id: auditId },
        data: {
          status: "completed",
          progress: 100,
          currentStep: null,
          overallScore: health.overall,
          conversionScore: scoreOf("conversion"),
          uxScore: scoreOf("ux"),
          performanceScore: scoreOf("performance"),
          seoScore: scoreOf("seo"),
          productPagesScore: scoreOf("productPages"),
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
 * The speed score from the shop's most recent scan that measured one. Speed
 * is measured only by a speed scan, so without this every other scan would
 * report the store as having no performance measurement at all.
 */
async function lastMeasuredSpeed(tx: Tx, shopId: string, auditId: string): Promise<number | null> {
  const audit = await tx.audit.findFirst({
    where: { shopId, status: "completed", id: { not: auditId }, performanceScore: { not: null } },
    orderBy: { completedAt: "desc" },
    select: { performanceScore: true },
  });
  return audit?.performanceScore ?? null;
}

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
      remedy: row.remedy,
      adminArea: row.adminArea,
      adminRef: row.adminRef,
      suggestionKind: row.suggestionKind,
      steps: row.steps,
      status: "open",
      firstSeenAt: row.firstSeenAt ?? seenAt,
      lastSeenAt: seenAt,
      lastSeenAuditId: latest.id,
      openedAuditId: latest.id,
      openedAsNew: false,
    })),
  });
}
