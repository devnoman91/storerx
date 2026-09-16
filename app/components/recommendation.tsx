/**
 * The diagnosis panels on an issue detail page.
 *
 * The order is deliberate and identical for every issue: what was found, the
 * evidence for it, why it matters, the recommended treatment, then how to
 * carry it out. Drafted copy appears only where Shopify has a field to paste
 * it into, and always beside the value it would replace.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { SUGGESTION_LABELS } from "../remedies/actions";
import type { SuggestionKind } from "../remedies/types";
import { Callout } from "./primitives";
import type { IconName, Tone } from "./tokens";

/** A titled block in the diagnosis. Keeps every panel on the same rhythm. */
export function Panel({
  icon,
  title,
  tone = "neutral",
  children,
}: {
  icon: IconName;
  title: string;
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <s-stack direction="block" gap="small">
      <s-stack direction="inline" gap="small-300" alignItems="center">
        <s-icon type={icon} tone={tone} size="small" />
        <s-heading>{title}</s-heading>
      </s-stack>
      {children}
    </s-stack>
  );
}

export function WhyItMatters({ text }: { text: string | null }) {
  return (
    <Panel icon="info" title="Why this matters">
      <s-paragraph>
        {text ??
          "StoreRx hasn't written an explanation for this yet. Re-scan this area to get one."}
      </s-paragraph>
    </Panel>
  );
}

export function RecommendedSolution({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <Panel icon="wand" title="Recommended treatment" tone="info">
      <s-paragraph>{text}</s-paragraph>
    </Panel>
  );
}

export function ImplementationSteps({
  steps,
  ownership,
  verifyNote,
}: {
  steps: string[];
  ownership: string;
  verifyNote?: string;
}) {
  if (steps.length === 0) return null;
  return (
    <Panel icon="list-numbered" title="How to implement">
      <s-ordered-list>
        {steps.map((step) => (
          <s-list-item key={step}>{step}</s-list-item>
        ))}
      </s-ordered-list>
      <Callout icon="shield-check-mark">
        {ownership}
        {verifyNote ? ` ${verifyNote}` : ""}
      </Callout>
    </Panel>
  );
}

export function EvidencePanel({
  evidenceValue,
  pageUrl,
}: {
  evidenceValue: string | null;
  pageUrl: string | null;
}) {
  if (!evidenceValue && !pageUrl) return null;
  return (
    <Panel icon="search" title="Evidence">
      {evidenceValue && (
        <s-box padding="small" background="subdued" borderRadius="base">
          <s-text color="subdued">{evidenceValue}</s-text>
        </s-box>
      )}
      {pageUrl && (
        <s-link href={pageUrl} target="_blank">
          See it on your storefront
        </s-link>
      )}
    </Panel>
  );
}

/**
 * Copy to clipboard, with an honest fallback. Clipboard access can be denied
 * inside the admin iframe, so a failure says so and leaves the text on screen
 * to select rather than silently doing nothing.
 */
export function CopyButton({
  value,
  label = "Copy",
  variant = "secondary",
}: {
  value: string;
  label?: string;
  variant?: "primary" | "secondary" | "tertiary";
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = useCallback(() => {
    navigator.clipboard?.writeText(value).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  }, [value]);

  return (
    <s-stack direction="inline" gap="small-300" alignItems="center">
      <s-button
        variant={variant}
        icon={state === "copied" ? "check" : "clipboard"}
        onClick={copy}
      >
        {state === "copied" ? "Copied" : label}
      </s-button>
      {state === "failed" && (
        <s-text color="subdued">Couldn&apos;t copy — select the text and copy it.</s-text>
      )}
    </s-stack>
  );
}

export type DraftStatus = "none" | "pending" | "ready" | "failed";

export interface DraftView {
  status: DraftStatus;
  current: string | null;
  suggested: string | null;
  error: string | null;
}

/** Current value beside the suggested one, so the change is obvious at a glance. */
function Comparison({
  current,
  suggested,
  heading,
}: {
  current: string | null;
  suggested: string;
  heading: string;
}) {
  return (
    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="small">
      <s-stack direction="block" gap="small-500">
        <s-stack direction="inline" gap="small-300" alignItems="center">
          <s-icon type="minus-circle" tone="neutral" size="small" />
          <s-text color="subdued">Currently</s-text>
        </s-stack>
        <s-box padding="small" background="subdued" borderRadius="base">
          <s-text color="subdued">{current?.trim() || "— empty —"}</s-text>
        </s-box>
      </s-stack>

      <s-stack direction="block" gap="small-500">
        <s-stack direction="inline" gap="small-300" alignItems="center">
          <s-icon type="wand" tone="info" size="small" />
          <s-text color="subdued">{heading}</s-text>
        </s-stack>
        <s-box padding="small" background="subdued" borderRadius="base">
          <s-text>{suggested}</s-text>
        </s-box>
      </s-stack>
    </s-grid>
  );
}

/**
 * Drafted copy for one resource. StoreRx writes the suggestion; the merchant
 * reviews it and pastes it into Shopify themselves. The credit cost is stated
 * before the button is pressed, never after.
 */
export function SuggestedCopy({
  kind,
  draft,
  onDraft,
  busy,
  disabledReason,
  adminHref,
}: {
  kind: SuggestionKind;
  draft: DraftView;
  onDraft: () => void;
  busy: boolean;
  /** Why drafting is unavailable, e.g. no AI credits left. */
  disabledReason?: string | null;
  adminHref?: string | null;
}) {
  const labels = SUGGESTION_LABELS[kind];

  if (draft.status === "pending") {
    return (
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-spinner size="base" accessibilityLabel={`Drafting ${labels.noun}`} />
        <s-text color="subdued">Writing {labels.noun}…</s-text>
      </s-stack>
    );
  }

  if (draft.status === "failed") {
    return (
      <s-stack direction="block" gap="small-300">
        <s-stack direction="inline" gap="small-300" alignItems="center">
          <s-icon type="alert-circle" tone="warning" size="small" />
          <s-text color="subdued">
            {draft.error ?? `StoreRx couldn't draft ${labels.noun} for this one.`}
          </s-text>
        </s-stack>
        <s-button variant="secondary" icon="refresh" disabled={busy} onClick={onDraft}>
          Try again
        </s-button>
      </s-stack>
    );
  }

  if (draft.status === "ready" && draft.suggested) {
    return (
      <s-stack direction="block" gap="small">
        <Comparison current={draft.current} suggested={draft.suggested} heading={labels.heading} />
        <s-stack direction="inline" gap="small-300" alignItems="center">
          <CopyButton value={draft.suggested} label={`Copy ${labels.noun}`} />
          {adminHref && (
            <s-button variant="primary" icon="external" href={adminHref}>
              Edit in Shopify Admin
            </s-button>
          )}
          <s-button variant="tertiary" icon="refresh" disabled={busy} onClick={onDraft}>
            {labels.redraft}
          </s-button>
        </s-stack>
      </s-stack>
    );
  }

  if (disabledReason) {
    return (
      <s-stack direction="block" gap="small-500">
        <s-button icon="wand" disabled>
          {labels.draft}
        </s-button>
        <s-text color="subdued">{disabledReason}</s-text>
      </s-stack>
    );
  }

  return (
    <s-stack direction="inline" gap="small-300" alignItems="center">
      <s-button variant="secondary" icon="wand" disabled={busy} onClick={onDraft}>
        {labels.draft}
      </s-button>
      <s-text color="subdued">Uses 1 AI credit. You review it before anything changes.</s-text>
    </s-stack>
  );
}
