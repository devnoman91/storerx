/**
 * Plan usage, shown the same way on the dashboard and the billing page.
 *
 * Both screens answer the same question — how much of my plan is left — so
 * they share one component rather than drifting into two wordings of it.
 */

import { UsageBar } from "./primitives";

export type UsageCount = { used: number; limit: number | null };

export function usageText({ used, limit }: UsageCount): string {
  return limit === null ? `${used} used · unlimited` : `${used} of ${limit} used`;
}

export function UsageRow({
  label,
  count,
  hint,
}: {
  label: string;
  count: UsageCount;
  hint?: string;
}) {
  const spent = count.limit !== null && count.used >= count.limit;

  return (
    <s-stack direction="block" gap="small-500">
      <s-stack direction="inline" gap="small-300" alignItems="center" justifyContent="space-between">
        <s-text>{label}</s-text>
        <s-text
          color="subdued"
          tone={spent ? "critical" : undefined}
          fontVariantNumeric="tabular-nums"
        >
          {usageText(count)}
        </s-text>
      </s-stack>
      {count.limit !== null && <UsageBar used={count.used} limit={count.limit} />}
      {hint && <s-text color="subdued">{hint}</s-text>}
    </s-stack>
  );
}

/** What each allowance covers, wherever usage is shown. */
export const EXPLANATION_HINT =
  "Written once per issue and reused, so re-scanning an area costs nothing.";

export const DRAFT_HINT = "Alt text, SEO titles and descriptions you ask StoreRx to write.";
