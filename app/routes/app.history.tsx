import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { SCAN_SCOPES, isScanScope } from "../scans/scopes";
import { SUGGESTION_LABELS } from "../remedies/actions";
import type { SuggestionKind } from "../remedies/types";
import { StateCard } from "../components/primitives";

/** Drafts shown before the list is truncated. */
const DRAFT_LIMIT = 50;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { scans: [], drafts: [] };

  const [audits, drafts] = await Promise.all([
    prisma.audit.findMany({
      where: { shopId: shop.id, status: { in: ["completed", "failed"] } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.suggestion.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: DRAFT_LIMIT,
      include: { issue: { select: { ruleId: true } } },
    }),
  ]);

  return {
    scans: audits.map((audit) => ({
      id: audit.id,
      date: (audit.completedAt ?? audit.createdAt).toLocaleString(),
      status: audit.status,
      score: audit.overallScore,
      area: isScanScope(audit.scope) ? SCAN_SCOPES[audit.scope].label : audit.scope,
      issues: audit.totalIssues,
      newCount: audit.newCount,
      resolvedCount: audit.resolvedCount,
    })),
    drafts: drafts.map((draft) => ({
      id: draft.id,
      ruleId: draft.issue.ruleId,
      kind: draft.kind,
      label: SUGGESTION_LABELS[draft.kind as SuggestionKind]?.heading ?? draft.kind,
      target: draft.targetTitle ?? "Your store",
      status: draft.status,
      date: (draft.readyAt ?? draft.createdAt).toLocaleDateString(),
    })),
  };
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
};

function ScanHistory({ scans }: { scans: ScanRow[] }) {
  if (scans.length === 0) {
    return (
      <s-section heading="Scans">
        <StateCard
          icon="search"
          heading="No scans yet"
          action={<s-button variant="primary" href="/app">Run your first scan</s-button>}
        >
          Pick an area on the dashboard and StoreRx will check it.
        </StateCard>
      </s-section>
    );
  }

  return (
    <s-section heading="Scans">
      <s-table variant="auto">
        <s-table-header-row>
          <s-table-header listSlot="primary">Date</s-table-header>
          <s-table-header listSlot="labeled">Area</s-table-header>
          <s-table-header listSlot="labeled">Score</s-table-header>
          <s-table-header listSlot="labeled">Issues</s-table-header>
          <s-table-header listSlot="labeled">New</s-table-header>
          <s-table-header listSlot="labeled">Verified</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {scans.map((scan) => (
            <s-table-row key={scan.id}>
              <s-table-cell>
                <s-stack direction="block" gap="small-500">
                  <s-text>{scan.date}</s-text>
                  {scan.status === "failed" && <s-badge tone="critical">Failed</s-badge>}
                </s-stack>
              </s-table-cell>
              <s-table-cell>{scan.area}</s-table-cell>
              <s-table-cell>{scan.score === null ? "—" : String(scan.score)}</s-table-cell>
              <s-table-cell>{scan.status === "completed" ? String(scan.issues) : "—"}</s-table-cell>
              <s-table-cell>{scan.status === "completed" ? String(scan.newCount) : "—"}</s-table-cell>
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

type DraftRow = {
  id: string;
  ruleId: string;
  label: string;
  target: string;
  status: string;
  date: string;
};

const DRAFT_STATUS: Record<string, { label: string; tone: "info" | "success" | "critical" }> = {
  pending: { label: "Drafting", tone: "info" },
  ready: { label: "Ready to use", tone: "success" },
  failed: { label: "Failed", tone: "critical" },
};

function DraftHistory({ drafts }: { drafts: DraftRow[] }) {
  if (drafts.length === 0) {
    return (
      <s-section heading="Drafted copy">
        <StateCard icon="wand" heading="No copy drafted yet">
          When you ask StoreRx to draft alt text, an SEO title or a description, it appears here.
          StoreRx drafts it — you decide whether to use it.
        </StateCard>
      </s-section>
    );
  }

  return (
    <s-section heading="Drafted copy">
      <s-paragraph color="subdued">
        Copy StoreRx wrote for you to review. None of it was applied to your store.
      </s-paragraph>
      <s-stack direction="block" gap="small">
        {drafts.map((draft) => {
          const status = DRAFT_STATUS[draft.status] ?? { label: draft.status, tone: "info" as const };
          return (
            <s-stack
              key={draft.id}
              direction="inline"
              gap="small"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-stack direction="block" gap="small-500">
                <s-link href={`/app/issues/${encodeURIComponent(draft.ruleId)}`}>
                  {draft.target}
                </s-link>
                <s-text color="subdued">
                  {draft.label} · {draft.date}
                </s-text>
              </s-stack>
              <s-badge tone={status.tone}>{status.label}</s-badge>
            </s-stack>
          );
        })}
      </s-stack>
    </s-section>
  );
}

export default function History() {
  const { scans, drafts } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading="History">
      {/* Must be a direct child of s-page: `slot` only applies to host children. */}
      <s-button slot="navigation" variant="tertiary" onClick={() => navigate("/app")}>
        ← Back
      </s-button>

      <ScanHistory scans={scans} />
      <DraftHistory drafts={drafts} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
