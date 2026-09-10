import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getScoreBand } from "../scoring";

interface PageIssue {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  fixableByAI: boolean;
}

interface PageDetail {
  id: string;
  url: string;
  title: string;
  pageType: string;
  croScore: number;
  perfScore: number;
  mobileScreenshot?: string;
  desktopScreenshot?: string;
  issues: PageIssue[];
  metrics: {
    lcp: number;
    cls: number;
    inp: number;
    tbt: number;
  };
  scripts: Array<{
    name: string;
    size: number;
    blocking: boolean;
  }>;
  lastScanned: string;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // TODO: Fetch from database
  const page: PageDetail = {
    id: params.id || "1",
    url: "/products/blue-runner-shoes",
    title: "Blue Runner Shoes",
    pageType: "Product",
    croScore: 63,
    perfScore: 72,
    issues: [
      { id: "1", severity: "high", title: "No reviews above the fold", fixableByAI: false },
      { id: "2", severity: "medium", title: "Description too short (38 words)", fixableByAI: true },
      { id: "3", severity: "medium", title: "Missing FAQ section", fixableByAI: true },
      { id: "4", severity: "medium", title: "No trust badges", fixableByAI: true },
      { id: "5", severity: "medium", title: "Missing meta description", fixableByAI: true },
      { id: "6", severity: "low", title: "No structured data", fixableByAI: false },
    ],
    metrics: {
      lcp: 3.1,
      cls: 0.02,
      inp: 180,
      tbt: 450,
    },
    scripts: [
      { name: "Klaviyo", size: 412, blocking: true },
      { name: "Judge.me", size: 156, blocking: false },
      { name: "Google Analytics", size: 89, blocking: false },
    ],
    lastScanned: "Sep 3, 2026 at 2:34 PM",
  };

  return { page };
};

const severityTone = {
  high: "critical",
  medium: "warning",
  low: "info",
} as const;

function ScoreCard({ score, label }: { score: number; label: string }) {
  const band = getScoreBand(score);
  const colors = {
    critical: { bg: "#FFF4F4", text: "#8E1F0B" },
    warning: { bg: "#FFF8E6", text: "#8A6100" },
    success: { bg: "#F0FFF4", text: "#0D6832" },
  };
  const { bg, text } = colors[band];

  return (
    <div style={{ background: bg, padding: 16, border: "1px solid #E1E3E5", borderRadius: 12 }}>
      <div style={{ fontSize: 13, color: "#6D7175", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color: text }}>{score}</div>
    </div>
  );
}

function MetricItem({ label, value, unit, good }: { label: string; value: number; unit: string; good: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #E1E3E5" }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: good ? "#0D6832" : "#8A6100" }}>
        {value}{unit}
      </span>
    </div>
  );
}

export default function PageDetail() {
  const { page } = useLoaderData<typeof loader>();

  return (
    <s-page heading={page.title}>
      <Link to="/app/pages" style={{ textDecoration: "none" }}>
        <s-button slot="navigation" variant="tertiary">
          ← Back to Pages
        </s-button>
      </Link>
      <s-button slot="primary-action">Rescan page</s-button>

      <p style={{ margin: "0 0 16px 0", fontSize: 13, color: "#6D7175" }}>
        {page.pageType} • {page.url} • Last scanned {page.lastScanned}
      </p>

      {/* Score cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <ScoreCard score={page.croScore} label="CRO Score" />
        <ScoreCard score={page.perfScore} label="Performance Score" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Issues section */}
        <s-section heading={`Issues (${page.issues.length})`}>
          <s-box borderWidth="base" borderRadius="large" padding="none">
            {page.issues.map((issue) => (
              <div
                key={issue.id}
                style={{
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  borderBottom: "1px solid #E1E3E5",
                  fontSize: 13,
                }}
              >
                <s-badge tone={severityTone[issue.severity]}>
                  {issue.severity.charAt(0).toUpperCase()}
                </s-badge>
                <span style={{ flex: 1 }}>{issue.title}</span>
                {issue.fixableByAI ? (
                  <s-button variant="primary">Fix</s-button>
                ) : (
                  <s-button>View</s-button>
                )}
              </div>
            ))}
          </s-box>
        </s-section>

        {/* Performance section */}
        <s-section heading="Performance">
          <s-box padding="base" borderWidth="base" borderRadius="large">
            <MetricItem label="Largest Contentful Paint" value={page.metrics.lcp} unit="s" good={page.metrics.lcp < 2.5} />
            <MetricItem label="Cumulative Layout Shift" value={page.metrics.cls} unit="" good={page.metrics.cls < 0.1} />
            <MetricItem label="Interaction to Next Paint" value={page.metrics.inp} unit="ms" good={page.metrics.inp < 200} />
            <MetricItem label="Total Blocking Time" value={page.metrics.tbt} unit="ms" good={page.metrics.tbt < 300} />
          </s-box>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Third-party scripts</div>
            <s-box borderWidth="base" borderRadius="large" padding="none">
              {page.scripts.map((script, i) => (
                <div
                  key={i}
                  style={{
                    padding: "10px 16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderBottom: i < page.scripts.length - 1 ? "1px solid #E1E3E5" : undefined,
                    fontSize: 13,
                  }}
                >
                  <span>{script.name}</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ color: "#6D7175" }}>{script.size} KB</span>
                    {script.blocking && <s-badge tone="warning">Blocking</s-badge>}
                  </div>
                </div>
              ))}
            </s-box>
          </div>
        </s-section>
      </div>

      {/* Footer help */}
      <div
        style={{
          textAlign: "center",
          fontSize: 13,
          color: "#6D7175",
          paddingTop: 24,
        }}
      >
        Need help? <s-link href="#">Read the docs</s-link> or email{" "}
        <s-link href="mailto:support@storerx.app">support@storerx.app</s-link>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
