import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher, useRevalidator } from "react-router";
import { useEffect, useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { enqueueAudit, isWorkerAlive, reapStaleAudits } from "../queue.server";
import { checkScanAllowed, getShopUsage } from "../billing/billing.server";
import { scanLimitMessage } from "../billing/plans";
import { isCatalogPage } from "../scoring";
import { SCAN_SCOPES, SCAN_SCOPE_ORDER, isScanScope, isSelectableScope, type ScanScope } from "../scans/scopes";
import { actionsFor, type IssueStatus } from "../remedies/actions";
import type { RemedyKind, SuggestionKind } from "../remedies/types";
import { IssueGroup, pagePath, issueHref, type PrescriptionView } from "../components/issue-ui";
import { Callout, ScoreBar, ScoreDial, ShowMore, StateCard } from "../components/primitives";
import { AI_CREDIT_HINT, UsageRow, type UsageCount } from "../components/usage";
import { HowItWorks } from "../components/how-it-works";
import {
  AREA_ICON,
  CATEGORY,
  CATEGORY_ORDER,
  scoreBand,
  severityToken,
  UNMEASURED,
  type UnmeasuredReason,
} from "../components/tokens";
import { planScanSteps, stepStates } from "../scans/steps";
import { calculateStoreHealth, type ScoreCategory, type ScorableIssue } from "../scoring";
import { catalogTitle } from "../issues/wording";

/** How far back "recently verified" looks. */
const RECENTLY_VERIFIED_DAYS = 14;

type IssueRow = {
  id: string;
  ruleId: string;
  pageType: string;
  severity: string;
  title: string;
  explanation: string | null;
  pageUrl: string | null;
  targetTitle: string | null;
  remedy: string;
  adminArea: string | null;
  adminRef: string | null;
  suggestionKind: string | null;
  status: string;
  verificationFailedAt: Date | null;
  isNew: boolean;
};

/** Remedies whose destination is the same whatever the issue affects. */
function hasFixedDestination(remedy: string): boolean {
  return remedy === "settings" || remedy === "theme";
}

/**
 * One card per rule: a rule that fired on five pages or forty images is one
 * problem to solve, not forty. Scoring groups the same way (collapseByRule),
 * so the counts on the dashboard and in a scan's summary agree.
 */
function toPrescriptions(rows: IssueRow[]): PrescriptionView[] {
  const groups = new Map<string, IssueRow[]>();
  for (const row of rows) {
    const group = groups.get(row.ruleId);
    if (group) group.push(row);
    else groups.set(row.ruleId, [row]);
  }

  return [...groups.values()].map((group) => {
    const [first] = group;
    const catalog = isCatalogPage(first.pageType);
    const places = new Set(group.map((row) => row.pageUrl ?? row.targetTitle)).size;

    // Every occurrence is awaiting verification, or the problem is still open.
    const status: IssueStatus = group.every((row) => row.status === "awaiting_verification")
      ? "awaiting_verification"
      : "open";

    // A card cannot link to one product when it covers eight; the detail page
    // links each one individually.
    const linkable = group.length === 1 || hasFixedDestination(first.remedy);

    const actions = actionsFor({
      remedy: first.remedy as RemedyKind,
      status,
      suggestion: first.suggestionKind as SuggestionKind | null,
      adminArea: first.adminArea as never,
      adminRef: linkable ? first.adminRef : null,
    });

    const subtitle =
      group.length === 1
        ? first.targetTitle ?? pagePath(first.pageUrl)
        : catalog
          ? `Across ${places} ${places === 1 ? "product" : "products"}`
          : `On ${places} ${places === 1 ? "page" : "pages"}`;

    return {
      ruleId: first.ruleId,
      title: catalog ? catalogTitle(first.ruleId, group.length) ?? first.title : first.title,
      severity: first.severity,
      remedy: first.remedy,
      status,
      isNew: group.some((row) => row.isNew),
      verificationFailed: group.some((row) => row.verificationFailedAt !== null),
      explanation: first.explanation,
      subtitle,
      primaryLabel: actions.primary.label,
      // Only a real destination goes on the card; the rest is on the detail page.
      secondary: actions.secondary?.href ? actions.secondary : null,
      count: group.length,
    };
  });
}

const bySeverity = (a: { severity: string }, b: { severity: string }) =>
  severityToken(a.severity).rank - severityToken(b.severity).rank;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) {
    shop = await prisma.shop.create({ data: { domain: shopDomain } });
  }
  const shopId = shop.id;

  // An audit whose worker died would otherwise block new scans forever.
  await reapStaleAudits(shopId);

  const since = new Date(Date.now() - RECENTLY_VERIFIED_DAYS * 24 * 60 * 60 * 1000);
  const [outstanding, verified, inFlight, latestScan, lastByScope, completedAudits, failedScan, planUsage] =
    await Promise.all([
      prisma.issue.findMany({
        where: { shopId, status: { in: ["open", "awaiting_verification"] } },
        orderBy: { lastSeenAt: "desc" },
      }),
      prisma.issue.findMany({
        where: { shopId, status: "resolved", resolvedAt: { gte: since } },
        orderBy: { resolvedAt: "desc" },
      }),
      prisma.audit.findMany({
        where: { shopId, status: { in: ["pending", "running"] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true, progress: true, currentStep: true, scope: true },
      }),
      prisma.audit.findFirst({
        where: { shopId, status: "completed" },
        orderBy: { completedAt: "desc" },
        select: {
          id: true,
          scope: true,
          completedAt: true,
          newCount: true,
          resolvedCount: true,
          createdAt: true,
          // Scores are recomputed from every open issue after each scan, so
          // the most recent scan holds current store health whatever it covered.
          overallScore: true,
          conversionScore: true,
          productPagesScore: true,
          performanceScore: true,
          seoScore: true,
          uxScore: true,
        },
      }),
      prisma.audit.groupBy({
        by: ["scope"],
        where: { shopId, status: "completed" },
        _max: { completedAt: true },
      }),
      // Which checks this shop has ever had run, and the last speed it
      // measured. Health is derived from these rather than read back from the
      // last scan's stored score, so it is always current.
      prisma.audit.findMany({
        where: { shopId, status: "completed" },
        orderBy: { completedAt: "desc" },
        select: { evaluatedRules: true, performanceScore: true },
      }),
      prisma.audit.findFirst({
        where: { shopId, status: "failed" },
        orderBy: { createdAt: "desc" },
        select: { id: true, error: true, createdAt: true, scope: true },
      }),
      getShopUsage(shop),
    ]);

  const rows: IssueRow[] = outstanding
    .map((issue) => ({
      ...issue,
      // "New" until a later scan sees the issue again.
      isNew: issue.openedAsNew && issue.openedAuditId === issue.lastSeenAuditId,
    }))
    .sort(bySeverity);
  const prescriptions = toPrescriptions(rows);

  // Verified issues collapse by rule too, so "3 verified" counts problems
  // solved rather than rows touched.
  const verifiedByRule = new Map<string, { title: string; count: number; pageType: string }>();
  for (const issue of verified) {
    const entry = verifiedByRule.get(issue.ruleId);
    if (entry) entry.count += 1;
    else verifiedByRule.set(issue.ruleId, { title: issue.title, count: 1, pageType: issue.pageType });
  }

  const running = inFlight.find((audit) => audit.status === "running") ?? inFlight[0] ?? null;

  // Which areas have ever been checked, and what to check next. The order in
  // SCAN_SCOPE_ORDER is the order StoreRx recommends, so "next" is simply the
  // first area no scan has finished — no invented priority.
  const inFlightScopes = new Set(inFlight.map((audit) => audit.scope));
  const unscanned = SCAN_SCOPE_ORDER.filter((scope) => !lastScanned.has(scope));
  const queueable = unscanned.filter((scope) => !inFlightScopes.has(scope));
  const scansLeft =
    planUsage.plan.limits.scans === null
      ? null
      : Math.max(0, planUsage.plan.limits.scans - planUsage.usage.scans);

  // Health, recomputed from what is on the store right now and what has
  // actually been checked. A category nothing has examined reports no score
  // rather than a flattering one, and the reason it has none is shown.
  const evaluatedRules = new Set(completedAudits.flatMap((audit) => audit.evaluatedRules));
  const lastMeasuredSpeed =
    completedAudits.find((audit) => audit.performanceScore !== null)?.performanceScore ?? null;
  const scorable: ScorableIssue[] = outstanding.map((issue) => ({
    ruleId: issue.ruleId,
    severity: issue.severity as ScorableIssue["severity"],
    page: issue.pageType,
  }));
  const health = calculateStoreHealth(scorable, {
    performanceScore: lastMeasuredSpeed,
    evaluatedRules,
  });
  const lastScanned = new Map(lastByScope.map((row) => [row.scope, row._max.completedAt]));
  const scopeLabel = (scope: string) => (isScanScope(scope) ? SCAN_SCOPES[scope].label : scope);

  return {
    hasScan: Boolean(latestScan),
    health: {
      // No scan at all means no score, rather than a score built from nothing.
      overall: completedAudits.length > 0 ? health.overall : null,
      checksRun: health.categories.reduce((sum, c) => sum + c.checksRun, 0),
      checksTotal: health.categories.reduce((sum, c) => sum + c.checksTotal, 0),
      categories: CATEGORY_ORDER.map((category) => {
        const scored = health.categories.find((c) => c.category === category);
        return {
          category,
          score: scored?.measured ? scored.score : null,
          checksRun: scored?.checksRun ?? 0,
          checksTotal: scored?.checksTotal ?? 0,
          unmeasured: (scored?.measured
            ? null
            : (scored?.checksTotal ?? 0) === 0
              ? "no-checks"
              : "not-scanned") as UnmeasuredReason | null,
        };
      }),
    },
    latestScan: latestScan
      ? {
          id: latestScan.id,
          label: scopeLabel(latestScan.scope),
          date: (latestScan.completedAt ?? latestScan.createdAt).toLocaleString(),
          newCount: latestScan.newCount,
          resolvedCount: latestScan.resolvedCount,
        }
      : null,
    queued: inFlight
      .filter((audit) => audit.status === "pending")
      .map((audit) => ({ id: audit.id, label: scopeLabel(audit.scope) })),
    runningAudit: running
      ? {
          ...running,
          label: scopeLabel(running.scope),
          // The same list the worker walks, so the merchant sees what is
          // actually being checked rather than a bar with no explanation.
          steps: isScanScope(running.scope)
            ? planScanSteps(running.scope).map((step, index) => ({
                label: step,
                state: stepStates(planScanSteps(running.scope as ScanScope), running.currentStep)[index],
              }))
            : [],
          detail: running.currentStep,
        }
      : null,
    // Only worth a query while something is waiting to be picked up.
    workerAlive: running?.status === "pending" ? await isWorkerAlive() : true,
    failedScan:
      failedScan && (!latestScan || failedScan.createdAt > latestScan.createdAt)
        ? {
            id: failedScan.id,
            label: scopeLabel(failedScan.scope),
            error: failedScan.error ?? "unknown error",
          }
        : null,
    coverage: {
      checked: SCAN_SCOPE_ORDER.length - unscanned.length,
      total: SCAN_SCOPE_ORDER.length,
      // The next area to check, so the merchant is never left choosing between
      // nine buttons with nothing to go on.
      next: queueable[0]
        ? { scope: queueable[0], label: SCAN_SCOPES[queueable[0]].label, description: SCAN_SCOPES[queueable[0]].description }
        : null,
      remaining: queueable.length,
      scansLeft,
    },
    areas: SCAN_SCOPE_ORDER.map((scope) => {
      const spec = SCAN_SCOPES[scope];
      const when = lastScanned.get(scope);
      return {
        scope,
        label: spec.label,
        description: spec.description,
        lastScanned: when ? when.toLocaleString() : null,
        openIssues: new Set(rows.filter((row) => spec.includesRule(row.ruleId)).map((row) => row.ruleId)).size,
        state: inFlight.some((a) => a.scope === scope && a.status === "running")
          ? ("scanning" as const)
          : inFlight.some((a) => a.scope === scope)
            ? ("queued" as const)
            : ("idle" as const),
      };
    }),
    plan: {
      label: planUsage.plan.label,
      isFree: planUsage.plan.key === "free",
      resetsAt: planUsage.resetsAt.toDateString(),
      scans: { used: planUsage.usage.scans, limit: planUsage.plan.limits.scans },
      aiCredits: { used: planUsage.usage.aiCredits, limit: planUsage.plan.limits.aiCredits },
      // Scans still run without credits; they just arrive unexplained. Saying
      // so beats letting a merchant wonder why the advice stopped.
      creditsSpent: planUsage.usage.aiCredits >= planUsage.plan.limits.aiCredits,
    },
    critical: prescriptions.filter((p) => p.severity === "high"),
    improvements: prescriptions.filter((p) => p.severity === "medium"),
    minor: prescriptions.filter((p) => p.severity === "low"),
    awaitingCount: prescriptions.filter((p) => p.status === "awaiting_verification").length,
    verified: [...verifiedByRule.entries()].map(([ruleId, entry]) => ({
      ruleId,
      title: isCatalogPage(entry.pageType) ? catalogTitle(ruleId, entry.count) ?? entry.title : entry.title,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  let shopRow = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shopRow) shopRow = await prisma.shop.create({ data: { domain: shopDomain } });

  // A queued scan has not started, so cancelling it removes the row entirely
  // rather than filing it in History as a failure the merchant did not cause.
  if (intent === "cancelScan") {
    const removed = await prisma.audit.deleteMany({
      where: { id: String(formData.get("auditId") ?? ""), shopId: shopRow.id, status: "pending" },
    });
    return removed.count > 0
      ? { ok: true as const, cancelled: true as const }
      : { ok: false as const, error: "That scan has already started, so it can't be cancelled." };
  }

  // Queue every area that has never been checked, as far as the plan allows.
  if (intent === "scanRemaining") {
    const { plan, usage, resetsAt } = await getShopUsage(shopRow);
    const done = await prisma.audit.groupBy({
      by: ["scope"],
      where: { shopId: shopRow.id, status: { in: ["completed", "pending", "running"] } },
    });
    const covered = new Set(done.map((row) => row.scope));
    const todo = SCAN_SCOPE_ORDER.filter((scope) => !covered.has(scope));
    if (todo.length === 0) return { ok: true as const, queuedCount: 0 };

    const allowed = plan.limits.scans === null ? todo.length : Math.max(0, plan.limits.scans - usage.scans);
    if (allowed === 0) {
      return { ok: false as const, error: scanLimitMessage(plan, resetsAt), limitReached: true as const };
    }

    const queue = todo.slice(0, allowed);
    for (const scope of queue) await enqueueAudit(shopRow.id, scope);
    return { ok: true as const, queuedCount: queue.length, skipped: todo.length - queue.length };
  }

  if (intent !== "scan") {
    return { ok: false, error: `Unsupported action: ${String(intent)}` };
  }
  const requested = formData.get("scope");
  if (!isSelectableScope(requested)) {
    return { ok: false, error: `Unknown scan area: ${String(requested)}` };
  }

  // A repeat request for an area already queued joins that scan, so it is not
  // charged against the plan a second time.
  const queued = await prisma.audit.findFirst({
    where: { shopId: shopRow.id, scope: requested, status: { in: ["pending", "running"] } },
    select: { id: true },
  });
  if (queued) return { ok: true, auditId: queued.id, alreadyQueued: true };

  const allowed = await checkScanAllowed(shopRow);
  if (!allowed.allowed) {
    return { ok: false, error: allowed.message, limitReached: true };
  }

  const { id, created } = await enqueueAudit(shopRow.id, requested);
  return { ok: true, auditId: id, alreadyQueued: !created };
};

type AreaRow = {
  scope: ScanScope;
  label: string;
  description: string;
  lastScanned: string | null;
  openIssues: number;
  state: "idle" | "queued" | "scanning";
};

/**
 * The one number a merchant should see first, with the reason it is that
 * number right next to it. An unscanned store shows an empty dial rather than
 * a zero — nothing has been measured, which is not the same as scoring badly.
 */
function HealthHero({
  health,
  coverage,
  latestScan,
  critical,
  improvements,
  minor,
  awaiting,
  onScan,
  onScanArea,
  onScanRemaining,
  busy,
}: {
  health: { overall: number | null; checksRun: number; checksTotal: number };
  coverage: {
    checked: number;
    total: number;
    next: { scope: ScanScope; label: string; description: string } | null;
    remaining: number;
    scansLeft: number | null;
  };
  latestScan: { id: string; label: string; date: string; newCount: number; resolvedCount: number } | null;
  critical: number;
  improvements: number;
  minor: number;
  awaiting: number;
  onScan: () => void;
  onScanArea: (scope: ScanScope) => void;
  onScanRemaining: () => void;
  busy: boolean;
}) {
  const band = typeof health.overall === "number" ? scoreBand(health.overall) : null;
  const partial = health.checksRun < health.checksTotal;

  return (
    <s-section>
      <s-stack direction="inline" gap="large-100" alignItems="center">
        <ScoreDial score={health.overall} label="out of 100" />

        <s-stack direction="block" gap="small">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-heading>Store health</s-heading>
            {band && <s-badge tone={band.tone}>{band.label}</s-badge>}
          </s-stack>

          <s-paragraph color="subdued">
            {band
              ? band.summary
              : "Scan an area below and StoreRx will examine it, explain what it finds and recommend what to do."}
          </s-paragraph>

          {/* A score from four checks is not a verdict on the whole store, and
              should not look like one. */}
          {band && (
            <s-stack direction="inline" gap="small-300" alignItems="center">
              <s-icon
                type={partial ? "alert-circle" : "check-circle"}
                tone={partial ? "caution" : "success"}
                size="small"
              />
              <s-text color="subdued">
                {partial
                  ? `Based on ${health.checksRun} of ${health.checksTotal} checks — scan more areas for a fuller picture`
                  : `Based on all ${health.checksTotal} checks`}
              </s-text>
            </s-stack>
          )}

          {(critical > 0 || improvements > 0 || minor > 0 || awaiting > 0) && (
            <s-stack direction="inline" gap="small-300" alignItems="center">
              {critical > 0 && (
                <s-badge tone="critical" icon="alert-triangle">{`${critical} critical`}</s-badge>
              )}
              {improvements > 0 && (
                <s-badge tone="warning" icon="alert-circle">{`${improvements} to improve`}</s-badge>
              )}
              {minor > 0 && <s-badge tone="neutral">{`${minor} minor`}</s-badge>}
              {awaiting > 0 && (
                <s-badge tone="info" icon="clock">{`${awaiting} awaiting verification`}</s-badge>
              )}
            </s-stack>
          )}

          {latestScan && (
            <s-stack direction="inline" gap="small-300" alignItems="center">
              <s-text color="subdued">
                {`Last scan: ${latestScan.label}, ${latestScan.date} · ${latestScan.newCount} new · ${latestScan.resolvedCount} verified`}
              </s-text>
              {/* Straight to what that scan checked and found. */}
              <s-link href={`/app/history/${latestScan.id}`}>See the report</s-link>
            </s-stack>
          )}

          <NextStep
            coverage={coverage}
            busy={busy}
            onScanArea={onScanArea}
            onScanRemaining={onScanRemaining}
            onBrowse={onScan}
          />
        </s-stack>
      </s-stack>
    </s-section>
  );
}

/**
 * What to do next. A merchant looking at nine areas has no way to know where
 * to start, so StoreRx names one — the first area in its recommended order
 * that has never been checked — and offers to queue the rest.
 */
function NextStep({
  coverage,
  busy,
  onScanArea,
  onScanRemaining,
  onBrowse,
}: {
  coverage: {
    checked: number;
    total: number;
    next: { scope: ScanScope; label: string; description: string } | null;
    remaining: number;
    scansLeft: number | null;
  };
  busy: boolean;
  onScanArea: (scope: ScanScope) => void;
  onScanRemaining: () => void;
  onBrowse: () => void;
}) {
  const { next, remaining, scansLeft } = coverage;
  const canQueueAll = remaining > 1 && (scansLeft === null || scansLeft > 1);
  const willQueue = scansLeft === null ? remaining : Math.min(remaining, scansLeft);

  return (
    <s-stack direction="block" gap="small">
      <s-stack direction="inline" gap="small-300" alignItems="center">
        <s-icon
          type={coverage.checked === coverage.total ? "check-circle" : "clipboard-checklist"}
          tone={coverage.checked === coverage.total ? "success" : "info"}
          size="small"
        />
        <s-text color="subdued">
          {`${coverage.checked} of ${coverage.total} areas checked`}
          {scansLeft !== null ? ` · ${scansLeft} scans left this month` : ""}
        </s-text>
      </s-stack>

      {next ? (
        <s-stack direction="block" gap="small-300">
          <s-text>
            <s-text type="strong">Check your {next.label.toLowerCase()} next</s-text>
            {` — ${next.description.toLowerCase()}`}
          </s-text>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-button
              variant="primary"
              icon={AREA_ICON[next.scope]}
              disabled={busy || scansLeft === 0}
              onClick={() => onScanArea(next.scope)}
            >
              {`Scan ${next.label}`}
            </s-button>
            {canQueueAll && (
              <s-button variant="secondary" disabled={busy} onClick={onScanRemaining}>
                {willQueue === remaining
                  ? `Check all ${willQueue} remaining areas`
                  : `Check ${willQueue} of the ${remaining} remaining areas`}
              </s-button>
            )}
            <s-button variant="tertiary" onClick={onBrowse}>
              Choose an area
            </s-button>
          </s-stack>
        </s-stack>
      ) : (
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-text color="subdued">Every area has been checked at least once.</s-text>
          <s-button variant="secondary" icon="refresh" onClick={onBrowse}>
            Re-scan an area
          </s-button>
        </s-stack>
      )}
    </s-stack>
  );
}

type CategoryRow = {
  category: ScoreCategory;
  score: number | null;
  checksRun: number;
  checksTotal: number;
  unmeasured: UnmeasuredReason | null;
};

/**
 * Category scores. A category with nothing behind it says so and offers the
 * scan that would measure it, instead of showing a misleading number.
 */
function CategoryScores({
  categories,
  onScan,
  busy,
}: {
  categories: CategoryRow[];
  onScan: (scope: ScanScope) => void;
  busy: boolean;
}) {
  return (
    <s-section heading="Category scores">
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(190px, 1fr))" gap="base">
        {categories.map((row) => {
          const meta = CATEGORY[row.category];
          const measured = typeof row.score === "number";
          const band = measured ? scoreBand(row.score!) : null;
          const reason = row.unmeasured ? UNMEASURED[row.unmeasured] : null;

          return (
            <s-box key={row.category} padding="base" background="subdued" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-stack
                  direction="inline"
                  gap="small-300"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-text type="strong">{meta.label}</s-text>
                  {measured ? (
                    <s-text type="strong" tone={band!.tone} fontVariantNumeric="tabular-nums">
                      {String(row.score)}
                    </s-text>
                  ) : (
                    <s-badge tone="neutral">{reason?.label}</s-badge>
                  )}
                </s-stack>

                {measured ? (
                  <ScoreBar score={row.score!} />
                ) : (
                  <s-text color="subdued">{reason?.detail}</s-text>
                )}

                {measured ? (
                  <s-stack direction="block" gap="small-500">
                    <s-text color="subdued">{meta.blurb}</s-text>
                    {/* Say how much of the category this score covers, so a
                        partial scan cannot read as a verdict on all of it. */}
                    <s-text color="subdued">
                      {`Based on ${row.checksRun} of ${row.checksTotal} checks`}
                    </s-text>
                    {row.checksRun < row.checksTotal && meta.scope && (
                      <s-button
                        variant="tertiary"
                        icon={AREA_ICON[meta.scope]}
                        disabled={busy}
                        onClick={() => onScan(meta.scope as ScanScope)}
                      >
                        {`Scan ${SCAN_SCOPES[meta.scope].label}`}
                      </s-button>
                    )}
                  </s-stack>
                ) : (
                  row.unmeasured === "not-scanned" &&
                  meta.scope && (
                    <s-button
                      variant="tertiary"
                      icon={AREA_ICON[meta.scope]}
                      disabled={busy}
                      onClick={() => onScan(meta.scope as ScanScope)}
                    >
                      {`Scan ${SCAN_SCOPES[meta.scope].label}`}
                    </s-button>
                  )
                )}
              </s-stack>
            </s-box>
          );
        })}
      </s-grid>
    </s-section>
  );
}

const STEP_ICON = { done: "check-circle", active: "clock", pending: "bullet" } as const;
const STEP_TONE = { done: "success", active: "info", pending: "neutral" } as const;

/**
 * What the scan is doing, step by step. The list comes from the same planner
 * the worker walks, so it can never show a step the scan will not run.
 */
function ScanProgress({
  audit,
  queued,
  onCancel,
  busy,
}: {
  audit: {
    id: string;
    label: string;
    status: string;
    progress: number;
    detail: string | null;
    steps: Array<{ label: string; state: "done" | "active" | "pending" }>;
  };
  queued: Array<{ id: string; label: string }>;
  onCancel: (auditId: string) => void;
  busy: boolean;
}) {
  const waiting = audit.status === "pending";
  const waitingList = queued.filter((scan) => scan.id !== audit.id);

  return (
    <s-section heading={`Checking your ${audit.label.toLowerCase()}`}>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-spinner size="base" accessibilityLabel="Scan in progress" />
          <s-text color="subdued">
            {waiting ? "Waiting for a worker to pick this up" : `${audit.progress}% complete`}
          </s-text>
          {waiting && (
            <s-button variant="tertiary" disabled={busy} onClick={() => onCancel(audit.id)}>
              Cancel
            </s-button>
          )}
        </s-stack>

        <s-stack direction="block" gap="small-300">
          {audit.steps.map((step) => (
            <s-stack key={step.label} direction="inline" gap="small-300" alignItems="center">
              <s-icon
                type={STEP_ICON[waiting ? "pending" : step.state]}
                tone={STEP_TONE[waiting ? "pending" : step.state]}
                size="small"
              />
              <s-text color={step.state === "active" && !waiting ? "base" : "subdued"}>
                {step.state === "active" && audit.detail && !waiting ? audit.detail : step.label}
              </s-text>
            </s-stack>
          ))}
        </s-stack>

        {waitingList.length > 0 && (
          <s-stack direction="block" gap="small-300">
            <s-text color="subdued">{`Then ${waitingList.length} more queued`}</s-text>
            {waitingList.map((scan) => (
              <s-stack key={scan.id} direction="inline" gap="small" alignItems="center">
                <s-icon type="clock" tone="neutral" size="small" />
                <s-text color="subdued">{scan.label}</s-text>
                <s-button variant="tertiary" disabled={busy} onClick={() => onCancel(scan.id)}>
                  Cancel
                </s-button>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}

/**
 * The areas a merchant can examine. Each row carries its own state, so a queued
 * scan and a finished one never look the same, and the button says which it is.
 */
function AreasPanel({
  areas,
  busy,
  onScan,
}: {
  areas: AreaRow[];
  busy: boolean;
  onScan: (scope: ScanScope) => void;
}) {
  return (
    <s-section heading="Examine an area">
      <s-paragraph color="subdued">
        Each area is scanned on its own, so you only spend time and AI credits on what you want
        checked. After you make a change, scan that area again and StoreRx will verify it.
      </s-paragraph>

      {/* A compact grid: nine areas as nine tall rows pushed everything else
          off the screen. */}
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(250px, 1fr))" gap="base">
        {areas.map((area) => (
          <s-box key={area.scope} padding="base" background="subdued" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-stack direction="inline" gap="small-300" alignItems="center">
                <s-icon type={AREA_ICON[area.scope]} tone="neutral" size="base" />
                <s-text type="strong">{area.label}</s-text>
                {area.state === "queued" && <s-badge tone="info">Queued</s-badge>}
                {area.state === "scanning" && <s-badge tone="info">Scanning</s-badge>}
              </s-stack>

              <s-text color="subdued">{area.description}</s-text>

              <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
                {area.lastScanned ? (
                  area.openIssues > 0 ? (
                    <s-badge tone="warning">{`${area.openIssues} open`}</s-badge>
                  ) : (
                    <s-badge tone="success" icon="check-circle">Clear</s-badge>
                  )
                ) : (
                  <s-text color="subdued">Not checked yet</s-text>
                )}

                <s-button
                  variant={area.lastScanned ? "tertiary" : "secondary"}
                  icon={area.lastScanned ? "refresh" : "search"}
                  disabled={busy || area.state !== "idle"}
                  loading={area.state === "scanning"}
                  onClick={() => onScan(area.scope)}
                >
                  {area.lastScanned ? "Re-scan" : "Scan"}
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        ))}
      </s-grid>
    </s-section>
  );
}

function PlanUsage({
  plan,
}: {
  plan: { label: string; isFree: boolean; resetsAt: string; scans: UsageCount; aiCredits: UsageCount };
}) {
  return (
    <s-section heading={`${plan.label} plan`}>
      <s-stack direction="block" gap="base">
        <UsageRow label="Scans" count={plan.scans} />
        <UsageRow label="AI recommendations" count={plan.aiCredits} hint={AI_CREDIT_HINT} />
        <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
          <s-text color="subdued">Resets on {plan.resetsAt}.</s-text>
          <s-button variant="tertiary" href="/app/billing">
            {plan.isFree ? "Upgrade" : "Manage plan"}
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

/** Proof the loop closed: the merchant changed something and a scan confirmed it. */
function VerifiedSection({ items }: { items: Array<{ ruleId: string; title: string }> }) {
  if (items.length === 0) return null;

  return (
    <s-section heading={`Verified in the last ${RECENTLY_VERIFIED_DAYS} days (${items.length})`}>
      <s-paragraph color="subdued">
        You made these changes and a later scan confirmed them.
      </s-paragraph>
      <ShowMore
        items={items}
        initial={3}
        moreLabel={(n) => `Show ${n} more`}
        render={(item) => (
          <s-stack
            key={item.ruleId}
            direction="inline"
            gap="small"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-link href={issueHref(item.ruleId)}>{item.title}</s-link>
            <s-badge tone="success" icon="check-circle">
              Verified
            </s-badge>
          </s-stack>
        )}
      />
    </s-section>
  );
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();

  const isScanning = Boolean(data.runningAudit);
  const isSubmitting = fetcher.state !== "idle";

  const totalIssues = data.critical.length + data.improvements.length + data.minor.length;

  // A scan finishing used to just swap the page's contents with no word about
  // what happened. Hold on to the scan that completed while this page was open.
  const [justFinished, setJustFinished] = useState<typeof data.latestScan>(null);
  const wasScanning = useRef(isScanning);
  useEffect(() => {
    if (wasScanning.current && !isScanning && data.latestScan) setJustFinished(data.latestScan);
    wasScanning.current = isScanning;
  }, [isScanning, data.latestScan]);

  const startScan = (scope: ScanScope) => fetcher.submit({ intent: "scan", scope }, { method: "post" });

  // The hero's call to action has no single area to run, so it takes the
  // merchant to the list to choose one rather than picking for them.
  const areasRef = useRef<HTMLDivElement>(null);
  const scrollToAreas = () =>
    areasRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Poll while a scan is in flight so progress and results appear on their own.
  // Held in a ref because `revalidator` gets a new identity on every state
  // change, which would otherwise tear down and rebuild the interval each tick.
  const revalidatorRef = useRef(revalidator);
  useEffect(() => {
    revalidatorRef.current = revalidator;
  }, [revalidator]);

  useEffect(() => {
    if (!isScanning) return;
    const id = setInterval(() => {
      if (revalidatorRef.current.state === "idle") revalidatorRef.current.revalidate();
    }, 3000);
    return () => clearInterval(id);
  }, [isScanning]);

  return (
    <s-page heading="Store health">
      {justFinished && (
        <s-banner
          tone="success"
          heading={`${justFinished.label} scan finished`}
          onDismiss={() => setJustFinished(null)}
        >
          <s-stack direction="block" gap="small">
            <s-paragraph>
              {justFinished.newCount > 0
                ? `${justFinished.newCount} new ${justFinished.newCount === 1 ? "problem" : "problems"} found.`
                : "Nothing new found."}
              {justFinished.resolvedCount > 0
                ? ` ${justFinished.resolvedCount} verified fixed.`
                : ""}
            </s-paragraph>
            <s-link href={`/app/history/${justFinished.id}`}>See what it checked</s-link>
          </s-stack>
        </s-banner>
      )}

      {fetcher.data && "queuedCount" in fetcher.data && fetcher.data.ok && (
        <s-banner tone="info" heading={`${fetcher.data.queuedCount} scans queued`}>
          StoreRx works through them one at a time. You can leave this page.
          {"skipped" in fetcher.data && (fetcher.data.skipped ?? 0) > 0
            ? ` ${fetcher.data.skipped} didn't fit in this month's plan.`
            : ""}
        </s-banner>
      )}

      {/* Scans keep working without credits, but the advice stops, and a
          merchant should not have to work out why. */}
      {data.plan.creditsSpent && (
        <s-banner tone="warning" heading="You've used this month's AI recommendations">
          New problems will still be found, but listed without an explanation until{" "}
          {data.plan.resetsAt}. <s-link href="/app/billing">See plans</s-link>
        </s-banner>
      )}

      {fetcher.data && !fetcher.data.ok && (
        <s-banner tone={"limitReached" in fetcher.data ? "warning" : "critical"} heading="Scan not started">
          {fetcher.data.error}{" "}
          {"limitReached" in fetcher.data && <s-link href="/app/billing">See plans</s-link>}
        </s-banner>
      )}

      {!isScanning && data.failedScan && (
        <s-banner tone="critical" heading={`Your ${data.failedScan.label} scan didn't finish`}>
          <s-stack direction="block" gap="small">
            <s-paragraph>{data.failedScan.error}</s-paragraph>
            <s-link href={`/app/history/${data.failedScan.id}`}>See the report</s-link>
          </s-stack>
        </s-banner>
      )}

      {/* A pending scan with no live worker would otherwise sit at 0% with
          no explanation. Say what is actually wrong. */}
      {isScanning && data.runningAudit?.status === "pending" && !data.workerAlive && (
        <s-banner tone="warning" heading="Your scan is queued but not started">
          The scan worker isn&apos;t running, so nothing is processing it yet. Start it
          with <s-text type="strong">npm run dev</s-text> (it starts the worker
          automatically), or run <s-text type="strong">npm run worker</s-text> in a
          separate terminal. The scan will begin as soon as a worker is up.
        </s-banner>
      )}

      {isScanning && data.runningAudit && (
        <ScanProgress
          audit={data.runningAudit}
          queued={data.queued}
          busy={isSubmitting}
          onCancel={(auditId) => fetcher.submit({ intent: "cancelScan", auditId }, { method: "post" })}
        />
      )}

      <HealthHero
        health={data.health}
        coverage={data.coverage}
        latestScan={data.latestScan}
        critical={data.critical.length}
        improvements={data.improvements.length}
        minor={data.minor.length}
        awaiting={data.awaitingCount}
        busy={isSubmitting}
        onScan={scrollToAreas}
        onScanArea={startScan}
        onScanRemaining={() => fetcher.submit({ intent: "scanRemaining" }, { method: "post" })}
      />

      {data.hasScan && (
        <CategoryScores categories={data.health.categories} onScan={startScan} busy={isSubmitting} />
      )}

      {data.hasScan ? (
        <>
          <IssueGroup
            heading="Fix first"
            intro="These are costing you the most. Open one to see why it matters and what to do."
            issues={data.critical}
          />
          <IssueGroup heading="Worth improving" issues={data.improvements} />
          <IssueGroup heading="Minor" issues={data.minor} />

          {totalIssues === 0 && (
            <s-section>
              <StateCard icon="check-circle" tone="success" heading="Nothing outstanding">
                StoreRx found no open issues in the areas you have scanned. Scan another area below
                to go deeper.
              </StateCard>
            </s-section>
          )}

          <VerifiedSection items={data.verified} />
        </>
      ) : (
        !isScanning && (
          <s-section>
            <s-stack direction="block" gap="large-100">
              <StateCard
                icon="clipboard-checklist"
                heading="Nothing examined yet"
                action={
                  <s-button variant="primary" icon="search" onClick={scrollToAreas}>
                    Choose an area
                  </s-button>
                }
              >
                Pick an area below and StoreRx will examine it, explain what it finds, and recommend
                how to put it right. Each scan takes a minute or two.
              </StateCard>
              <HowItWorks heading="How it works" />
            </s-stack>
          </s-section>
        )
      )}

      {/* The wrapper div (needed for scroll-to-areas) is not an s-section, so
          the page does not space it from the section below it. */}
      <div ref={areasRef} style={{ marginBottom: 24 }}>
        <AreasPanel areas={data.areas} busy={isSubmitting} onScan={startScan} />
      </div>

      <PlanUsage plan={data.plan} />

      <s-section>
        <s-stack direction="block" gap="small">
          <Callout icon="shield-check-mark">
            StoreRx examines your store and recommends what to change. You make every change
            yourself — it never edits your store, your products or your theme.
          </Callout>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-button variant="tertiary" icon="clock" href="/app/history">
              Scan history
            </s-button>
            <s-button variant="tertiary" icon="settings" href="/app/settings">
              Settings
            </s-button>
            <s-button variant="tertiary" icon="info" href="/app/help">
              Help
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
