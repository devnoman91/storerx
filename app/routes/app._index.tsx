import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher, useRevalidator, Link } from "react-router";
import { useEffect, useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { enqueueAudit, isWorkerAlive, reapStaleAudits } from "../queue.server";
import { checkScanAllowed, getShopUsage } from "../billing/billing.server";
import { isCatalogPage } from "../scoring";
import { SCAN_SCOPES, SCAN_SCOPE_ORDER, isScanScope, isSelectableScope, type ScanScope } from "../scans/scopes";
import {
  IMAGE_MAX_DIMENSION,
  IMAGE_MIN_DIMENSION,
  IMAGE_SIZE_LIMIT_BYTES,
  MIN_IMAGES_PER_PRODUCT,
} from "../rules/images";

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;
type Severity = keyof typeof SEVERITY_RANK;

/** How far back "recently fixed" looks. */
const RECENTLY_FIXED_DAYS = 14;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Prescription titles for catalog rules, which group many rows into one. */
const CATALOG_TITLES: Record<string, (n: number) => string> = {
  "img.alt": (n) => `${plural(n, "image is", "images are")} missing alt text`,
  "img.size": (n) =>
    `${plural(n, "image is", "images are")} over ${Math.round(IMAGE_SIZE_LIMIT_BYTES / 1024)} KB`,
  "img.dims.large": (n) =>
    `${plural(n, "image is", "images are")} larger than ${IMAGE_MAX_DIMENSION} px`,
  "img.dims.small": (n) =>
    `${plural(n, "image is", "images are")} smaller than ${IMAGE_MIN_DIMENSION} px`,
  "img.count": (n) =>
    `${plural(n, "product has", "products have")} fewer than ${MIN_IMAGES_PER_PRODUCT} images`,
  "img.ratio": (n) => `${plural(n, "product mixes", "products mix")} image proportions`,
  "img.duplicate": (n) => `${plural(n, "image looks", "images look")} like a duplicate upload`,
};

type IssueRow = {
  id: string;
  ruleId: string;
  pageType: string;
  severity: string;
  title: string;
  explanation: string | null;
  recommendation: string | null;
  evidenceValue: string | null;
  pageUrl: string | null;
  imageUrl: string | null;
  targetTitle: string | null;
  fixableByAI: boolean;
  isNew: boolean;
};

/**
 * One row per prescription: a rule that fired on several pages, products or
 * images is one problem, listed with everything it affects. Scoring and scan
 * issue counts use the same grouping (collapseByRule).
 */
function toPrescriptions(rows: IssueRow[]): Issue[] {
  const groups = new Map<string, IssueRow[]>();
  for (const row of rows) {
    const group = groups.get(row.ruleId);
    if (group) group.push(row);
    else groups.set(row.ruleId, [row]);
  }

  return [...groups.values()].map((group) => {
    const [first] = group;
    const catalog = isCatalogPage(first.pageType);
    const isNew = group.some((row) => row.isNew);

    // A single occurrence on a page reads best as a plain row with its page.
    if (group.length === 1 && !catalog) {
      return { ...first, isNew, catalog, affected: null };
    }

    return {
      ...first,
      isNew,
      catalog,
      title: catalog ? CATALOG_TITLES[first.ruleId]?.(group.length) ?? first.title : first.title,
      affected: group.map((row) => ({
        id: row.id,
        title: row.targetTitle,
        imageUrl: row.imageUrl,
        pageUrl: row.pageUrl,
        evidenceValue: row.evidenceValue,
        isNew: row.isNew,
      })),
    };
  });
}

type FixedGroup = {
  ruleId: string;
  title: string;
  severity: string;
  items: Array<{ id: string; label: string }>;
};

function groupFixed(rows: Array<Omit<IssueRow, "isNew">>): FixedGroup[] {
  const groups = new Map<string, { rows: typeof rows }>();
  for (const row of rows) {
    const group = groups.get(row.ruleId);
    if (group) group.rows.push(row);
    else groups.set(row.ruleId, { rows: [row] });
  }
  return [...groups.values()]
    .map(({ rows: group }) => {
      const [first] = group;
      return {
        ruleId: first.ruleId,
        severity: first.severity,
        title: isCatalogPage(first.pageType)
          ? CATALOG_TITLES[first.ruleId]?.(group.length) ?? first.title
          : first.title,
        items: group.map((row) => ({
          id: row.id,
          label: row.targetTitle ?? pagePath(row.pageUrl) ?? "Store settings",
        })),
      };
    })
    .sort((a, b) => SEVERITY_RANK[a.severity as Severity] - SEVERITY_RANK[b.severity as Severity]);
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

  const since = new Date(Date.now() - RECENTLY_FIXED_DAYS * 24 * 60 * 60 * 1000);
  const [openIssues, fixedIssues, inFlight, latestScan, lastByScope, failedScan, fixCount, planUsage] = await Promise.all([
    prisma.issue.findMany({ where: { shopId, status: "open" }, orderBy: { lastSeenAt: "desc" } }),
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
    prisma.fix.count({ where: { shopId, status: "applied" } }),
    getShopUsage(shop),
  ]);

  const rows: IssueRow[] = openIssues
    .map((issue) => ({
      ...issue,
      // "New" until a later scan sees the issue again.
      isNew: issue.openedAsNew && issue.openedAuditId === issue.lastSeenAuditId,
    }))
    .sort(bySeverity);
  const prescriptions = toPrescriptions(rows);

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
      aiExplanations: { used: planUsage.usage.aiExplanations, limit: planUsage.plan.limits.aiExplanations },
    },
    critical: prescriptions.filter((p) => p.severity === "high"),
    improvements: prescriptions.filter((p) => p.severity === "medium"),
    minor: prescriptions.filter((p) => p.severity === "low"),
    recentlyFixed: groupFixed(fixedIssues),
    fixCount,
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

  // A single row insert.
  const { id, created } = await enqueueAudit(shop.id, requested);
  return { ok: true, auditId: id, alreadyQueued: !created };
};

function StatusBadge({ type, count }: { type: "critical" | "warning" | "success"; count: number }) {
  const styles = {
    critical: { bg: "#FEE2E2", color: "#991B1B", icon: "🔴" },
    warning: { bg: "#FEF3C7", color: "#92400E", icon: "🟡" },
    success: { bg: "#D1FAE5", color: "#065F46", icon: "🟢" },
  };
  const { bg, color, icon } = styles[type];
  const labels = { critical: "Critical", warning: "To Improve", success: "AI fixes applied" };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 16px",
      background: bg,
      borderRadius: 8,
      fontSize: 14,
      fontWeight: 600,
      color,
    }}>
      <span>{icon}</span>
      <span>{count} {labels[type]}</span>
    </div>
  );
}

const IMPACT: Record<Severity, { tone: "critical" | "warning" | "info"; label: string }> = {
  high: { tone: "critical", label: "High impact" },
  medium: { tone: "warning", label: "Medium impact" },
  low: { tone: "info", label: "Low impact" },
};

type AffectedItem = {
  id: string;
  title: string | null;
  imageUrl: string | null;
  pageUrl: string | null;
  evidenceValue: string | null;
  isNew: boolean;
};

type Issue = {
  id: string;
  ruleId: string;
  severity: string;
  title: string;
  explanation: string | null;
  recommendation: string | null;
  evidenceValue: string | null;
  pageUrl: string | null;
  fixableByAI: boolean;
  /** Opened by its latest scan (any of its occurrences). */
  isNew: boolean;
  /** Catalog rules (images) are worded per product rather than per page. */
  catalog: boolean;
  /** Set when a rule fired more than once: every page, product or image affected. */
  affected: AffectedItem[] | null;
};

type AreaRow = {
  scope: ScanScope;
  label: string;
  description: string;
  lastScanned: string | null;
  openIssues: number;
  state: "idle" | "queued" | "scanning";
};

/** How many affected items to list before summarising the rest. */
const MAX_AFFECTED_LISTED = 25;

const FIXED_LABELS_SHOWN = 3;

function LatestScanSummary({
  scan,
}: {
  scan: { label: string; date: string; newCount: number; resolvedCount: number };
}) {
  return (
    <s-stack direction="inline" gap="small" align-items="center">
      <s-text color="subdued">{`Last scan: ${scan.label}, ${scan.date}`}</s-text>
      <s-badge tone={scan.newCount > 0 ? "warning" : "info"}>{`${scan.newCount} new`}</s-badge>
      <s-badge tone="success">{`${scan.resolvedCount} fixed`}</s-badge>
    </s-stack>
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
    <s-section heading="Scan one area">
      <s-paragraph color="subdued">
        Each area scans on its own, so you only spend time and AI credits on what you want to
        check. Scan the area you changed after a fix to see it clear.
      </s-paragraph>
      <s-stack direction="block" gap="base">
        {areas.map((area) => (
          <s-stack
            key={area.scope}
            direction="inline"
            gap="base"
            align-items="center"
            justify-content="space-between"
          >
            <s-stack direction="block" gap="small-500">
              <s-text type="strong">{area.label}</s-text>
              <s-text color="subdued">{area.description}</s-text>
              <s-text color="subdued">
                {area.lastScanned ? `Last scanned ${area.lastScanned}` : "Not scanned yet"}
                {area.lastScanned ? ` · ${area.openIssues} open ${area.openIssues === 1 ? "issue" : "issues"}` : ""}
              </s-text>
            </s-stack>
            <s-stack direction="inline" gap="small" align-items="center">
              {area.state === "queued" && <s-badge tone="info">Queued</s-badge>}
              {area.state === "scanning" && <s-badge tone="info">Scanning</s-badge>}
              <s-button
                variant="secondary"
                disabled={busy || area.state !== "idle"}
                onClick={() => onScan(area.scope)}
              >
                Scan
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
  plan: { label: string; isFree: boolean; resetsAt: string; scans: UsageCount; aiExplanations: UsageCount };
}) {
  return (
    <s-section heading={`${plan.label} plan this month`}>
      <s-stack direction="block" gap="small">
        <s-text>Scans: {usageText(plan.scans)}</s-text>
        <s-text>AI explanations: {usageText(plan.aiExplanations)}</s-text>
        <s-text color="subdued">Resets on {plan.resetsAt}.</s-text>
        <s-link href="/app/billing">{plan.isFree ? "Upgrade for more scans" : "Manage plan"}</s-link>
      </s-stack>
    </s-section>
  );
}

function FixedSection({ groups }: { groups: FixedGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <s-section heading={`Fixed in the last ${RECENTLY_FIXED_DAYS} days (${groups.length})`}>
      <s-stack direction="block" gap="base">
        {groups.map((group) => {
          const shown = group.items.slice(0, FIXED_LABELS_SHOWN).map((item) => item.label);
          const more = group.items.length - shown.length;
          return (
            <s-stack
              key={group.ruleId}
              direction="inline"
              gap="small"
              align-items="center"
              justify-content="space-between"
            >
              <s-stack direction="block" gap="small-500">
                <s-text type="strong">{group.title}</s-text>
                <s-text color="subdued">
                  {shown.join(", ")}
                  {more > 0 ? ` and ${more} more` : ""}
                </s-text>
              </s-stack>
              <s-badge tone="success">Fixed</s-badge>
            </s-stack>
          );
        })}
      </s-stack>
    </s-section>
  );
}

function AffectedList({ items }: { items: AffectedItem[] }) {
  const shown = items.slice(0, MAX_AFFECTED_LISTED);
  const hidden = items.length - shown.length;

  return (
    <s-stack direction="block" gap="small-300">
      <s-heading>Affected ({items.length})</s-heading>
      {shown.map((item) => (
        <s-stack key={item.id} direction="inline" gap="small" align-items="center">
          {item.imageUrl ? (
            <s-thumbnail src={item.imageUrl} alt={item.title ?? "Product image"} size="small" />
          ) : null}
          <s-stack direction="block" gap="small-500">
            <s-stack direction="inline" gap="small-300" align-items="center">
              {item.pageUrl ? (
                <s-link href={item.pageUrl} target="_blank">
                  {item.title ?? pagePath(item.pageUrl)}
                </s-link>
              ) : (
                <s-text>{item.title ?? "Store settings"}</s-text>
              )}
              {item.isNew && <s-badge tone="info">New</s-badge>}
            </s-stack>
            {item.evidenceValue && <s-text color="subdued">{item.evidenceValue}</s-text>}
          </s-stack>
        </s-stack>
      ))}
      {hidden > 0 && <s-text color="subdued">And {hidden} more</s-text>}
    </s-stack>
  );
}

/** Storefront path, so repeated issues show which product or collection they are on. */
function pagePath(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

/**
 * One prescription row. "View" expands it inline with why it matters, how to
 * fix it, and where it was found (DESIGN.md §4.3).
 */
function IssueCard({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState(false);
  const impact = IMPACT[issue.severity as Severity] ?? IMPACT.low;
  const path = pagePath(issue.pageUrl);
  const placeCount = issue.affected
    ? new Set(issue.affected.map((item) => item.pageUrl ?? item.title)).size
    : 0;
  const subtitle = !issue.affected
    ? path
    : issue.catalog
      ? `Across ${placeCount} ${placeCount === 1 ? "product" : "products"}`
      : `On ${placeCount} ${placeCount === 1 ? "page" : "pages"}`;

  return (
    <s-box padding="base" border-width="base none none none" border-color="base">
      <s-stack direction="inline" gap="base" align-items="center" justify-content="space-between">
        <s-stack direction="block" gap="small-300">
          <s-text type="strong">{issue.title}</s-text>
          {subtitle && <s-text color="subdued">{subtitle}</s-text>}
        </s-stack>
        <s-stack direction="inline" gap="small" align-items="center">
          {issue.isNew && <s-badge tone="info">New</s-badge>}
          <s-badge tone={impact.tone}>{impact.label}</s-badge>
          <s-button variant="secondary" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "View"}
          </s-button>
        </s-stack>
      </s-stack>

      {open && (
        <s-box padding-block-start="base">
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-300">
              <s-heading>Why it matters</s-heading>
              <s-paragraph>
                {issue.explanation ?? "Explanation not available for this issue yet."}
              </s-paragraph>
            </s-stack>

            <s-stack direction="block" gap="small-300">
              <s-heading>How to fix</s-heading>
              <s-paragraph>
                {issue.recommendation ?? "Run a new scan to get fix steps for this issue."}
              </s-paragraph>
            </s-stack>

            {issue.affected ? (
              <AffectedList items={issue.affected} />
            ) : (
              <>
                {issue.evidenceValue && (
                  <s-stack direction="block" gap="small-300">
                    <s-heading>What we checked</s-heading>
                    <s-paragraph color="subdued">{issue.evidenceValue}</s-paragraph>
                  </s-stack>
                )}

                {issue.pageUrl && (
                  <s-paragraph>
                    Found on{" "}
                    <s-link href={issue.pageUrl} target="_blank">{path}</s-link>
                  </s-paragraph>
                )}
              </>
            )}

            {/* The apply layer (app/fixes/apply.ts) is not implemented yet, so this
                stays disabled with a visible reason rather than a dead button. */}
            {issue.fixableByAI && (
              <s-stack direction="inline" gap="small" align-items="center">
                <s-button disabled>Fix with AI</s-button>
                <s-text color="subdued">AI fixes are coming soon — use the steps above for now.</s-text>
              </s-stack>
            )}
          </s-stack>
        </s-box>
      )}
    </s-box>
  );
}

function IssueSection({ heading, color, issues }: {
  heading: string;
  color: string;
  issues: Issue[];
}) {
  if (issues.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px 0", color }}>
        {heading} ({issues.length})
      </h2>
      <div style={{ border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
        {issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} />
        ))}
      </div>
    </div>
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
    <s-page heading="Store Health">
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

      {isScanning && data.runningAudit && (
        <div style={{
          padding: 20,
          background: "#EFF6FF",
          borderRadius: 12,
          marginBottom: 24,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {`Scanning: ${data.runningAudit.label}`}
          </div>
          <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>
            {data.runningAudit.status === "pending"
              ? "Waiting to start"
              : `${data.runningAudit.currentStep || "Getting started"} · ${data.runningAudit.progress}%`}
          </div>
          <div style={{ height: 6, background: "#DBEAFE", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              width: `${data.runningAudit.progress}%`,
              height: "100%",
              background: "#2563EB",
              transition: "width 300ms ease",
            }} />
          </div>
        </div>
      )}

      {data.hasScan ? (
        <>
          <div style={{ marginBottom: 24 }}>
            {data.latestScan && (
              <div style={{ marginBottom: 16 }}>
                <LatestScanSummary scan={data.latestScan} />
              </div>
            )}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <StatusBadge type="critical" count={data.critical.length} />
              <StatusBadge type="warning" count={data.improvements.length} />
              <StatusBadge type="success" count={data.fixCount} />
            </div>
          </div>

          <IssueSection heading="Fix Now" color="#991B1B" issues={data.critical} />
          <IssueSection heading="Improvements" color="#92400E" issues={data.improvements} />
          <IssueSection heading="Minor" color="#374151" issues={data.minor} />

          {totalIssues === 0 && (
            <div style={{
              textAlign: "center",
              padding: 48,
              background: "#F0FDF4",
              borderRadius: 12,
              marginBottom: 24,
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px 0", color: "#065F46" }}>
                No open issues
              </h2>
              <p style={{ fontSize: 14, color: "#6B7280", margin: 0 }}>
                Nothing found in the areas you have scanned.
              </p>
            </div>
          )}

          <FixedSection groups={data.recentlyFixed} />
        </>
      ) : (
        !isScanning && (
          <div style={{
            textAlign: "center",
            padding: 48,
            background: "#F9FAFB",
            borderRadius: 12,
            marginBottom: 24,
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px 0" }}>
              Ready to check your store?
            </h2>
            <p style={{ fontSize: 14, color: "#6B7280", margin: 0 }}>
              Pick an area below to scan. Each one takes a minute or two.
            </p>
          </div>
        )
      )}

      <AreasPanel areas={data.areas} busy={isSubmitting} onScan={startScan} />

      <PlanUsage plan={data.plan} />

      <div style={{
        display: "flex",
        gap: 16,
        marginTop: 24,
        paddingTop: 24,
        borderTop: "1px solid #E5E7EB",
      }}>
        <Link to="/app/history" style={{ fontSize: 13, color: "#2563EB", textDecoration: "none" }}>
          Scan and fix history
        </Link>
        <Link to="/app/settings" style={{ fontSize: 13, color: "#2563EB", textDecoration: "none" }}>
          Settings
        </Link>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
