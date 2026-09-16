/**
 * Shared pieces of the issue experience.
 *
 * The visual hierarchy is fixed across every screen: impact first, then what
 * was detected, then where it is, then what the merchant can do about it.
 * Nothing here offers to change the store — the actions either open a
 * recommendation or send the merchant to the place they make the change.
 */

import { Link } from "react-router";
import type { RemedyKind } from "../remedies/types";
import { REMEDY_LABELS, type IssueStatus } from "../remedies/actions";
import type { Severity } from "../rules/types";

export const IMPACT: Record<Severity, { tone: "critical" | "warning" | "info"; label: string }> = {
  high: { tone: "critical", label: "High impact" },
  medium: { tone: "warning", label: "Medium impact" },
  low: { tone: "info", label: "Low impact" },
};

export function impactOf(severity: string) {
  return IMPACT[severity as Severity] ?? IMPACT.low;
}

export function ImpactBadge({ severity }: { severity: string }) {
  const impact = impactOf(severity);
  return <s-badge tone={impact.tone}>{impact.label}</s-badge>;
}

/** Says which surface the merchant works in, so the card is scannable. */
export function RemedyChip({ remedy }: { remedy: string }) {
  return <s-badge tone="neutral">{REMEDY_LABELS[remedy as RemedyKind] ?? "Advice"}</s-badge>;
}

export function IssueStatusBadge({
  status,
  verificationFailed,
}: {
  status: IssueStatus;
  verificationFailed?: boolean;
}) {
  if (status === "resolved") return <s-badge tone="success">Verified</s-badge>;
  if (status === "awaiting_verification") {
    return <s-badge tone="info">Verified on next scan</s-badge>;
  }
  if (verificationFailed) return <s-badge tone="warning">Still found</s-badge>;
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
  primaryLabel: string;
  secondary: { label: string; href?: string; unavailable?: string } | null;
  count: number;
}

/**
 * One prescription. The whole card is the primary action — the buttons repeat
 * it explicitly so the available action is readable without hovering.
 */
export function IssueCard({ issue }: { issue: PrescriptionView }) {
  return (
    <s-box padding="base" borderWidth="base none none none" borderColor="base">
      <s-stack direction="block" gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <ImpactBadge severity={issue.severity} />
          <RemedyChip remedy={issue.remedy} />
          {issue.isNew && <s-badge tone="info">New</s-badge>}
          <IssueStatusBadge status={issue.status} verificationFailed={issue.verificationFailed} />
        </s-stack>

        <s-stack direction="block" gap="small-500">
          <s-text type="strong">{issue.title}</s-text>
          {issue.subtitle && <s-text color="subdued">{issue.subtitle}</s-text>}
        </s-stack>

        {issue.explanation && <s-paragraph color="subdued">{issue.explanation}</s-paragraph>}

        {issue.verificationFailed && (
          <s-text color="subdued">
            You marked this fixed, but the last scan found it again.
          </s-text>
        )}

        <s-stack direction="inline" gap="small" alignItems="center">
          <s-button variant="secondary" href={`/app/issues/${encodeURIComponent(issue.ruleId)}`}>
            {issue.primaryLabel}
          </s-button>
          {issue.secondary?.href && (
            <s-button variant="tertiary" href={issue.secondary.href}>
              {issue.secondary.label}
            </s-button>
          )}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export function IssueGroup({
  heading,
  issues,
  tone,
}: {
  heading: string;
  issues: PrescriptionView[];
  tone?: "critical" | "warning" | "neutral";
}) {
  if (issues.length === 0) return null;

  return (
    <s-section heading={`${heading} (${issues.length})`}>
      {tone === "critical" && (
        <s-paragraph color="subdued">
          These cost you the most sales. Start here.
        </s-paragraph>
      )}
      <s-box borderWidth="none" borderRadius="base">
        {issues.map((issue) => (
          <IssueCard key={issue.ruleId} issue={issue} />
        ))}
      </s-box>
    </s-section>
  );
}

/** Shared empty state, so "nothing here" always reads the same way. */
export function EmptyState({
  heading,
  children,
  action,
}: {
  heading: string;
  children?: React.ReactNode;
  action?: { label: string; to: string };
}) {
  return (
    <s-box padding="large-200" background="subdued" borderRadius="base">
      <s-stack direction="block" gap="small" alignItems="center">
        <s-heading>{heading}</s-heading>
        {children && <s-paragraph color="subdued">{children}</s-paragraph>}
        {action && (
          <Link to={action.to}>
            <s-text color="base">{action.label}</s-text>
          </Link>
        )}
      </s-stack>
    </s-box>
  );
}
