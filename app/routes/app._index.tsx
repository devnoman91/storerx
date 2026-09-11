import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher, useRevalidator, Link } from "react-router";
import { useEffect, useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { enqueueAudit, isWorkerAlive, reapStaleAudits } from "../queue.server";
import { isCatalogPage } from "../scoring";
import {
  IMAGE_MAX_DIMENSION,
  IMAGE_MIN_DIMENSION,
  IMAGE_SIZE_LIMIT_BYTES,
  MIN_IMAGES_PER_PRODUCT,
} from "../rules/images";

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;
type Severity = keyof typeof SEVERITY_RANK;

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

type FindingRow = {
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
};

/**
 * One row per prescription. Catalog rules (images) fire once per image or
 * product; showing them individually buries the list, so they collapse into
 * a single row that lists what is affected.
 */
function toPrescriptions(findings: FindingRow[]): Issue[] {
  const issues: Issue[] = [];
  const grouped = new Map<string, Issue>();

  for (const f of findings) {
    const affected = {
      id: f.id,
      title: f.targetTitle,
      imageUrl: f.imageUrl,
      pageUrl: f.pageUrl,
      evidenceValue: f.evidenceValue,
    };

    if (!isCatalogPage(f.pageType)) {
      issues.push({ ...f, affected: null });
      continue;
    }

    const existing = grouped.get(f.ruleId);
    if (existing) {
      existing.affected!.push(affected);
      continue;
    }
    const issue: Issue = { ...f, affected: [affected] };
    grouped.set(f.ruleId, issue);
    issues.push(issue);
  }

  for (const issue of grouped.values()) {
    const n = issue.affected!.length;
    issue.title = CATALOG_TITLES[issue.ruleId]?.(n) ?? `${issue.title} (${n})`;
  }
  return issues;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) {
    shop = await prisma.shop.create({ data: { domain: shopDomain } });
  }

  // An audit whose worker died would otherwise block new scans forever.
  await reapStaleAudits(shop.id);

  const runningAudit = await prisma.audit.findFirst({
    where: { shopId: shop.id, status: { in: ["pending", "running"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, progress: true, currentStep: true },
  });

  const latestAudit = await prisma.audit.findFirst({
    where: { shopId: shop.id, status: "completed" },
    orderBy: { completedAt: "desc" },
    include: {
      findings: {
        where: { status: "open" },
        // severity is a string column, so sort by rank in code below.
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const failedAudit = runningAudit
    ? null
    : await prisma.audit.findFirst({
        where: { shopId: shop.id, status: "failed" },
        orderBy: { createdAt: "desc" },
        select: { error: true, createdAt: true },
      });

  const findings = toPrescriptions(
    (latestAudit?.findings ?? [])
      .slice()
      .sort((a, b) => SEVERITY_RANK[a.severity as Severity] - SEVERITY_RANK[b.severity as Severity]),
  );

  const fixCount = await prisma.fix.count({
    where: { shopId: shop.id, status: "applied" },
  });

  return {
    shopDomain,
    hasAudit: !!latestAudit,
    lastAuditDate: latestAudit?.completedAt?.toLocaleDateString() || null,
    runningAudit,
    // Only worth a query while something is waiting to be picked up.
    workerAlive: runningAudit?.status === "pending" ? await isWorkerAlive() : true,
    failedError:
      failedAudit && (!latestAudit || failedAudit.createdAt > latestAudit.createdAt)
        ? failedAudit.error
        : null,
    critical: findings.filter((f) => f.severity === "high"),
    improvements: findings.filter((f) => f.severity === "medium"),
    minor: findings.filter((f) => f.severity === "low"),
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

  let shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) {
    shop = await prisma.shop.create({ data: { domain: shopDomain } });
  }

  // Enqueueing is a single row insert, and it collapses a double-click into
  // the scan that is already queued.
  const { id, created } = await enqueueAudit(shop.id);
  return { ok: true, auditId: id, alreadyRunning: !created };
};

function StatusBadge({ type, count }: { type: "critical" | "warning" | "success"; count: number }) {
  const styles = {
    critical: { bg: "#FEE2E2", color: "#991B1B", icon: "🔴" },
    warning: { bg: "#FEF3C7", color: "#92400E", icon: "🟡" },
    success: { bg: "#D1FAE5", color: "#065F46", icon: "🟢" },
  };
  const { bg, color, icon } = styles[type];
  const labels = { critical: "Critical", warning: "To Improve", success: "Fixed all time" };

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
  /** Set for grouped catalog prescriptions: every image or product affected. */
  affected: AffectedItem[] | null;
};

/** How many affected items to list before summarising the rest. */
const MAX_AFFECTED_LISTED = 25;

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
            {item.pageUrl ? (
              <s-link href={item.pageUrl} target="_blank">{item.title ?? "Product"}</s-link>
            ) : (
              <s-text>{item.title ?? "Product"}</s-text>
            )}
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
  const productCount = issue.affected
    ? new Set(issue.affected.map((item) => item.pageUrl ?? item.title)).size
    : 0;
  const subtitle = issue.affected
    ? `Across ${productCount} ${productCount === 1 ? "product" : "products"}`
    : path;

  return (
    <s-box padding="base" border-width="base none none none" border-color="base">
      <s-stack direction="inline" gap="base" align-items="center" justify-content="space-between">
        <s-stack direction="block" gap="small-300">
          <s-text type="strong">{issue.title}</s-text>
          {subtitle && <s-text color="subdued">{subtitle}</s-text>}
        </s-stack>
        <s-stack direction="inline" gap="small" align-items="center">
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

  const isScanning = !!data.runningAudit;
  const isSubmitting = fetcher.state !== "idle";
  const scanDisabled = isScanning || isSubmitting;

  const totalIssues = data.critical.length + data.improvements.length + data.minor.length;

  const startScan = () => fetcher.submit({ intent: "scan" }, { method: "post" });

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
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={scanDisabled}
        onClick={startScan}
      >
        {scanDisabled ? "Scanning..." : "Scan Store"}
      </s-button>

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
          with <s-text type="strong">npm run dev</s-text> (it now starts the worker
          automatically), or run <s-text type="strong">npm run worker</s-text> in a
          separate terminal. The scan will begin as soon as a worker is up.
        </s-banner>
      )}

      {isScanning && (
        <div style={{
          padding: 20,
          background: "#EFF6FF",
          borderRadius: 12,
          marginBottom: 24,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            Scanning your store…
          </div>
          <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>
            {data.runningAudit?.status === "pending"
              ? "Waiting to start"
              : `${data.runningAudit?.currentStep || "Getting started"} · ${data.runningAudit?.progress ?? 0}%`}
          </div>
          <div style={{ height: 6, background: "#DBEAFE", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              width: `${data.runningAudit?.progress ?? 0}%`,
              height: "100%",
              background: "#2563EB",
              transition: "width 300ms ease",
            }} />
          </div>
        </div>
      )}

      {data.hasAudit ? (
        <>
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 13, color: "#6B7280", margin: "0 0 16px 0" }}>
              Last scan: {data.lastAuditDate}
            </p>
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
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px 0", color: "#065F46" }}>
                Your store looks great!
              </h2>
              <p style={{ fontSize: 14, color: "#6B7280", margin: 0 }}>
                No issues found. Run another scan anytime.
              </p>
            </div>
          )}
        </>
      ) : (
        !isScanning && (
          <div style={{
            textAlign: "center",
            padding: 48,
            background: "#F9FAFB",
            borderRadius: 12,
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px 0" }}>
              Ready to check your store?
            </h2>
            <p style={{ fontSize: 14, color: "#6B7280", margin: "0 0 16px 0" }}>
              We&apos;ll scan your pages and find ways to improve conversions.
            </p>
            <s-button variant="primary" disabled={scanDisabled} onClick={startScan}>
              Start First Scan
            </s-button>
          </div>
        )
      )}

      <div style={{
        display: "flex",
        gap: 16,
        marginTop: 24,
        paddingTop: 24,
        borderTop: "1px solid #E5E7EB",
      }}>
        <Link to="/app/history" style={{ fontSize: 13, color: "#2563EB", textDecoration: "none" }}>
          View fix history ({data.fixCount})
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
