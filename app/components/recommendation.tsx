/**
 * The recommendation panels on an issue detail page.
 *
 * Order is deliberate and the same for every issue type: what was detected,
 * the evidence for it, why it matters, the single best recommendation, then
 * how to carry it out. Drafted copy is offered only where Shopify actually
 * has a field to paste it into.
 */

import { useCallback, useEffect, useState } from "react";
import { SUGGESTION_LABELS } from "../remedies/actions";
import type { SuggestionKind } from "../remedies/types";

export function WhyItMatters({ text }: { text: string | null }) {
  return (
    <s-stack direction="block" gap="small-300">
      <s-heading>Why this matters</s-heading>
      <s-paragraph>
        {text ?? "StoreRx hasn't written an explanation for this yet. Re-scan this area to get one."}
      </s-paragraph>
    </s-stack>
  );
}

export function RecommendedSolution({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <s-stack direction="block" gap="small-300">
      <s-heading>Recommended solution</s-heading>
      <s-paragraph>{text}</s-paragraph>
    </s-stack>
  );
}

export function ImplementationSteps({
  steps,
  ownership,
}: {
  steps: string[];
  ownership: string;
}) {
  if (steps.length === 0) return null;
  return (
    <s-stack direction="block" gap="small-300">
      <s-heading>How to improve it</s-heading>
      <s-ordered-list>
        {steps.map((step) => (
          <s-list-item key={step}>{step}</s-list-item>
        ))}
      </s-ordered-list>
      <s-text color="subdued">{ownership}</s-text>
    </s-stack>
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
    <s-stack direction="block" gap="small-300">
      <s-heading>What StoreRx checked</s-heading>
      {evidenceValue && <s-paragraph color="subdued">{evidenceValue}</s-paragraph>}
      {pageUrl && (
        <s-link href={pageUrl} target="_blank">
          View the page
        </s-link>
      )}
    </s-stack>
  );
}

/**
 * Copy to clipboard, with an honest fallback. Clipboard access can be denied
 * inside the admin iframe, so a failure says so and leaves the text on screen
 * to select rather than silently doing nothing.
 */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
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
      <s-button variant="secondary" onClick={copy}>
        {state === "copied" ? "Copied" : label}
      </s-button>
      {state === "failed" && (
        <s-text color="subdued">Couldn&apos;t copy — select the text above instead.</s-text>
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

/**
 * Drafted copy for one resource. StoreRx writes the suggestion; the merchant
 * reviews it and pastes it into Shopify themselves, so "current" is always
 * shown next to it.
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
        <s-text color="subdued">Drafting {labels.noun}…</s-text>
      </s-stack>
    );
  }

  if (draft.status === "failed") {
    return (
      <s-stack direction="block" gap="small-300">
        <s-text color="subdued">
          {draft.error ?? `StoreRx couldn't draft ${labels.noun} for this one.`}
        </s-text>
        <s-button variant="secondary" disabled={busy} onClick={onDraft}>
          Try again
        </s-button>
      </s-stack>
    );
  }

  if (draft.status === "ready" && draft.suggested) {
    return (
      <s-stack direction="block" gap="small">
        <s-stack direction="block" gap="small-500">
          <s-text color="subdued">Currently</s-text>
          <s-text>{draft.current?.trim() || "— empty —"}</s-text>
        </s-stack>

        <s-stack direction="block" gap="small-500">
          <s-text color="subdued">{labels.heading}</s-text>
          <s-box padding="small" background="subdued" borderRadius="base">
            <s-text>{draft.suggested}</s-text>
          </s-box>
        </s-stack>

        <s-stack direction="inline" gap="small" alignItems="center">
          <CopyButton value={draft.suggested} label={`Copy ${labels.noun}`} />
          {adminHref && (
            <s-button variant="tertiary" href={adminHref}>
              Edit in Shopify Admin
            </s-button>
          )}
          <s-button variant="tertiary" disabled={busy} onClick={onDraft}>
            {labels.redraft}
          </s-button>
        </s-stack>
      </s-stack>
    );
  }

  if (disabledReason) {
    return (
      <s-stack direction="block" gap="small-500">
        <s-button disabled>{labels.draft}</s-button>
        <s-text color="subdued">{disabledReason}</s-text>
      </s-stack>
    );
  }

  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-button variant="secondary" disabled={busy} onClick={onDraft}>
        {labels.draft}
      </s-button>
      <s-text color="subdued">Uses 1 AI credit. You review it before anything changes.</s-text>
    </s-stack>
  );
}
