/**
 * The issue card and its parts.
 *
 * Reading order is fixed everywhere StoreRx shows an issue: how much it costs,
 * what it is, where it is, why it matters, then what the merchant can do about
 * it. Actions come from `actionsFor()`, so a card never offers a generic "fix"
 * — and never implies StoreRx will make the change.
 */

import type { ReactNode } from "react";
import { type IssueStatus } from "../remedies/actions";
import { remedyToken, severityToken } from "./tokens";
import { ShowMore } from "./primitives";

export function ImpactBadge({ severity }: { severity: string }) {
  const token = severityToken(severity);
  return (
    <s-badge tone={token.tone} icon={token.icon}>
      {token.label}
    </s-badge>
  );
}

/** Says which surface the merchant works in — the fastest signal on a card. */
export function RemedyChip({ remedy }: { remedy: string }) {
  const token = remedyToken(remedy);
  return (
    <s-badge tone="neutral" icon={token.icon}>
      {token.label}
    </s-badge>
  );
}

export function IssueStatusBadge({
  status,
  verificationFailed,
}: {
  status: IssueStatus;
  verificationFailed?: boolean;
}) {
  if (status === "resolved") {
    return (
      <s-badge tone="success" icon="check-circle">
        Verified
      </s-badge>
    );
  }
  if (status === "awaiting_verification") {
    return (
      <s-badge tone="info" icon="clock">
        Awaiting verification
      </s-badge>
    );
  }
  if (verificationFailed) {
    return (
      <s-badge tone="warning" icon="alert-triangle">
        Still found
      </s-badge>
    );
  }
  return null;
}

/** Storefront path, so a repeated issue shows which page it is on. */
export function pagePath(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

export interface PrescriptionView {
  /** Rule ID — the prescription's stable identity and its detail URL. */
  ruleId: string;
  title: string;
  severity: string;
  remedy: string;
  status: IssueStatus;
  isNew: boolean;
  verificationFailed: boolean;
  /** One line of why it matters, for the card. */
  explanation: string | null;
  /** "Across 8 products" / "On 3 pages" / a single path. */
  subtitle: string | null;
  /** Whether StoreRx can draft the copy this issue needs — said, not offered:
   *  the drafting happens on the detail page. */
  canDraft: boolean;
  secondary: { label: string; href?: string; unavailable?: string } | null;
  count: number;
}

export function issueHref(ruleId: string): string {
  return `/app/issues/${encodeURIComponent(ruleId)}`;
}

/**
 * One prescription.
 *
 * The severity icon leads so a merchant can scan a column of these and find
 * what matters without reading a word — which is also why the title is the
 * link and the only button is the external destination. A per-row button whose
 * label changed with the remedy ("View recommendation", "See suggested alt
 * text") made the button column itself unreadable.
 */
export function IssueCard({ issue }: { issue: PrescriptionView }) {
  const severity = severityToken(issue.severity);
  const remedy = remedyToken(issue.remedy);

  return (
    <s-box padding="base" borderRadius="base" background="subdued">
      <s-stack direction="inline" gap="base" alignItems="start">
        <s-box paddingBlockStart="small-500">
          <s-icon type={severity.icon} tone={severity.tone} size="base" />
        </s-box>

        <s-stack direction="block" gap="small">
          <s-stack
            direction="inline"
            gap="small"
            alignItems="start"
            justifyContent="space-between"
          >
            <s-stack direction="block" gap="small-500">
              <s-link href={issueHref(issue.ruleId)}>{issue.title}</s-link>
              <s-text color="subdued">
                {[issue.subtitle, remedy.label, issue.canDraft ? "copy can be drafted" : null]
                  .filter(Boolean)
                  .join(" · ")}
              </s-text>
            </s-stack>
            <s-stack direction="inline" gap="small-300" alignItems="center">
              {issue.isNew && <s-badge tone="info">New</s-badge>}
              <IssueStatusBadge
                status={issue.status}
                verificationFailed={issue.verificationFailed}
              />
              <s-badge tone={severity.tone}>{severity.label}</s-badge>
            </s-stack>
          </s-stack>

          {issue.explanation && (
            <s-paragraph color="subdued" lineClamp={2}>
              {issue.explanation}
            </s-paragraph>
          )}

          {issue.verificationFailed && (
            <s-text color="subdued">
              You marked this done, but the last scan found it again.
            </s-text>
          )}

          {/* One action, and it means the same thing on every row: go where
              the work is done. Everything else is on the detail page. */}
          {issue.secondary?.href && (
            <s-button variant="tertiary" icon="external" href={issue.secondary.href}>
              {issue.secondary.label}
            </s-button>
          )}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

/**
 * A severity band of issues. Long lists collapse after the first few so a
 * store with forty issues still has a readable dashboard.
 */
export function IssueGroup({
  heading,
  intro,
  issues,
  action,
}: {
  heading: string;
  intro?: ReactNode;
  issues: PrescriptionView[];
  /** One action for the whole band, e.g. the scan that would verify all of it. */
  action?: ReactNode;
}) {
  if (issues.length === 0) return null;

  return (
    <s-section heading={`${heading} (${issues.length})`}>
      {intro && <s-paragraph color="subdued">{intro}</s-paragraph>}
      {action}
      <ShowMore
        items={issues}
        initial={4}
        moreLabel={(n) => `Show ${n} more`}
        render={(issue) => <IssueCard key={issue.ruleId} issue={issue} />}
      />
    </s-section>
  );
}
