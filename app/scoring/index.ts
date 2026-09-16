/**
 * StoreRx Scoring Module
 *
 * Scoring = 100 - Σ(severity weight × issue count), capped per category.
 * Severity weights: high = 10, medium = 5, low = 2.
 */

import type { PageType, Severity } from "../rules/types";
import { SEVERITY_WEIGHTS } from "../rules/types";
import { allRules, CATALOG_IMAGE_RULE_IDS } from "../rules";
import { isCatalogRuleReachable, isRuleReachable } from "../scans/scopes";

/**
 * The only parts of a finding scoring uses. Lets the store score be computed
 * from the shop's open issue rows, not just from one scan's findings.
 */
export interface ScorableIssue {
  ruleId: string;
  severity: Severity;
  page: PageType | string;
}

export type ScoreCategory = "conversion" | "ux" | "performance" | "seo" | "productPages";

export interface CategoryScore {
  category: ScoreCategory;
  score: number; // 0-100
  issueCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  /**
   * False when the category has no measurement behind it — no scan has run
   * any of its checks, or Lighthouse failed. Unmeasured categories are
   * excluded from `overall` rather than counted as zero, which would report a
   * store as worse than observed. Scoring them 100 instead would be worse
   * still: it reports a category as perfect when nothing looked at it.
   */
  measured: boolean;
  /** Checks in this category that a scan has actually run, out of the total. */
  checksRun: number;
  checksTotal: number;
}

export interface StoreHealthScore {
  overall: number; // 0-100 weighted average
  categories: CategoryScore[];
  totalIssues: number;
  highPriorityCount: number;
}

// Category weights for overall score
const CATEGORY_WEIGHTS: Record<ScoreCategory, number> = {
  conversion: 0.30,
  ux: 0.20,
  performance: 0.20,
  seo: 0.15,
  productPages: 0.15,
};

// Map page types to categories
const PAGE_TO_CATEGORY: Record<PageType, ScoreCategory> = {
  homepage: "conversion",
  collection: "conversion",
  product: "productPages",
  cart: "conversion",
  checkout: "conversion",
  images: "seo",
  perf: "performance",
};

/**
 * Categories at least one page type feeds. A category no rule maps to cannot
 * be measured at all — scoring it 100 because nothing was found would invent
 * a result and, since the average is weighted, inflate every store's overall
 * score by that category's weight.
 */
const MEASURABLE: ReadonlySet<ScoreCategory> = new Set(Object.values(PAGE_TO_CATEGORY));

export function isMeasurableCategory(category: ScoreCategory): boolean {
  return MEASURABLE.has(category);
}

/**
 * Every rule that exists, and the category it reports into.
 *
 * Built from the rule set rather than maintained by hand, so a category can
 * never claim coverage from a rule that was deleted, or miss a new one. The
 * catalog image checks are plain functions rather than Rule objects, so they
 * are added explicitly.
 */
const RULE_CATEGORY: ReadonlyMap<string, ScoreCategory> = (() => {
  const map = new Map<string, ScoreCategory>();
  for (const rule of allRules) {
    const page = Array.isArray(rule.page) ? rule.page[0] : rule.page;
    // A rule no scan can reach must not count towards a category's total, or
    // its coverage could never read as complete.
    if (!isRuleReachable(rule.id, page)) continue;
    map.set(rule.id, PAGE_TO_CATEGORY[page]);
  }
  for (const ruleId of CATALOG_IMAGE_RULE_IDS) {
    if (!isCatalogRuleReachable(ruleId)) continue;
    map.set(ruleId, PAGE_TO_CATEGORY.images);
  }
  return map;
})();

/** Rules that exist but no scan can run. Asserted against in tests. */
export const UNREACHABLE_RULE_IDS: readonly string[] = allRules
  .map((rule) => ({ id: rule.id, page: Array.isArray(rule.page) ? rule.page[0] : rule.page }))
  .filter((rule) => !isRuleReachable(rule.id, rule.page))
  .map((rule) => rule.id);

/** How many checks a category has in total. */
export const CATEGORY_CHECK_COUNTS: Readonly<Record<ScoreCategory, number>> = (() => {
  const counts: Record<ScoreCategory, number> = {
    conversion: 0,
    ux: 0,
    performance: 0,
    seo: 0,
    productPages: 0,
  };
  for (const category of RULE_CATEGORY.values()) counts[category] += 1;
  return counts;
})();

/** Checks run per category, from the rule IDs a shop's scans have evaluated. */
export function categoryCoverage(
  evaluatedRules: Iterable<string>,
): Record<ScoreCategory, number> {
  const run: Record<ScoreCategory, number> = {
    conversion: 0,
    ux: 0,
    performance: 0,
    seo: 0,
    productPages: 0,
  };
  for (const ruleId of new Set(evaluatedRules)) {
    const category = RULE_CATEGORY.get(ruleId);
    if (category) run[category] += 1;
  }
  return run;
}

// Maximum penalty per category (prevents score from going below 0)
const MAX_CATEGORY_PENALTY = 100;

/**
 * Pages whose rules run once per catalog item rather than once per page. Only
 * used for wording ("40 images are missing alt text"); scoring treats every
 * rule the same way — see collapseByRule.
 */
const CATALOG_PAGES: ReadonlySet<string> = new Set<PageType>(["images"]);

export function isCatalogPage(page: string): boolean {
  return CATALOG_PAGES.has(page);
}

/**
 * One prescription per rule. A rule that fires on five product pages, or on
 * forty images, is one problem at scale — counting each occurrence made the
 * score punish stores for sampling more pages and saturated categories to 0.
 * Every occurrence is still stored and listed under its prescription.
 */
export function collapseByRule<T extends { ruleId: string }>(findings: T[]): T[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    if (seen.has(finding.ruleId)) return false;
    seen.add(finding.ruleId);
    return true;
  });
}

/**
 * Calculate score for a single category based on findings
 */
function calculateCategoryScore(findings: ScorableIssue[]): CategoryScore {
  const counts = { high: 0, medium: 0, low: 0 };

  for (const finding of findings) {
    counts[finding.severity]++;
  }

  const penalty =
    counts.high * SEVERITY_WEIGHTS.high +
    counts.medium * SEVERITY_WEIGHTS.medium +
    counts.low * SEVERITY_WEIGHTS.low;

  const cappedPenalty = Math.min(penalty, MAX_CATEGORY_PENALTY);
  const score = Math.max(0, 100 - cappedPenalty);

  return {
    category: "conversion", // Will be set by caller
    score: Math.round(score),
    issueCount: findings.length,
    highCount: counts.high,
    mediumCount: counts.medium,
    lowCount: counts.low,
    measured: true,
    checksRun: 0,
    checksTotal: 0,
  };
}

export interface StoreHealthOptions {
  /**
   * Rule IDs any scan of this shop has run to completion. A category none of
   * whose checks have run is reported as unmeasured — without this, a store
   * that has only had its SEO scanned is told its images score 100, which no
   * scan ever looked at.
   *
   * Omitted means "assume everything ran", which is only correct in tests.
   */
  evaluatedRules?: ReadonlySet<string>;
  /**
   * Measured Lighthouse score (mobile 70 / desktop 30). FEATURES.md §3 makes
   * Lighthouse the source for the Performance category, so when it is supplied
   * it replaces the findings-derived score — otherwise the overall score and
   * the Performance score shown next to it would disagree.
   *
   * `null` means Lighthouse did not run (API error, rate limit). The category
   * is then marked unmeasured and dropped from the weighted average.
   */
  performanceScore?: number | null;
}

/**
 * Calculate full store health score from all findings
 */
export function calculateStoreHealth(
  findings: ScorableIssue[],
  options: StoreHealthOptions = {},
): StoreHealthScore {
  // Group findings by category
  const byCategory: Record<ScoreCategory, ScorableIssue[]> = {
    conversion: [],
    ux: [],
    performance: [],
    seo: [],
    productPages: [],
  };

  const prescriptions = collapseByRule(findings);
  for (const finding of prescriptions) {
    const category = PAGE_TO_CATEGORY[finding.page as PageType] ?? "conversion";
    byCategory[category].push(finding);
  }

  // Calculate each category score
  const coverage = options.evaluatedRules
    ? categoryCoverage(options.evaluatedRules)
    : CATEGORY_CHECK_COUNTS;

  const categories: CategoryScore[] = Object.entries(byCategory).map(([cat, catFindings]) => {
    const score = calculateCategoryScore(catFindings);
    score.category = cat as ScoreCategory;
    score.checksRun = coverage[score.category];
    score.checksTotal = CATEGORY_CHECK_COUNTS[score.category];

    // No rule reports into this category, so there is nothing behind a score.
    if (!MEASURABLE.has(score.category)) {
      score.measured = false;
      score.score = 0;
      return score;
    }

    // No scan has run any of its checks. A score here would be invented.
    if (score.checksRun === 0) {
      score.measured = false;
      score.score = 0;
      return score;
    }
    // Keep the finding counts, but take the score itself from Lighthouse.
    if (score.category === "performance") {
      if (typeof options.performanceScore === "number") {
        score.score = Math.max(0, Math.min(100, Math.round(options.performanceScore)));
      } else if (options.performanceScore === null) {
        score.measured = false;
        score.score = 0;
      }
    }
    return score;
  });

  // Weighted average over measured categories only, renormalised so a missing
  // measurement neither inflates nor deflates the result.
  let weighted = 0;
  let totalWeight = 0;
  for (const cat of categories) {
    if (!cat.measured) continue;
    weighted += cat.score * CATEGORY_WEIGHTS[cat.category];
    totalWeight += CATEGORY_WEIGHTS[cat.category];
  }
  const overall = totalWeight > 0 ? weighted / totalWeight : 0;

  const highPriorityCount = prescriptions.filter(f => f.severity === "high").length;

  return {
    overall: Math.round(overall),
    categories,
    totalIssues: prescriptions.length,
    highPriorityCount,
  };
}

/**
 * Get score band for display
 */
export function getScoreBand(score: number): "critical" | "warning" | "success" {
  if (score < 50) return "critical";
  if (score < 80) return "warning";
  return "success";
}

/**
 * Simple score calculation from findings
 * Returns 0-100 based on severity weights
 */
export function calculateScore(findings: ScorableIssue[]): number {
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHTS[f.severity], 0);
  return Math.max(0, Math.round(100 - Math.min(penalty, 100)));
}
