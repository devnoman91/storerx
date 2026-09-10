/**
 * StoreRx Rule Engine
 * Aggregates all rules and provides execution functions
 */

import type { Rule, RuleContext, Finding, PageType } from "./types";
import { homepageRules } from "./homepage";
import { collectionRules } from "./collection";
import { productRules } from "./product";
import { cartRules } from "./cart";
import { checkoutRules } from "./checkout";
import { imageRules } from "./images";
import { perfRules } from "./perf";

// Export all rules
export const allRules: Rule[] = [
  ...homepageRules,
  ...collectionRules,
  ...productRules,
  ...cartRules,
  ...checkoutRules,
  ...imageRules,
  ...perfRules,
];

// Get rules by page type
export function getRulesForPage(page: PageType): Rule[] {
  return allRules.filter((rule) => {
    if (Array.isArray(rule.page)) {
      return rule.page.includes(page);
    }
    return rule.page === page;
  });
}

// Run all rules for a given page context
export function runRules(page: PageType, ctx: RuleContext): Finding[] {
  const rules = getRulesForPage(page);
  const findings: Finding[] = [];

  for (const rule of rules) {
    try {
      const finding = rule.check(ctx);
      if (finding) {
        findings.push(finding);
      }
    } catch (error) {
      console.error(`Rule ${rule.id} failed:`, error);
    }
  }

  return findings;
}

// Run rules and return summary
export interface RuleSummary {
  page: PageType;
  findings: Finding[];
  highCount: number;
  mediumCount: number;
  lowCount: number;
  totalIssues: number;
  passedRules: number;
  totalRules: number;
}

export function runRulesWithSummary(page: PageType, ctx: RuleContext): RuleSummary {
  const rules = getRulesForPage(page);
  const findings = runRules(page, ctx);

  return {
    page,
    findings,
    highCount: findings.filter((f) => f.severity === "high").length,
    mediumCount: findings.filter((f) => f.severity === "medium").length,
    lowCount: findings.filter((f) => f.severity === "low").length,
    totalIssues: findings.length,
    passedRules: rules.length - findings.length,
    totalRules: rules.length,
  };
}

// Export individual rule sets for testing
export { homepageRules } from "./homepage";
export { collectionRules } from "./collection";
export { productRules } from "./product";
export { cartRules } from "./cart";
export { checkoutRules } from "./checkout";
export { imageRules, checkProductImages, checkDuplicateImages } from "./images";
export { perfRules } from "./perf";

// Re-export types
export * from "./types";
