import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher, useNavigate, useRevalidator, useRouteError } from "react-router";
import { useEffect, useRef } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueAudit, isWorkerAlive } from "../queue.server";
import { aiCreditsRemaining, checkScanAllowed } from "../billing/billing.server";
import { isCatalogPage } from "../scoring";
import { SCAN_SCOPES, scopeForRule } from "../scans/scopes";
import { requestDraft, reapStaleDrafts } from "../suggestions/queue.server";
import { draftTargetFor } from "../suggestions/target";
import { actionsFor, OWNERSHIP, REMEDY_LABELS, type IssueStatus } from "../remedies/actions";
import { adminUrl } from "../remedies/links";
import type { RemedyKind, SuggestionKind } from "../remedies/types";
import { catalogTitle } from "../issues/wording";
import { EmptyState, ImpactBadge, IssueStatusBadge, RemedyChip, pagePath } from "../components/issue-ui";
import {
  CopyButton,
  EvidencePanel,
  ImplementationSteps,
  RecommendedSolution,
  SuggestedCopy,
  WhyItMatters,
  type DraftStatus,
  type DraftView,
} from "../components/recommendation";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const ruleId = params.ruleId ?? "";

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) throw new Response("Not found", { status: 404 });

  // A draft whose worker died would otherwise spin forever on this page.
  await reapStaleDrafts(shop.id);

  const issues = await prisma.issue.findMany({
    where: { shopId: shop.id, ruleId },
    orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
  });
  if (issues.length === 0) throw new Response("Not found", { status: 404 });

  const outstanding = issues.filter((issue) => issue.status !== "resolved");
  const shown = outstanding.length > 0 ? outstanding : issues;
  const [first] = shown;

  const [drafts, scope] = await Promise.all([
    prisma.suggestion.findMany({
      where: { issueId: { in: shown.map((issue) => issue.id) } },
      orderBy: { createdAt: "desc" },
    }),
    Promise.resolve(scopeForRule(ruleId)),
  ]);

  const inFlight = scope
    ? await prisma.audit.findFirst({
        where: { shopId: shop.id, scope, status: { in: ["pending", "running"] } },
        select: { status: true },
      })
    : null;

  const status: IssueStatus =
    outstanding.length === 0
      ? "resolved"
      : shown.every((issue) => issue.status === "awaiting_verification")
        ? "awaiting_verification"
        : "open";

  const catalog = isCatalogPage(first.pageType);
  const draftByTarget = new Map(drafts.map((draft) => [`${draft.issueId}:${draft.targetId}`, draft]));
  const credits = await aiCreditsRemaining(shop);

  const items = shown.map((issue) => {
    const target = draftTargetFor(issue);
    const draft = target ? draftByTarget.get(`${issue.id}:${target}`) : undefined;
    return {
      id: issue.id,
      title: issue.targetTitle ?? pagePath(issue.pageUrl) ?? "Store settings",
      pageUrl: issue.pageUrl,
      imageUrl: issue.imageUrl,
      evidenceValue: issue.evidenceValue,
      status: issue.status as IssueStatus,
      adminHref: adminUrl({ area: issue.adminArea as never, ref: issue.adminRef }),
      draftTarget: target,
      draft: {
        status: (draft?.status === "ready"
          ? "ready"
          : draft?.status === "failed"
            ? "failed"
            : draft
              ? "pending"
              : "none") as DraftStatus,
        current: draft?.current ?? null,
        suggested: draft?.suggested ?? null,
        error: draft?.error ?? null,
      } satisfies DraftView,
    };
  });

  const actions = actionsFor({
    remedy: first.remedy as RemedyKind,
    status,
    suggestion: first.suggestionKind as SuggestionKind | null,
    adminArea: first.adminArea as never,
    adminRef: shown.length === 1 || first.remedy !== "admin" ? first.adminRef : null,
  });

  return {
    ruleId,
    title: catalog ? catalogTitle(ruleId, shown.length) ?? first.title : first.title,
    severity: first.severity,
    remedy: first.remedy,
    remedyLabel: REMEDY_LABELS[first.remedy as RemedyKind] ?? "Advice",
    ownership: OWNERSHIP[first.remedy as RemedyKind] ?? OWNERSHIP.messaging,
    suggestionKind: first.suggestionKind as SuggestionKind | null,
    status,
    isNew: shown.some((issue) => issue.openedAsNew && issue.openedAuditId === issue.lastSeenAuditId),
    verificationFailed: shown.some((issue) => issue.verificationFailedAt !== null),
    explanation: first.explanation,
    recommendation: first.recommendation,
    steps: first.steps,
    evidenceValue: shown.length === 1 ? first.evidenceValue : null,
    singlePageUrl: shown.length === 1 ? first.pageUrl : null,
    destination: actions.secondary,
    catalog,
    items,
    scope: scope
      ? { key: scope, label: SCAN_SCOPES[scope].label, state: inFlight?.status ?? null }
      : null,
    credits,
    workerAlive: items.some((item) => item.draft.status === "pending") ? await isWorkerAlive() : true,
    resolvedAt: first.resolvedAt ? first.resolvedAt.toLocaleString() : null,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const ruleId = params.ruleId ?? "";

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { ok: false as const, error: "This store is not set up in StoreRx yet." };

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "draft") {
    const issueId = String(formData.get("issueId") ?? "");
    const issue = await prisma.issue.findFirst({ where: { id: issueId, shopId: shop.id } });
    if (!issue?.suggestionKind) {
      return { ok: false as const, error: "StoreRx cannot draft copy for this issue." };
    }

    const targetId = draftTargetFor(issue);
    if (!targetId) {
      return {
        ok: false as const,
        error: "StoreRx could not tell which product this belongs to. Re-scan this area first.",
      };
    }

    if ((await aiCreditsRemaining(shop)) === 0) {
      return {
        ok: false as const,
        error: "You've used all your AI credits this month.",
        limitReached: true as const,
      };
    }

    await requestDraft({
      shopId: shop.id,
      issueId: issue.id,
      kind: issue.suggestionKind as SuggestionKind,
      targetId,
      targetTitle: issue.targetTitle,
      imageUrl: issue.imageUrl,
    });
    return { ok: true as const };
  }

  if (intent === "markResolved" || intent === "reopen") {
    const done = intent === "markResolved";
    // Marking it done does not resolve it — only a scan can do that. It moves
    // to awaiting verification so the next scan of this area settles it.
    await prisma.issue.updateMany({
      where: { shopId: shop.id, ruleId, status: { in: ["open", "awaiting_verification"] } },
      data: {
        status: done ? "awaiting_verification" : "open",
        markedResolvedAt: done ? new Date() : null,
        verificationFailedAt: null,
      },
    });
    return { ok: true as const };
  }

  if (intent === "rescan") {
    const scope = scopeForRule(ruleId);
    if (!scope) return { ok: false as const, error: "No scan area covers this check." };

    const queued = await prisma.audit.findFirst({
      where: { shopId: shop.id, scope, status: { in: ["pending", "running"] } },
      select: { id: true },
    });
    if (queued) return { ok: true as const };

    const allowed = await checkScanAllowed(shop);
    if (!allowed.allowed) {
      return { ok: false as const, error: allowed.message, limitReached: true as const };
    }
    await enqueueAudit(shop.id, scope);
    return { ok: true as const };
  }

  return { ok: false as const, error: `Unsupported action: ${String(intent)}` };
};

export default function IssueDetail() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const navigate = useNavigate();

  const busy = fetcher.state !== "idle";
  const drafting = data.items.some((item) => item.draft.status === "pending");
  const scanning = data.scope?.state !== null && data.scope?.state !== undefined;

  const submit = (fields: Record<string, string>) => fetcher.submit(fields, { method: "post" });

  // Drafts and scans both finish in the background; poll so the page settles
  // on its own rather than leaving the merchant to refresh.
  const revalidatorRef = useRef(revalidator);
  useEffect(() => {
    revalidatorRef.current = revalidator;
  }, [revalidator]);

  useEffect(() => {
    if (!drafting && !scanning) return;
    const id = setInterval(() => {
      if (revalidatorRef.current.state === "idle") revalidatorRef.current.revalidate();
    }, 3000);
    return () => clearInterval(id);
  }, [drafting, scanning]);

  const copyable = [data.recommendation, ...data.steps.map((step, i) => `${i + 1}. ${step}`)]
    .filter(Boolean)
    .join("\n");

  const creditsSpent = data.credits === 0;

  return (
    <s-page heading={data.title}>
      <s-button slot="navigation" variant="tertiary" onClick={() => navigate("/app")}>
        ← Back
      </s-button>

      {fetcher.data && !fetcher.data.ok && (
        <s-banner tone={"limitReached" in fetcher.data ? "warning" : "critical"} heading="Not done">
          {fetcher.data.error}{" "}
          {"limitReached" in fetcher.data && <s-link href="/app/billing">See plans</s-link>}
        </s-banner>
      )}

      {data.verificationFailed && (
        <s-banner tone="warning" heading="Still found on the last scan">
          You marked this as done, but the most recent {data.scope?.label ?? "scan"} still found it.
          The steps below may not have been applied, or the change may not have been published.
        </s-banner>
      )}

      {data.status === "awaiting_verification" && !data.verificationFailed && (
        <s-banner tone="info" heading="Waiting to be verified">
          You marked this as done. Run a {data.scope?.label ?? "scan"} scan and StoreRx will confirm
          it for you.
        </s-banner>
      )}

      {data.status === "resolved" && (
        <s-banner tone="success" heading="Verified">
          A scan confirmed this was solved{data.resolvedAt ? ` on ${data.resolvedAt}` : ""}.
        </s-banner>
      )}

      {drafting && !data.workerAlive && (
        <s-banner tone="warning" heading="Nothing is processing your draft">
          The worker isn&apos;t running. Start it with <s-text type="strong">npm run dev</s-text>, or
          run <s-text type="strong">npm run worker</s-text> in a separate terminal.
        </s-banner>
      )}

      <s-section>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small" alignItems="center">
            <ImpactBadge severity={data.severity} />
            <RemedyChip remedy={data.remedy} />
            {data.isNew && <s-badge tone="info">New</s-badge>}
            <IssueStatusBadge status={data.status} verificationFailed={data.verificationFailed} />
          </s-stack>

          <s-text color="subdued">
            {data.items.length === 1
              ? data.items[0].title
              : data.catalog
                ? `Across ${data.items.length} items in your catalog`
                : `On ${data.items.length} pages`}
          </s-text>

          <EvidencePanel evidenceValue={data.evidenceValue} pageUrl={data.singlePageUrl} />
        </s-stack>
      </s-section>

      <s-section heading="StoreRx recommends">
        <s-stack direction="block" gap="large-100">
          <WhyItMatters text={data.explanation} />
          <RecommendedSolution text={data.recommendation} />
          <ImplementationSteps steps={data.steps} ownership={data.ownership} />

          <s-stack direction="inline" gap="small" alignItems="center">
            {copyable && <CopyButton value={copyable} label="Copy recommendation" />}
            {data.destination?.href && (
              <s-button variant="primary" href={data.destination.href}>
                {data.destination.label}
              </s-button>
            )}
          </s-stack>

          {data.destination?.unavailable && (
            <s-text color="subdued">{data.destination.unavailable}</s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading={`Where StoreRx found it (${data.items.length})`}>
        {data.suggestionKind && (
          <s-paragraph color="subdued">
            StoreRx can draft copy for each of these. Review it, then paste it into Shopify
            yourself — nothing is changed for you.
          </s-paragraph>
        )}
        <s-stack direction="block" gap="large-100">
          {data.items.map((item) => (
            <s-box key={item.id} padding="base" background="subdued" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="small" alignItems="center">
                  {item.imageUrl && (
                    <s-thumbnail src={item.imageUrl} alt={item.title} size="base" />
                  )}
                  <s-stack direction="block" gap="small-500">
                    {item.pageUrl ? (
                      <s-link href={item.pageUrl} target="_blank">
                        {item.title}
                      </s-link>
                    ) : (
                      <s-text type="strong">{item.title}</s-text>
                    )}
                    {item.evidenceValue && (
                      <s-text color="subdued">{item.evidenceValue}</s-text>
                    )}
                  </s-stack>
                </s-stack>

                {data.suggestionKind && item.draftTarget ? (
                  <SuggestedCopy
                    kind={data.suggestionKind}
                    draft={item.draft}
                    busy={busy}
                    disabledReason={
                      creditsSpent && item.draft.status === "none"
                        ? "You've used all your AI credits this month. They reset at the start of your next period."
                        : null
                    }
                    adminHref={item.adminHref}
                    onDraft={() => submit({ intent: "draft", issueId: item.id })}
                  />
                ) : (
                  item.adminHref &&
                  data.items.length > 1 && (
                    <s-button variant="tertiary" href={item.adminHref}>
                      Edit in Shopify Admin
                    </s-button>
                  )
                )}
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="When you've made the change">
        <s-stack direction="block" gap="small">
          <s-paragraph color="subdued">
            StoreRx only marks something solved once a scan confirms it, so your dashboard reflects
            your real storefront rather than what was intended.
          </s-paragraph>
          <s-stack direction="inline" gap="small" alignItems="center">
            {data.status === "open" && (
              <s-button variant="secondary" disabled={busy} onClick={() => submit({ intent: "markResolved" })}>
                Mark as resolved
              </s-button>
            )}
            {data.status === "awaiting_verification" && (
              <s-button variant="tertiary" disabled={busy} onClick={() => submit({ intent: "reopen" })}>
                Not done after all
              </s-button>
            )}
            {data.scope && (
              <s-button
                variant={data.status === "awaiting_verification" ? "primary" : "tertiary"}
                disabled={busy || data.scope.state !== null}
                loading={data.scope.state === "running"}
                onClick={() => submit({ intent: "rescan" })}
              >
                {data.scope.state ? `Scanning ${data.scope.label}…` : `Re-scan ${data.scope.label}`}
              </s-button>
            )}
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const notFound = error instanceof Response && error.status === 404;

  if (!notFound) return boundary.error(error);

  return (
    <s-page heading="Issue not found">
      <s-section>
        <EmptyState heading="StoreRx doesn't know about this issue" action={{ label: "Back to dashboard", to: "/app" }}>
          It may have been verified and cleared, or the scan that found it is no longer on record.
        </EmptyState>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
