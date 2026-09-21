import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { allRules, CATALOG_IMAGE_RULE_DESCRIPTIONS, CATALOG_IMAGE_RULE_IDS } from "../rules";
import { isCatalogPage, UNREACHABLE_RULE_IDS } from "../scoring";
import { SCAN_SCOPES, isScanScope, type ScanScope } from "../scans/scopes";
import { catalogTitle } from "../issues/wording";
import { AREA_ICON, severityToken } from "../components/tokens";
import { ImpactBadge, issueHref, pagePath } from "../components/issue-ui";
import { StateCard } from "../components/primitives";

/**
 * What a scan's failure means for the merchant, and what they can do about it.
 * The stored message is written for them, but some failures have a next step
 * that belongs on a button rather than buried in a sentence.
 */
function failureHelp(error: string): { action?: { label: string; href: string }; retry: boolean } {
  if (/storefront password|password-protected/i.test(error) && /Settings/i.test(error)) {
    return { action: { label: "Add your storefront password", href: "/app/settings" }, retry: true };
  }
  if (/PageSpeed/i.test(error)) {
    return { action: { label: "Open Shopify preferences", href: "shopify://admin/online_store/preferences" }, retry: true };
  }
  // A database or worker fault is StoreRx's problem, and retrying is the fix.
  if (/prisma|column|does not exist|timed out/i.test(error)) return { retry: true };
  return { retry: true };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) throw new Response("Not found", { status: 404 });

  const audit = await prisma.audit.findFirst({
    where: { id: params.auditId, shopId: shop.id },
    include: { findings: true, pageScores: true },
  });
  if (!audit) throw new Response("Not found", { status: 404 });

  const scope = isScanScope(audit.scope) ? audit.scope : null;
  const spec = scope ? SCAN_SCOPES[scope] : null;

  // Everything this area checks, and how each one turned out. A check that was
  // not evaluated is shown as such rather than quietly counted as a pass.
  const fired = new Map<string, typeof audit.findings>();
  for (const finding of audit.findings) {
    const group = fired.get(finding.ruleId);
    if (group) group.push(finding);
    else fired.set(finding.ruleId, [finding]);
  }
  const evaluated = new Set(audit.evaluatedRules);

  // A rule no scan can run would sit in this list as permanently skipped,
  // which is noise rather than information.
  const reachable = (id: string) => !UNREACHABLE_RULE_IDS.includes(id);
  const inScope = (id: string) =>
    reachable(id) && (spec ? spec.includesRule(id) : evaluated.has(id) || fired.has(id));
  const checks = [
    ...allRules.filter((rule) => inScope(rule.id)).map((rule) => ({ id: rule.id, label: rule.description })),
    ...CATALOG_IMAGE_RULE_IDS.filter(inScope).map((id) => ({
      id,
      label: CATALOG_IMAGE_RULE_DESCRIPTIONS[id] ?? id,
    })),
  ].map((check) => ({
    ...check,
    state: fired.has(check.id)
      ? ("found" as const)
      : evaluated.has(check.id)
        ? ("passed" as const)
        : ("skipped" as const),
  }));

  // One row per rule, as everywhere else — a rule that fired on five pages is
  // one problem, listed with what it affects.
  const found = [...fired.entries()]
    .map(([ruleId, group]) => {
      const [first] = group;
      return {
        ruleId,
        severity: first.severity,
        title: isCatalogPage(first.pageType)
          ? catalogTitle(ruleId, group.length) ?? first.title
          : first.title,
        count: group.length,
        isNew: group.some((f) => f.isNew),
        where: [...new Set(group.map((f) => f.targetTitle ?? pagePath(f.pageUrl)).filter(Boolean))].slice(0, 4) as string[],
      };
    })
    .sort((a, b) => severityToken(a.severity).rank - severityToken(b.severity).rank);

  const started = audit.startedAt?.getTime();
  const finished = audit.completedAt?.getTime();

  return {
    id: audit.id,
    scope: scope as ScanScope | null,
    area: spec?.label ?? audit.scope,
    status: audit.status,
    date: (audit.completedAt ?? audit.createdAt).toLocaleString(),
    seconds: started && finished ? Math.max(1, Math.round((finished - started) / 1000)) : null,
    error: audit.error,
    help: audit.error ? failureHelp(audit.error) : null,
    newCount: audit.newCount,
    resolvedCount: audit.resolvedCount,
    storeScore: audit.overallScore,
    checks,
    checkedCount: checks.filter((c) => c.state !== "skipped").length,
    found,
    pages: audit.pageScores.map((page) => page.pageUrl),
  };
};

const CHECK_ICON = { found: "alert-triangle", passed: "check-circle", skipped: "minus-circle" } as const;
const CHECK_TONE = { found: "warning", passed: "success", skipped: "neutral" } as const;

export default function ScanReport() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const failed = data.status === "failed";

  return (
    <s-page heading={`${data.area} scan`}>
      <s-button slot="navigation" variant="tertiary" onClick={() => navigate("/app/history")}>
        ← History
      </s-button>

      {failed && data.error && (
        <s-banner tone="critical" heading="This scan didn't finish">
          <s-stack direction="block" gap="small">
            <s-paragraph>{data.error}</s-paragraph>
            <s-stack direction="inline" gap="small" alignItems="center">
              {data.help?.action && (
                <s-button variant="primary" href={data.help.action.href}>
                  {data.help.action.label}
                </s-button>
              )}
              {data.help?.retry && data.scope && (
                <s-button variant="secondary" href="/app">
                  Run it again
                </s-button>
              )}
            </s-stack>
          </s-stack>
        </s-banner>
      )}

      <s-section>
        <s-stack direction="block" gap="small">
          <s-stack direction="inline" gap="small-300" alignItems="center">
            {data.scope && <s-icon type={AREA_ICON[data.scope]} tone="neutral" size="base" />}
            <s-text color="subdued">{data.date}</s-text>
            {failed ? (
              <s-badge tone="critical">Failed</s-badge>
            ) : (
              <s-badge tone="success" icon="check-circle">
                Completed
              </s-badge>
            )}
            {data.seconds !== null && <s-text color="subdued">· took {data.seconds}s</s-text>}
          </s-stack>

          {!failed && (
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone="neutral">{`${data.checkedCount} of ${data.checks.length} checks run`}</s-badge>
              <s-badge tone={data.found.length > 0 ? "warning" : "success"}>
                {`${data.found.length} ${data.found.length === 1 ? "problem" : "problems"} found`}
              </s-badge>
              {data.newCount > 0 && <s-badge tone="info">{`${data.newCount} new`}</s-badge>}
              {data.resolvedCount > 0 && (
                <s-badge tone="success">{`${data.resolvedCount} verified fixed`}</s-badge>
              )}
            </s-stack>
          )}

          {data.pages.length > 0 && (
            <s-text color="subdued">
              {`Looked at ${data.pages.length} ${data.pages.length === 1 ? "page" : "pages"}: `}
              {data.pages.map((url) => pagePath(url)).join(", ")}
            </s-text>
          )}
        </s-stack>
      </s-section>

      {!failed && (
        <s-section heading={`What this scan found (${data.found.length})`}>
          {data.found.length === 0 ? (
            <StateCard icon="check-circle" tone="success" heading="Nothing to fix here">
              Every check in this area passed.
            </StateCard>
          ) : (
            <s-stack direction="block" gap="small">
              {data.found.map((item) => (
                <s-box key={item.ruleId} padding="base" background="subdued" borderRadius="base">
                  <s-stack
                    direction="inline"
                    gap="small"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-stack direction="block" gap="small-500">
                      <s-link href={issueHref(item.ruleId)}>{item.title}</s-link>
                      {item.where.length > 0 && (
                        <s-text color="subdued">
                          {item.where.join(", ")}
                          {item.count > item.where.length ? ` and ${item.count - item.where.length} more` : ""}
                        </s-text>
                      )}
                    </s-stack>
                    <s-stack direction="inline" gap="small-300" alignItems="center">
                      {item.isNew && <s-badge tone="info">New</s-badge>}
                      <ImpactBadge severity={item.severity} />
                    </s-stack>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          )}
        </s-section>
      )}

      <s-section heading={`Everything this scan checks (${data.checks.length})`}>
        <s-paragraph color="subdued">
          A check StoreRx couldn&apos;t run is listed as skipped, never as a pass — an empty cart
          has no checkout button to look at, for example.
        </s-paragraph>
        <s-stack direction="block" gap="small-300">
          {data.checks.map((check) => (
            <s-stack key={check.id} direction="inline" gap="small-300" alignItems="center">
              <s-icon type={CHECK_ICON[check.state]} tone={CHECK_TONE[check.state]} size="small" />
              <s-text color={check.state === "skipped" ? "subdued" : "base"}>{check.label}</s-text>
              {check.state === "skipped" && <s-text color="subdued">— skipped</s-text>}
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (!(error instanceof Response && error.status === 404)) return boundary.error(error);

  return (
    <s-page heading="Scan not found">
      <s-section>
        <StateCard
          icon="clock"
          heading="StoreRx has no record of this scan"
          action={
            <s-button variant="primary" href="/app/history">
              Back to history
            </s-button>
          }
        >
          It may belong to another store, or have been removed.
        </StateCard>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
