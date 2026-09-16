/**
 * StoreRx Scoring Module
 *
 * Scoring = 100 - Σ(severity weight × issue count), capped per category.
 * Severity weights: high = 10, medium = 5, low = 2.
 */

import type { PageType, Severity } from "../rules/types";
import { SEVERITY_WEIGHTS } from "../rules/types";

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
   * False when the category has no measurement behind it — e.g. Lighthouse
   * failed. Unmeasured categories are excluded from `overall` rather than
   * counted as zero, which would report a store as worse than observed.
   */
  measured: boolean;
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
  };
}

export interface StoreHealthOptions {
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
  const categories: CategoryScore[] = Object.entries(byCategory).map(([cat, catFindings]) => {
    const score = calculateCategoryScore(catFindings);
    score.category = cat as ScoreCategory;
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
