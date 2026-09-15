import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { SCAN_SCOPES, isScanScope } from "../scans/scopes";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) {
    return { fixes: [], scans: [] };
  }

  const audits = await prisma.audit.findMany({
    where: { shopId: shop.id, status: { in: ["completed", "failed"] } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const fixes = await prisma.fix.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return {
    scans: audits.map((a) => ({
      id: a.id,
      date: (a.completedAt ?? a.createdAt).toLocaleString(),
      status: a.status,
      score: a.overallScore,
      area: isScanScope(a.scope) ? SCAN_SCOPES[a.scope].label : a.scope,
      issues: a.totalIssues,
      newCount: a.newCount,
      resolvedCount: a.resolvedCount,
      error: a.error,
    })),
    fixes: fixes.map(f => ({
      id: f.id,
      type: f.type,
      target: f.targetTitle,
      status: f.status,
      date: f.appliedAt?.toLocaleDateString() || f.createdAt.toLocaleDateString(),
      canUndo: Boolean(
        f.status === "applied" && f.undoExpiresAt && f.undoExpiresAt > new Date(),
      ),
    })),
  };
};

const typeLabels: Record<string, string> = {
  product_description: "Description",
  seo_title: "SEO Title",
  seo_meta: "Meta Description",
  alt_text: "Alt Text",
  faq: "FAQ",
};

const statusLabels: Record<string, { label: string; color: string }> = {
  preview: { label: "Pending", color: "#F59E0B" },
  applied: { label: "Applied", color: "#10B981" },
  undone: { label: "Undone", color: "#6B7280" },
};

type ScanRow = {
  id: string;
  date: string;
  status: string;
  score: number | null;
  area: string;
  issues: number;
  newCount: number;
  resolvedCount: number;
  error: string | null;
};

function ScanHistory({ scans }: { scans: ScanRow[] }) {
  if (scans.length === 0) {
    return (
      <s-section heading="Scans">
        <s-paragraph color="subdued">No scans yet. Run a scan from the dashboard.</s-paragraph>
      </s-section>
    );
  }
  return (
    <s-section heading="Scans">
      <s-table variant="auto">
        <s-table-header-row>
          <s-table-header list-slot="primary">Date</s-table-header>
          <s-table-header list-slot="labeled">Scan</s-table-header>
          <s-table-header list-slot="labeled">Score</s-table-header>
          <s-table-header list-slot="labeled">Issues</s-table-header>
          <s-table-header list-slot="labeled">New</s-table-header>
          <s-table-header list-slot="labeled">Fixed</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {scans.map((scan) => (
            <s-table-row key={scan.id}>
              <s-table-cell>
                <s-stack direction="block" gap="small-500">
                  <s-text>{scan.date}</s-text>
                  {scan.status === "failed" && (
                    <s-badge tone="critical">Failed</s-badge>
                  )}
                </s-stack>
              </s-table-cell>
              <s-table-cell>{scan.area}</s-table-cell>
              <s-table-cell>{scan.score === null ? "—" : String(scan.score)}</s-table-cell>
              <s-table-cell>{scan.status === "completed" ? String(scan.issues) : "—"}</s-table-cell>
              <s-table-cell>
                {scan.status === "completed" ? String(scan.newCount) : "—"}
              </s-table-cell>
              <s-table-cell>
                {scan.status === "completed" ? String(scan.resolvedCount) : "—"}
              </s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </s-section>
  );
}

export default function History() {
  const { fixes, scans } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading="History">
      {/* Must be a direct child of s-page: `slot` only applies to host children. */}
      <s-button slot="navigation" variant="tertiary" onClick={() => navigate("/app")}>
        ← Back
      </s-button>

      <ScanHistory scans={scans} />

      <h2 style={{ fontSize: 16, fontWeight: 600, margin: "24px 0 12px 0" }}>AI fixes</h2>

      {fixes.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: 48,
          background: "#F9FAFB",
          borderRadius: 12,
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📝</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px 0" }}>
            No fixes yet
          </h2>
          <p style={{ fontSize: 14, color: "#6B7280", margin: 0 }}>
            When you fix issues with AI, they&apos;ll appear here.
          </p>
        </div>
      ) : (
        <div style={{ border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
          {fixes.map((fix, i) => (
            <div
              key={fix.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 100px 100px 100px",
                gap: 16,
                padding: "16px 20px",
                alignItems: "center",
                borderBottom: i < fixes.length - 1 ? "1px solid #E5E7EB" : undefined,
                fontSize: 14,
              }}
            >
              <div>
                <div style={{ fontWeight: 500 }}>{fix.target}</div>
                <div style={{ fontSize: 12, color: "#6B7280" }}>
                  {typeLabels[fix.type] || fix.type}
                </div>
              </div>
              <div style={{ color: "#6B7280" }}>{fix.date}</div>
              <div>
                <span style={{
                  padding: "4px 8px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 500,
                  background: fix.status === "applied" ? "#D1FAE5" : "#F3F4F6",
                  color: statusLabels[fix.status]?.color || "#6B7280",
                }}>
                  {statusLabels[fix.status]?.label || fix.status}
                </span>
              </div>
              <div style={{ textAlign: "right" }}>
                {fix.canUndo && (
                  <s-button variant="tertiary">Undo</s-button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
