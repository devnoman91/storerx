/**
 * Stable identity for an issue across scans.
 *
 * A fingerprint is built from the rule and *where* it fired — the page path,
 * or the product/image the rule targets. It deliberately excludes titles,
 * severity and evidence, because those carry measured values ("Image file is
 * 1.7 MB", "Performance score is 34/100") that change from scan to scan while
 * the underlying problem stays the same.
 */

import { createHash } from "node:crypto";

export interface IssueLocation {
  ruleId: string;
  pageUrl?: string | null;
  targetId?: string | null;
}

/**
 * Path only: the same page reached through a custom domain, a trailing slash
 * or a tracking query string is still the same page.
 */
export function normalizePath(pageUrl: string | null | undefined): string {
  if (!pageUrl) return "";
  let path: string;
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    path = pageUrl.split(/[?#]/)[0];
  }
  path = path.toLowerCase().replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

export function fingerprint(location: IssueLocation): string {
  const scope = location.targetId || normalizePath(location.pageUrl) || "store";
  return createHash("sha1").update(`${location.ruleId}|${scope}`).digest("hex");
}
