/**
 * StoreRx Scoring Module
 *
 * Scoring = 100 - Σ(severity weight × issue count), capped per category.
 * Severity weights: high = 10, medium = 5, low = 2.
 */

import type { Finding, Severity, PageType } from "../rules/types";
import { SEVERITY_WEIGHTS } from "../rules/types";

export type ScoreCategory = "conversion" | "ux" | "performance" | "seo" | "productPages";

export interface CategoryScore {
  category: ScoreCategory;
  score: number; // 0-100
  issueCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
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
 * Calculate score for a single category based on findings
 */
function calculateCategoryScore(findings: Finding[]): CategoryScore {
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
  };
}

/**
 * Calculate full store health score from all findings
 */
export function calculateStoreHealth(findings: Finding[]): StoreHealthScore {
  // Group findings by category
  const byCategory: Record<ScoreCategory, Finding[]> = {
    conversion: [],
    ux: [],
    performance: [],
    seo: [],
    productPages: [],
  };

  for (const finding of findings) {
    const category = PAGE_TO_CATEGORY[finding.page];
    byCategory[category].push(finding);
  }

  // Calculate each category score
  const categories: CategoryScore[] = Object.entries(byCategory).map(([cat, catFindings]) => {
    const score = calculateCategoryScore(catFindings);
    score.category = cat as ScoreCategory;
    return score;
  });

  // Calculate weighted overall score
  let overall = 0;
  for (const cat of categories) {
    overall += cat.score * CATEGORY_WEIGHTS[cat.category];
  }

  const highPriorityCount = findings.filter(f => f.severity === "high").length;

  return {
    overall: Math.round(overall),
    categories,
    totalIssues: findings.length,
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
export function calculateScore(findings: Finding[]): number {
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHTS[f.severity], 0);
  return Math.max(0, Math.round(100 - Math.min(penalty, 100)));
}
