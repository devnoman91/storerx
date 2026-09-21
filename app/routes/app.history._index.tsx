import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import { useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { SCAN_SCOPES, isScanScope, type ScanScope } from "../scans/scopes";
import { SUGGESTION_LABELS } from "../remedies/actions";
import type { SuggestionKind } from "../remedies/types";
import { StateCard } from "../components/primitives";
import { AREA_ICON } from "../components/tokens";

/** Drafts shown before the list is truncated. */
const DRAFT_LIMIT = 50;

/** A failure a merchant can act on, said in one short line. */
function failureSummary(error: string | null): string {
  if (!error) return "Didn't finish";
  if (/password-protected|storefront password/i.test(error)) return "Your storefront is password-protected";
  if (/PageSpeed/i.test(error)) return "Google PageSpeed couldn't reach your store";
  if (/prisma|column .* does not exist/i.test(error)) return "StoreRx was mid-update — run it again";
  if (/timed out/i.test(error)) return "Timed out";
  if (/uninstall/i.test(error)) return "The app was uninstalled";
  return error.replace(/\s+/g, " ").slice(0, 80);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { scans: [], drafts: [], running: [] };

  const [audits, drafts] = await Promise.all([
    prisma.audit.findMany({
      where: { shopId: shop.id },
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

  const label = (scope: string) => (isScanScope(scope) ? SCAN_SCOPES[scope].label : scope);

  return {
    // A scan in progress belongs here too — it is the most recent thing that
    // happened, and looking for it in History and not finding it is confusing.
    running: audits
      .filter((audit) => audit.status === "pending" || audit.status === "running")
      .map((audit) => ({
        id: audit.id,
        area: label(audit.scope),
        scope: isScanScope(audit.scope) ? audit.scope : null,
        queued: audit.status === "pending",
        step: audit.currentStep,
        progress: audit.progress,
      })),
    scans: audits
      .filter((audit) => audit.status === "completed" || audit.status === "failed")
      .map((audit) => ({
        id: audit.id,
        date: (audit.completedAt ?? audit.createdAt).toLocaleString(),
        failed: audit.status === "failed",
        area: label(audit.scope),
        scope: isScanScope(audit.scope) ? audit.scope : null,
        storeScore: audit.overallScore,
        issues: audit.totalIssues,
        newCount: audit.newCount,
        resolvedCount: audit.resolvedCount,
        reason: audit.status === "failed" ? failureSummary(audit.error) : null,
      })),
    drafts: drafts.map((draft) => ({
      id: draft.id,
      ruleId: draft.issue.ruleId,
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
  failed: boolean;
  area: string;
  scope: ScanScope | null;
  storeScore: number | null;
  issues: number;
  newCount: number;
  resolvedCount: number;
  reason: string | null;
};

/** What a finished scan actually did, in one line. */
function Outcome({ scan }: { scan: ScanRow }) {
  if (scan.failed) {
    return (
      <s-stack direction="inline" gap="small-300" alignItems="center">
        <s-icon type="alert-triangle" tone="critical" size="small" />
        <s-text color="subdued">{scan.reason}</s-text>
      </s-stack>
    );
  }

  const parts = [
    `${scan.issues} ${scan.issues === 1 ? "problem" : "problems"}`,
    scan.newCount > 0 ? `${scan.newCount} new` : null,
    scan.resolvedCount > 0 ? `${scan.resolvedCount} verified` : null,
  ].filter(Boolean);

  return <s-text color="subdued">{parts.join(" · ")}</s-text>;
}

function ScanHistory({ scans, running }: { scans: ScanRow[]; running: Array<{ id: string; area: string; scope: ScanScope | null; queued: boolean; step: string | null; progress: number }> }) {
  if (scans.length === 0 && running.length === 0) {
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
      <s-stack direction="block" gap="small">
        {running.map((scan) => (
          <s-box key={scan.id} padding="base" background="subdued" borderRadius="base">
            <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-spinner size="base" accessibilityLabel="Scan running" />
                <s-stack direction="block" gap="small-500">
                  <s-text type="strong">{scan.area}</s-text>
                  <s-text color="subdued">
                    {scan.queued ? "Waiting to start" : `${scan.step ?? "Working"} · ${scan.progress}%`}
                  </s-text>
                </s-stack>
              </s-stack>
              <s-badge tone="info">{scan.queued ? "Queued" : "Scanning"}</s-badge>
            </s-stack>
          </s-box>
        ))}

        {scans.map((scan) => (
          <s-box key={scan.id} padding="base" background="subdued" borderRadius="base">
            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="inline" gap="small" alignItems="center">
                {scan.scope && <s-icon type={AREA_ICON[scan.scope]} tone="neutral" size="base" />}
                <s-stack direction="block" gap="small-500">
                  {/* The row opens the full report: what it checked, what it
                      found, and why it failed. */}
                  <s-link href={`/app/history/${scan.id}`}>{`${scan.area} scan`}</s-link>
                  <s-text color="subdued">{scan.date}</s-text>
                </s-stack>
              </s-stack>

              <s-stack direction="inline" gap="base" alignItems="center">
                <Outcome scan={scan} />
                {scan.failed ? (
                  <s-badge tone="critical">Failed</s-badge>
                ) : (
                  <s-text color="subdued" fontVariantNumeric="tabular-nums">
                    {scan.storeScore === null ? "—" : `Store ${scan.storeScore}`}
                  </s-text>
                )}
              </s-stack>
            </s-stack>
          </s-box>
        ))}
      </s-stack>

      <s-text color="subdued">
        The score is your whole store after that scan, not that area on its own.
      </s-text>
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
  const { scans, drafts, running } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  // Keep a running scan's progress moving without the merchant refreshing.
  const revalidatorRef = useRef(revalidator);
  useEffect(() => {
    revalidatorRef.current = revalidator;
  }, [revalidator]);

  useEffect(() => {
    if (running.length === 0) return;
    const id = setInterval(() => {
      if (revalidatorRef.current.state === "idle") revalidatorRef.current.revalidate();
    }, 3000);
    return () => clearInterval(id);
  }, [running.length]);

  return (
    <s-page heading="History">
      {/* Must be a direct child of s-page: `slot` only applies to host children. */}
      <s-button slot="navigation" variant="tertiary" onClick={() => navigate("/app")}>
        ← Back
      </s-button>

      <ScanHistory scans={scans} running={running} />
      <DraftHistory drafts={drafts} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
