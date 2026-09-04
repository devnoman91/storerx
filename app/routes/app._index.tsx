import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getScoreBand } from "../scoring";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // TODO: Fetch real data from database
  // For now, return mock data matching the design
  return {
    // Store health scores
    overallScore: 74,
    scores: {
      conversion: 71,
      ux: 82,
      performance: 76,
      seo: 84,
      productPages: 63,
    },
    // Trend
    trendDirection: "up" as const,
    trendPoints: 6,
    trendPeriod: "last month",
    // Stats
    prescriptionsOpen: 8,
    fixesApplied: 12,
    fixesPeriod: "this month",
    lastAuditDays: 2,
    // High priority issues
    highPriorityCount: 3,
    // Top prescriptions
    prescriptions: [
      {
        id: "1",
        severity: "high" as const,
        title: "Product pages lack reviews above the fold",
        fixableByAI: false,
      },
      {
        id: "2",
        severity: "medium" as const,
        title: "Mobile add-to-cart button is below the fold",
        fixableByAI: false,
      },
      {
        id: "3",
        severity: "medium" as const,
        title: "42 images are missing alt text",
        fixableByAI: true,
      },
    ],
    // Audit state
    isAuditing: false,
    auditProgress: null as null | {
      step: string;
      current: number;
      total: number;
      percent: number;
    },
  };
};

function ScoreRing({ score }: { score: number }) {
  const band = getScoreBand(score);
  const color = band === "critical" ? "#B98900" : band === "warning" ? "#B98900" : "#29845A";
  const degrees = (score / 100) * 360;

  return (
    <div
      style={{
        width: 160,
        height: 160,
        borderRadius: "50%",
        background: `conic-gradient(${color} ${degrees}deg, #E3E3E3 0)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 128,
          height: 128,
          borderRadius: "50%",
          background: "#fff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 12, color: "#6D7175" }}>out of 100</span>
      </div>
    </div>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const band = getScoreBand(score);
  const color = band === "critical" ? "#8E1F0B" : band === "warning" ? "#B98900" : "#29845A";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 32px 1fr",
        gap: 12,
        alignItems: "center",
        fontSize: 13,
      }}
    >
      <span>{label}</span>
      <strong style={{ textAlign: "right" }}>{score}</strong>
      <div style={{ height: 8, background: "#E3E3E3", borderRadius: 4 }}>
        <div
          style={{
            width: `${score}%`,
            height: 8,
            background: color,
            borderRadius: 4,
          }}
        />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | string;
  suffix?: string;
}) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="large">
      <div style={{ fontSize: 13, color: "#6D7175", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>
        {value}{" "}
        {suffix && (
          <span style={{ fontSize: 13, fontWeight: 400, color: "#6D7175" }}>{suffix}</span>
        )}
      </div>
    </s-box>
  );
}

function PrescriptionRow({
  severity,
  title,
  fixableByAI,
  onView,
  onFix,
}: {
  severity: "high" | "medium" | "low";
  title: string;
  fixableByAI: boolean;
  onView: () => void;
  onFix: () => void;
}) {
  const toneMap = {
    high: "critical",
    medium: "warning",
    low: "info",
  } as const;

  return (
    <div
      style={{
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderBottom: "1px solid #E1E3E5",
        fontSize: 13,
      }}
    >
      <s-badge tone={toneMap[severity]}>
        {severity.charAt(0).toUpperCase() + severity.slice(1)}
      </s-badge>
      <span style={{ flex: 1 }}>{title}</span>
      {fixableByAI ? (
        <s-button variant="primary" onClick={onFix}>
          Fix with AI
        </s-button>
      ) : (
        <s-button onClick={onView}>
          View
        </s-button>
      )}
    </div>
  );
}

export default function Overview() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Overview">
      <s-button slot="primary-action">Run audit</s-button>

      {/* Critical issues banner */}
      {data.highPriorityCount > 0 && (
        <s-banner tone="critical">
          <strong>{data.highPriorityCount} high-priority problems are hurting your conversion.</strong>{" "}
          Fixing them first has the biggest effect on sales.
          <s-button slot="actions" variant="tertiary">
            View
          </s-button>
        </s-banner>
      )}

      {/* Store Health */}
      <s-section heading="Store health">
        <s-box padding="base" borderWidth="base" borderRadius="large">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 16,
            }}
          >
            <span style={{ fontSize: 12, color: "#6D7175" }}>
              Last check-up {data.lastAuditDays} days ago
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "260px 1fr",
              gap: 32,
              alignItems: "center",
            }}
          >
            {/* Score ring + trend */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
              }}
            >
              <ScoreRing score={data.overallScore} />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "#6D7175",
                }}
              >
                <svg width="64" height="20" viewBox="0 0 64 20">
                  <polyline
                    points="0,16 12,14 24,15 36,10 48,9 64,4"
                    fill="none"
                    stroke="#0C5132"
                    strokeWidth="2"
                  />
                </svg>
                Up {data.trendPoints} points since {data.trendPeriod}
              </div>
            </div>

            {/* Category scores */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <ScoreBar label="Conversion" score={data.scores.conversion} />
              <ScoreBar label="UX" score={data.scores.ux} />
              <ScoreBar label="Performance" score={data.scores.performance} />
              <ScoreBar label="SEO" score={data.scores.seo} />
              <ScoreBar label="Product pages" score={data.scores.productPages} />
            </div>
          </div>
        </s-box>
      </s-section>

      {/* Metric cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
          marginTop: 16,
        }}
      >
        <MetricCard
          label="Prescriptions"
          value={data.prescriptionsOpen}
          suffix="open"
        />
        <MetricCard
          label="Fixes applied"
          value={data.fixesApplied}
          suffix={data.fixesPeriod}
        />
        <MetricCard
          label="Last audit"
          value={data.lastAuditDays}
          suffix="days ago"
        />
      </div>

      {/* Top prescriptions */}
      <s-section heading="Top prescriptions">
        <s-box borderWidth="base" borderRadius="large" padding="none">
          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid #E1E3E5",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600 }}>Top prescriptions</span>
            <s-link href="/app/prescriptions">View all</s-link>
          </div>
          {data.prescriptions.map((rx) => (
            <PrescriptionRow
              key={rx.id}
              severity={rx.severity}
              title={rx.title}
              fixableByAI={rx.fixableByAI}
              onView={() => {}}
              onFix={() => {}}
            />
          ))}
        </s-box>
      </s-section>

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
