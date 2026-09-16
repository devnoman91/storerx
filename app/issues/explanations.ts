/**
 * Decide which rules need a fresh AI explanation and which can reuse one.
 *
 * Explanations are written per rule for a given store, so an issue that is
 * still open on the next scan does not need explaining again. A cached entry is
 * only reused while its context matches: a new prompt version or a changed
 * brand voice produces different wording, so those invalidate the cache.
 */

import { createHash } from "node:crypto";

export interface Explanation {
  /** Why this costs the store sales. */
  explanation: string;
  /** The single best recommended solution. */
  recommendation: string;
  /** Ordered actions the merchant performs themselves. */
  steps: string[];
}

export interface CachedExplanation extends Explanation {
  ruleId: string;
  contextHash: string;
}

export function explanationContextHash(context: {
  promptVersion: string;
  shopName: string;
  brandVoice: string | null | undefined;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([context.promptVersion, context.shopName, context.brandVoice ?? ""]))
    .digest("hex");
}

export function partitionByCache(
  ruleIds: Iterable<string>,
  cached: readonly CachedExplanation[],
  contextHash: string,
): { hits: Map<string, Explanation>; misses: string[] } {
  const byRule = new Map(cached.map((entry) => [entry.ruleId, entry]));
  const hits = new Map<string, Explanation>();
  const misses: string[] = [];

  for (const ruleId of new Set(ruleIds)) {
    const entry = byRule.get(ruleId);
    if (entry && entry.contextHash === contextHash) {
      hits.set(ruleId, {
        explanation: entry.explanation,
        recommendation: entry.recommendation,
        steps: entry.steps,
      });
    } else {
      misses.push(ruleId);
    }
  }
  return { hits, misses };
}
