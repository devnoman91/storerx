import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher, useRevalidator, Link } from "react-router";
import { useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { enqueueAudit, reapStaleAudits } from "../queue.server";

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;
type Severity = keyof typeof SEVERITY_RANK;

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
    select: { id: true, progress: true, currentStep: true },
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

  const findings = (latestAudit?.findings ?? [])
    .slice()
    .sort((a, b) => SEVERITY_RANK[a.severity as Severity] - SEVERITY_RANK[b.severity as Severity]);

  const fixCount = await prisma.fix.count({
    where: { shopId: shop.id, status: "applied" },
  });

  return {
    shopDomain,
    hasAudit: !!latestAudit,
    lastAuditDate: latestAudit?.completedAt?.toLocaleDateString() || null,
    runningAudit,
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

function IssueCard({ severity, title, explanation, fixable }: {
  severity: Severity;
  title: string;
  explanation: string | null;
  fixable: boolean;
}) {
  const severityColors = {
    high: "#EF4444",
    medium: "#F59E0B",
    low: "#6B7280",
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "16px 20px",
      borderBottom: "1px solid #E5E7EB",
    }}>
      <div style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: severityColors[severity],
        flexShrink: 0,
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14 }}>{title}</div>
        {explanation && (
          <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{explanation}</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {fixable ? (
          <s-button variant="primary">Fix with AI</s-button>
        ) : (
          <s-button>View</s-button>
        )}
      </div>
    </div>
  );
}

function IssueSection({ heading, color, issues }: {
  heading: string;
  color: string;
  issues: Array<{
    id: string;
    severity: string;
    title: string;
    explanation: string | null;
    fixableByAI: boolean;
  }>;
}) {
  if (issues.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px 0", color }}>
        {heading} ({issues.length})
      </h2>
      <div style={{ border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
        {issues.map((issue) => (
          <IssueCard
            key={issue.id}
            severity={issue.severity as Severity}
            title={issue.title}
            explanation={issue.explanation}
            fixable={issue.fixableByAI}
          />
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
            {data.runningAudit?.currentStep || "Getting started"} · {data.runningAudit?.progress ?? 0}%
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
