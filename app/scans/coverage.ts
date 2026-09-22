/**
 * How much of a store has been checked, and what to check next.
 *
 * Pure, so the dashboard's most visible numbers — "2 of 9 areas checked",
 * "Check 6 of the 7 remaining areas" — are tested rather than assembled inline
 * in a loader where an ordering mistake only shows up at runtime.
 */

import { SCAN_SCOPES, SCAN_SCOPE_ORDER, scopeForRule, type ScanScope } from "./scopes";

export interface CoverageInput {
  /** Areas with at least one completed scan. */
  scanned: Iterable<string>;
  /** Areas with a scan queued or running; they need no second one. */
  inFlight?: Iterable<string>;
  /** Scans left in the plan's period, or null when the plan is unlimited. */
  scansLeft: number | null;
}

export interface Coverage {
  checked: number;
  total: number;
  /** The area to check next, or null when every area has been checked. */
  next: { scope: ScanScope; label: string; description: string } | null;
  /** Areas never checked and not already queued. */
  remaining: number;
  scansLeft: number | null;
  /** How many of those the plan allows queueing right now. */
  canQueue: number;
}

/**
 * The areas that would verify a set of rules: one scan each, in the order
 * StoreRx offers them, skipping any area already queued or running.
 *
 * Marking issues done is per issue, but confirming them is per area — eight
 * awaiting issues spread over two areas cost two scans, not eight.
 */
export function verificationScopes(
  ruleIds: Iterable<string>,
  inFlight: Iterable<string> = [],
): ScanScope[] {
  const busy = new Set(inFlight);
  const wanted = new Set<ScanScope>();
  for (const ruleId of ruleIds) {
    const scope = scopeForRule(ruleId);
    if (scope && !busy.has(scope)) wanted.add(scope);
  }
  return SCAN_SCOPE_ORDER.filter((scope) => wanted.has(scope));
}

export function scanCoverage({ scanned, inFlight = [], scansLeft }: CoverageInput): Coverage {
  const done = new Set(scanned);
  const busy = new Set(inFlight);

  const unchecked = SCAN_SCOPE_ORDER.filter((scope) => !done.has(scope));
  // SCAN_SCOPE_ORDER is the order StoreRx recommends, so "next" is simply the
  // first area nothing has checked — no invented priority.
  const queueable = unchecked.filter((scope) => !busy.has(scope));
  const next = queueable[0];

  return {
    checked: SCAN_SCOPE_ORDER.length - unchecked.length,
    total: SCAN_SCOPE_ORDER.length,
    next: next
      ? { scope: next, label: SCAN_SCOPES[next].label, description: SCAN_SCOPES[next].description }
      : null,
    remaining: queueable.length,
    scansLeft,
    canQueue: scansLeft === null ? queueable.length : Math.min(queueable.length, scansLeft),
  };
}
