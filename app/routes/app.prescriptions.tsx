import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState } from "react";
import prisma from "../db.server";

interface Prescription {
  id: string;
  ruleId: string;
  severity: "high" | "medium" | "low";
  title: string;
  page: string;
  pageUrl?: string;
  explanation?: string;
  evidence?: string;
  fixableByAI: boolean;
  fixType?: string;
  targetId?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Get shop
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });

  if (!shop) {
    return { prescriptions: [] };
  }

  // Get latest audit findings
  const latestAudit = await prisma.audit.findFirst({
    where: { shopId: shop.id, status: "completed" },
    orderBy: { completedAt: "desc" },
  });

  if (!latestAudit) {
    return { prescriptions: [] };
  }

  // Get open findings
  const findings = await prisma.finding.findMany({
    where: {
      auditId: latestAudit.id,
      status: "open",
    },
    orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
  });

  const prescriptions: Prescription[] = findings.map((f) => ({
    id: f.id,
    ruleId: f.ruleId,
    severity: f.severity as "high" | "medium" | "low",
    title: f.title,
    page: f.pageType.charAt(0).toUpperCase() + f.pageType.slice(1),
    explanation: f.explanation || undefined,
    evidence: f.evidenceValue || undefined,
    fixableByAI: f.fixableByAI,
    fixType: f.fixType || undefined,
    targetId: f.targetId || undefined,
  }));

  return { prescriptions };
};

const severityTone = {
  high: "critical",
  medium: "warning",
  low: "info",
} as const;

function PrescriptionRow({
  prescription,
  isExpanded,
  onToggle,
}: {
  prescription: Prescription;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ borderBottom: "1px solid #E1E3E5" }}>
      <div
        onClick={onToggle}
        style={{
          padding: "12px 20px",
          display: "grid",
          gridTemplateColumns: "100px 1fr 100px 100px",
          gap: 12,
          alignItems: "center",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        <s-badge tone={severityTone[prescription.severity]}>
          {prescription.severity.charAt(0).toUpperCase() + prescription.severity.slice(1)}
        </s-badge>
        <span>{prescription.title}</span>
        <span style={{ color: "#6D7175" }}>{prescription.page}</span>
        <div style={{ textAlign: "right" }}>
          {prescription.fixableByAI ? (
            <s-button variant="primary">Fix with AI</s-button>
          ) : (
            <s-button>View</s-button>
          )}
        </div>
      </div>

      {isExpanded && (
        <div
          style={{
            padding: "0 20px 16px 20px",
            marginLeft: 100 + 12,
            borderLeft: "2px solid #E1E3E5",
            fontSize: 13,
          }}
        >
          {prescription.explanation && (
            <p style={{ margin: "0 0 12px 0", color: "#202223" }}>
              {prescription.explanation}
            </p>
          )}
          {prescription.evidence && (
            <p style={{ margin: "0 0 12px 0", color: "#6D7175", fontStyle: "italic" }}>
              {prescription.evidence}
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {prescription.fixableByAI ? (
              <s-button variant="primary">Fix with AI</s-button>
            ) : (
              <s-button>How to fix manually</s-button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Prescriptions() {
  const { prescriptions } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filter = searchParams.get("filter") || "all";

  const filtered = prescriptions.filter((p) => {
    if (filter === "all") return true;
    if (filter === "high") return p.severity === "high";
    if (filter === "medium") return p.severity === "medium";
    if (filter === "fixable") return p.fixableByAI;
    return true;
  });

  const highCount = prescriptions.filter((p) => p.severity === "high").length;
  const mediumCount = prescriptions.filter((p) => p.severity === "medium").length;
  const fixableCount = prescriptions.filter((p) => p.fixableByAI).length;

  return (
    <s-page heading="Prescriptions">
      <s-button slot="primary-action">Run audit</s-button>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <s-button
          variant={filter === "all" ? "primary" : "secondary"}
          onClick={() => setSearchParams({})}
        >
          All ({prescriptions.length})
        </s-button>
        <s-button
          variant={filter === "high" ? "primary" : "secondary"}
          onClick={() => setSearchParams({ filter: "high" })}
        >
          High ({highCount})
        </s-button>
        <s-button
          variant={filter === "medium" ? "primary" : "secondary"}
          onClick={() => setSearchParams({ filter: "medium" })}
        >
          Medium ({mediumCount})
        </s-button>
        <s-button
          variant={filter === "fixable" ? "primary" : "secondary"}
          onClick={() => setSearchParams({ filter: "fixable" })}
        >
          AI fixable ({fixableCount})
        </s-button>
      </div>

      {/* Prescriptions table */}
      <s-box borderWidth="base" borderRadius="large" padding="none">
        {/* Header */}
        <div
          style={{
            padding: "12px 20px",
            display: "grid",
            gridTemplateColumns: "100px 1fr 100px 100px",
            gap: 12,
            borderBottom: "1px solid #E1E3E5",
            fontSize: 12,
            fontWeight: 600,
            color: "#6D7175",
          }}
        >
          <span>Priority</span>
          <span>Issue</span>
          <span>Page</span>
          <span style={{ textAlign: "right" }}>Action</span>
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#6D7175" }}>
            No prescriptions found.
          </div>
        ) : (
          filtered.map((p) => (
            <PrescriptionRow
              key={p.id}
              prescription={p}
              isExpanded={expandedId === p.id}
              onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
            />
          ))
        )}
      </s-box>

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
