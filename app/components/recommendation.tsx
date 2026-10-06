/**
 * The diagnosis panels on an issue detail page.
 *
 * The order is deliberate and identical for every issue: what was found, the
 * evidence for it, why it matters, the recommended treatment, then how to
 * carry it out. Drafted copy appears only where Shopify has a field for it,
 * and always beside the value it would replace.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { SUGGESTION_LABELS } from "../remedies/actions";
import type { SuggestionKind } from "../remedies/types";
import { parseFaq, type FaqEntry } from "../suggestions/faq";
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
  /** When the merchant approved this draft and StoreRx wrote it to the store. */
  appliedAt: string | null;
}

/** Applying an approved draft to the store, where Shopify has a field for it. */
export interface ApplyControls {
  /** Whether the store has allowed StoreRx to make changes. */
  granted: boolean;
  onAllow: () => void;
  onApply: () => void;
  onUndo: () => void;
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
 * A drafted FAQ, entry by entry. Themes hold FAQs as one collapsible block per
 * question, so each question and answer gets its own copy buttons.
 */
function FaqComparison({ entries }: { entries: FaqEntry[] }) {
  return (
    <s-stack direction="block" gap="small">
      <s-paragraph color="subdued">
        Keep the questions you want, then paste each one into a collapsible content block on your
        product template in the theme editor — or add them to the product description.
      </s-paragraph>
      {entries.map((entry, index) => (
        <s-box key={index} padding="small" background="subdued" borderRadius="base">
          <s-stack direction="block" gap="small-300">
            <s-text type="strong">{entry.question}</s-text>
            <s-text>{entry.answer}</s-text>
            <s-stack direction="inline" gap="small-300">
              <CopyButton value={entry.question} label="Copy question" variant="tertiary" />
              <CopyButton value={entry.answer} label="Copy answer" variant="tertiary" />
            </s-stack>
          </s-stack>
        </s-box>
      ))}
    </s-stack>
  );
}

/**
 * Drafted copy for one resource. StoreRx writes the suggestion and the
 * merchant reviews it. Nothing reaches the store unless they approve that one
 * draft — or paste it in themselves. The credit cost is stated before the
 * button is pressed, never after.
 */
export function SuggestedCopy({
  kind,
  draft,
  onDraft,
  busy,
  disabledReason,
  adminHref,
  apply,
}: {
  kind: SuggestionKind;
  draft: DraftView;
  onDraft: () => void;
  busy: boolean;
  /** Why drafting is unavailable, e.g. no AI credits left. */
  disabledReason?: string | null;
  adminHref?: string | null;
  /** Null where the draft has no field StoreRx can write to. */
  apply?: ApplyControls | null;
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
    const faq = kind === "faq" ? parseFaq(draft.suggested) : null;
    return (
      <s-stack direction="block" gap="small">
        {faq ? (
          <FaqComparison entries={faq} />
        ) : (
          <Comparison current={draft.current} suggested={draft.suggested} heading={labels.heading} />
        )}
        {apply && draft.appliedAt && (
          <s-stack direction="inline" gap="small-300" alignItems="center">
            <s-icon type="check-circle" tone="success" size="small" />
            <s-text color="subdued">
              You approved this and StoreRx put it in your store on {draft.appliedAt}. The next
              scan will verify it.
            </s-text>
          </s-stack>
        )}
        <s-stack direction="inline" gap="small-300" alignItems="center">
          {apply && draft.appliedAt ? (
            <s-button variant="secondary" icon="undo" disabled={busy} onClick={apply.onUndo}>
              Undo
            </s-button>
          ) : (
            apply && (
              <s-button
                variant="primary"
                icon="check"
                disabled={busy}
                onClick={apply.granted ? apply.onApply : apply.onAllow}
              >
                {apply.granted ? "Approve and apply" : "Allow StoreRx to apply this"}
              </s-button>
            )
          )}
          {!faq && <CopyButton value={draft.suggested} label={`Copy ${labels.noun}`} />}
          {adminHref && (
            <s-button variant={apply ? "tertiary" : "primary"} icon="external" href={adminHref}>
              Edit in Shopify Admin
            </s-button>
          )}
          {!draft.appliedAt && (
            <s-button variant="tertiary" icon="refresh" disabled={busy} onClick={onDraft}>
              {labels.redraft}
            </s-button>
          )}
        </s-stack>
        {apply && !apply.granted && !draft.appliedAt && (
          <s-text color="subdued">
            StoreRx can only read your store until you allow it to make changes. Shopify will ask
            you to confirm, once. After that, each draft is still applied only when you approve it.
          </s-text>
        )}
      </s-stack>
    );
  }

  // The credit cost is stated once above the list rather than on every row,
  // which on a five-product issue was five copies of the same sentence.
  return (
    <s-button
      variant="secondary"
      icon="wand"
      disabled={busy || Boolean(disabledReason)}
      onClick={onDraft}
    >
      {labels.draft}
    </s-button>
  );
}
