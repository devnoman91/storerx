/**
 * Update a shop's current issue list from one scan.
 *
 * Scans can be partial — just the homepage, or just images — so the store's
 * state is not "whatever the latest scan found". Each scan only touches the
 * issues it actually re-checked:
 *
 *   - found now           → open (created, reopened, or still open)
 *   - not found, covered  → resolved
 *   - not found, not covered → untouched (a homepage scan says nothing about images)
 *
 * "Covered" is strict: the rule that reports the issue ran in this scan, and
 * for a storefront page rule, that exact page was fetched. A rule that crashed,
 * a PageSpeed call that was rate limited, or a product that was not sampled
 * again never turns an issue into "fixed".
 */

import { normalizePath } from "./identity";

export interface Coverage {
  /** Rule IDs that ran to completion in this scan. */
  evaluatedRules: ReadonlySet<string>;
  /** Normalized paths of storefront pages fetched in this scan. */
  scannedPaths: ReadonlySet<string>;
}

/** Page types whose rules are checked against one fetched storefront page. */
const STOREFRONT_PAGES: ReadonlySet<string> = new Set(["homepage", "collection", "product", "cart"]);

export interface Located {
  fingerprint: string;
  ruleId: string;
  page: string;
  pageUrl: string | null;
}

export function isCovered(issue: Located, coverage: Coverage): boolean {
  if (!coverage.evaluatedRules.has(issue.ruleId)) return false;
  if (STOREFRONT_PAGES.has(issue.page)) {
    return coverage.scannedPaths.has(normalizePath(issue.pageUrl));
  }
  return true;
}

export interface KnownIssue extends Located {
  id: string;
  status: "open" | "resolved";
}

export interface Reconciliation<I extends KnownIssue, F extends Located> {
  /** First time this problem was seen. `isNew` is false when its rule had never run before. */
  opened: Array<{ finding: F; isNew: boolean }>;
  /** Was resolved, is back. Always new. */
  reopened: Array<{ issue: I; finding: F }>;
  stillOpen: Array<{ issue: I; finding: F }>;
  resolved: I[];
  newCount: number;
  resolvedCount: number;
}

/**
 * @param previouslyEvaluatedRules rules that ran in any earlier scan of this
 *   shop. An issue from a rule that never ran before is part of that area's
 *   first look — a baseline — not "new".
 */
export function reconcile<I extends KnownIssue, F extends Located>(
  known: readonly I[],
  current: readonly F[],
  coverage: Coverage,
  previouslyEvaluatedRules: ReadonlySet<string>,
): Reconciliation<I, F> {
  const knownByKey = new Map(known.map((issue) => [issue.fingerprint, issue]));
  const currentKeys = new Set<string>();

  const opened: Reconciliation<I, F>["opened"] = [];
  const reopened: Reconciliation<I, F>["reopened"] = [];
  const stillOpen: Reconciliation<I, F>["stillOpen"] = [];

  for (const finding of current) {
    if (currentKeys.has(finding.fingerprint)) continue;
    currentKeys.add(finding.fingerprint);

    const issue = knownByKey.get(finding.fingerprint);
    if (!issue) {
      opened.push({ finding, isNew: previouslyEvaluatedRules.has(finding.ruleId) });
    } else if (issue.status === "resolved") {
      reopened.push({ issue, finding });
    } else {
      stillOpen.push({ issue, finding });
    }
  }

  const resolved = known.filter(
    (issue) =>
      issue.status === "open" && !currentKeys.has(issue.fingerprint) && isCovered(issue, coverage),
  );

  return {
    opened,
    reopened,
    stillOpen,
    resolved,
    newCount: opened.filter((entry) => entry.isNew).length + reopened.length,
    resolvedCount: resolved.length,
  };
}
