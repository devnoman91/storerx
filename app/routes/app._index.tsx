import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher, useRevalidator, Link } from "react-router";
import { useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { enqueueAudit, isWorkerAlive, reapStaleAudits } from "../queue.server";
import { checkScanAllowed, getShopUsage } from "../billing/billing.server";
import { isCatalogPage } from "../scoring";
import { SCAN_SCOPES, SCAN_SCOPE_ORDER, isScanScope, isSelectableScope, type ScanScope } from "../scans/scopes";
import { actionsFor, type IssueStatus } from "../remedies/actions";
import type { RemedyKind, SuggestionKind } from "../remedies/types";
import { EmptyState, IssueGroup, pagePath, type PrescriptionView } from "../components/issue-ui";
import { catalogTitle } from "../issues/wording";

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;
type Severity = keyof typeof SEVERITY_RANK;

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
  SEVERITY_RANK[a.severity as Severity] - SEVERITY_RANK[b.severity as Severity];

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
  const [outstanding, verified, inFlight, latestScan, lastByScope, failedScan, planUsage] =
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
        select: { scope: true, completedAt: true, newCount: true, resolvedCount: true, createdAt: true },
      }),
      prisma.audit.groupBy({
        by: ["scope"],
        where: { shopId, status: "completed" },
        _max: { completedAt: true },
      }),
      prisma.audit.findFirst({
        where: { shopId, status: "failed" },
        orderBy: { createdAt: "desc" },
        select: { error: true, createdAt: true, scope: true },
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
  const lastScanned = new Map(lastByScope.map((row) => [row.scope, row._max.completedAt]));
  const scopeLabel = (scope: string) => (isScanScope(scope) ? SCAN_SCOPES[scope].label : scope);

  return {
    hasScan: Boolean(latestScan),
    latestScan: latestScan
      ? {
          label: scopeLabel(latestScan.scope),
          date: (latestScan.completedAt ?? latestScan.createdAt).toLocaleString(),
          newCount: latestScan.newCount,
          resolvedCount: latestScan.resolvedCount,
        }
      : null,
    runningAudit: running ? { ...running, label: scopeLabel(running.scope) } : null,
    // Only worth a query while something is waiting to be picked up.
    workerAlive: running?.status === "pending" ? await isWorkerAlive() : true,
    failedError:
      failedScan && (!latestScan || failedScan.createdAt > latestScan.createdAt)
        ? `${scopeLabel(failedScan.scope)} scan: ${failedScan.error ?? "unknown error"}`
        : null,
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
  if (intent !== "scan") {
    return { ok: false, error: `Unsupported action: ${String(intent)}` };
  }
  const requested = formData.get("scope");
  if (!isSelectableScope(requested)) {
    return { ok: false, error: `Unknown scan area: ${String(requested)}` };
  }

  let shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) {
    shop = await prisma.shop.create({ data: { domain: shopDomain } });
  }

  // A repeat request for an area already queued joins that scan, so it is not
  // charged against the plan a second time.
  const queued = await prisma.audit.findFirst({
    where: { shopId: shop.id, scope: requested, status: { in: ["pending", "running"] } },
    select: { id: true },
  });
  if (queued) return { ok: true, auditId: queued.id, alreadyQueued: true };

  const allowed = await checkScanAllowed(shop);
  if (!allowed.allowed) {
    return { ok: false, error: allowed.message, limitReached: true };
  }

  const { id, created } = await enqueueAudit(shop.id, requested);
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

function HealthSummary({
  critical,
  improvements,
  minor,
  awaiting,
}: {
  critical: number;
  improvements: number;
  minor: number;
  awaiting: number;
}) {
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-badge tone="critical" size="large">{`${critical} critical`}</s-badge>
      <s-badge tone="warning" size="large">{`${improvements} to improve`}</s-badge>
      <s-badge tone="neutral" size="large">{`${minor} minor`}</s-badge>
      {awaiting > 0 && <s-badge tone="info" size="large">{`${awaiting} awaiting verification`}</s-badge>}
    </s-stack>
  );
}

function ScanProgress({
  audit,
}: {
  audit: { label: string; status: string; progress: number; currentStep: string | null };
}) {
  return (
    <s-section heading={`Scanning: ${audit.label}`}>
      <s-stack direction="block" gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-spinner size="base" accessibilityLabel="Scan in progress" />
          <s-text color="subdued">
            {audit.status === "pending"
              ? "Waiting for a worker to pick this up"
              : `${audit.currentStep || "Getting started"} · ${audit.progress}%`}
          </s-text>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

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
    <s-section heading="Check an area">
      <s-paragraph color="subdued">
        Each area scans on its own, so you only spend time and AI credits on what you want to
        check. After you make a change, scan that area again to have StoreRx verify it.
      </s-paragraph>
      <s-stack direction="block" gap="base">
        {areas.map((area) => (
          <s-stack
            key={area.scope}
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack direction="block" gap="small-500">
              <s-text type="strong">{area.label}</s-text>
              <s-text color="subdued">{area.description}</s-text>
              <s-text color="subdued">
                {area.lastScanned ? `Last scanned ${area.lastScanned}` : "Not scanned yet"}
                {area.lastScanned
                  ? ` · ${area.openIssues} open ${area.openIssues === 1 ? "issue" : "issues"}`
                  : ""}
              </s-text>
            </s-stack>
            <s-stack direction="inline" gap="small" alignItems="center">
              {area.state === "queued" && <s-badge tone="info">Queued</s-badge>}
              {area.state === "scanning" && <s-badge tone="info">Scanning</s-badge>}
              <s-button
                variant="secondary"
                disabled={busy || area.state !== "idle"}
                onClick={() => onScan(area.scope)}
              >
                {area.lastScanned ? "Re-scan" : "Scan"}
              </s-button>
            </s-stack>
          </s-stack>
        ))}
      </s-stack>
    </s-section>
  );
}

type UsageCount = { used: number; limit: number | null };

function usageText({ used, limit }: UsageCount): string {
  return limit === null ? `${used} used · unlimited` : `${used} of ${limit} used`;
}

function PlanUsage({
  plan,
}: {
  plan: { label: string; isFree: boolean; resetsAt: string; scans: UsageCount; aiCredits: UsageCount };
}) {
  return (
    <s-section heading={`${plan.label} plan this month`}>
      <s-stack direction="block" gap="small">
        <s-text>Scans: {usageText(plan.scans)}</s-text>
        <s-text>AI recommendations: {usageText(plan.aiCredits)}</s-text>
        <s-text color="subdued">Resets on {plan.resetsAt}.</s-text>
        <s-link href="/app/billing">{plan.isFree ? "Upgrade for more scans" : "Manage plan"}</s-link>
      </s-stack>
    </s-section>
  );
}

function VerifiedSection({ items }: { items: Array<{ ruleId: string; title: string }> }) {
  if (items.length === 0) return null;
  return (
    <s-section heading={`Verified in the last ${RECENTLY_VERIFIED_DAYS} days (${items.length})`}>
      <s-paragraph color="subdued">
        You made these changes and a later scan confirmed them.
      </s-paragraph>
      <s-stack direction="block" gap="small">
        {items.map((item) => (
          <s-stack
            key={item.ruleId}
            direction="inline"
            gap="small"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-text>{item.title}</s-text>
            <s-badge tone="success">Verified</s-badge>
          </s-stack>
        ))}
      </s-stack>
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

  const startScan = (scope: ScanScope) => fetcher.submit({ intent: "scan", scope }, { method: "post" });

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
      {fetcher.data && !fetcher.data.ok && (
        <s-banner tone={"limitReached" in fetcher.data ? "warning" : "critical"} heading="Scan not started">
          {fetcher.data.error}{" "}
          {"limitReached" in fetcher.data && <s-link href="/app/billing">See plans</s-link>}
        </s-banner>
      )}

      {!isScanning && data.failedError && (
        <s-banner tone="critical" heading="Last scan failed">
          {data.failedError}
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

      {isScanning && data.runningAudit && <ScanProgress audit={data.runningAudit} />}

      {data.hasScan ? (
        <>
          <s-section>
            <s-stack direction="block" gap="base">
              {data.latestScan && (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-text color="subdued">
                    {`Last scan: ${data.latestScan.label}, ${data.latestScan.date}`}
                  </s-text>
                  <s-badge tone={data.latestScan.newCount > 0 ? "warning" : "info"}>
                    {`${data.latestScan.newCount} new`}
                  </s-badge>
                  <s-badge tone="success">{`${data.latestScan.resolvedCount} verified`}</s-badge>
                </s-stack>
              )}
              <HealthSummary
                critical={data.critical.length}
                improvements={data.improvements.length}
                minor={data.minor.length}
                awaiting={data.awaitingCount}
              />
              <s-text color="subdued">
                StoreRx finds and explains issues and recommends how to solve them. You make the
                changes in Shopify — StoreRx never edits your store.
              </s-text>
            </s-stack>
          </s-section>

          <IssueGroup heading="Fix first" issues={data.critical} tone="critical" />
          <IssueGroup heading="Worth improving" issues={data.improvements} />
          <IssueGroup heading="Minor" issues={data.minor} />

          {totalIssues === 0 && (
            <s-section>
              <EmptyState heading="No open issues">
                Nothing found in the areas you have scanned. Scan another area below to go deeper.
              </EmptyState>
            </s-section>
          )}

          <VerifiedSection items={data.verified} />
        </>
      ) : (
        !isScanning && (
          <s-section>
            <EmptyState heading="Ready to check your store?">
              Pick an area below to scan. Each one takes a minute or two, and StoreRx will explain
              what it finds and recommend how to solve it.
            </EmptyState>
          </s-section>
        )
      )}

      <AreasPanel areas={data.areas} busy={isSubmitting} onScan={startScan} />

      <PlanUsage plan={data.plan} />

      <s-section>
        <s-stack direction="inline" gap="base">
          <Link to="/app/history">
            <s-text>Scan history</s-text>
          </Link>
          <Link to="/app/settings">
            <s-text>Settings</s-text>
          </Link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
