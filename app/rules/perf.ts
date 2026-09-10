/**
 * Performance rules (FEATURES.md §6)
 *
 * Input is measured Lighthouse/PageSpeed data, not HTML. Every number
 * reported in a finding is a measurement — thresholds come from Lighthouse's
 * own scoring bands, and impact is always High/Medium/Low, never a predicted
 * conversion delta.
 *
 * Rules skip silently when `ctx.lighthouse` is absent (PSI failed or was not
 * run for that page) so a missing measurement never reads as a passing one.
 */

import type { Rule, RuleContext, Finding, Severity, ThirdPartyScript } from "./types";

// Lighthouse scoring bands.
const SCORE_POOR = 50;
const SCORE_NEEDS_WORK = 90;
const LCP_NEEDS_WORK_S = 2.5;
const LCP_POOR_S = 4;
const CLS_NEEDS_WORK = 0.1;
const CLS_POOR = 0.25;
const TBT_NEEDS_WORK_MS = 200;
const TBT_POOR_MS = 600;
const INP_NEEDS_WORK_MS = 200;
const INP_POOR_MS = 500;

// Weight budgets, in bytes.
const JS_BUDGET = 500 * 1024;
const JS_POOR = 1024 * 1024;
const IMAGE_BUDGET = 1536 * 1024;
const APP_SCRIPT_BUDGET = 300 * 1024;

const MAX_FONTS = 3;

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

/** Name to show for a third party — the matched app, else the raw entity. */
function label(script: ThirdPartyScript): string {
  return script.appName || script.url;
}

export const perfRules: Rule[] = [
  {
    id: "perf.score.low",
    page: "perf",
    severity: "high",
    description: "Lighthouse performance score below Lighthouse's passing band",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const lh = ctx.lighthouse;
      if (!lh) return null;
      if (lh.performanceScore >= SCORE_NEEDS_WORK) return null;

      // Finding severity is scaled to the measurement; the rule's own
      // severity is the worst case it can report.
      const severity: Severity = lh.performanceScore < SCORE_POOR ? "high" : "medium";
      return {
        ruleId: "perf.score.low",
        page: "perf",
        severity,
        title: `Performance score is ${lh.performanceScore}/100 on mobile`,
        evidence: {
          type: "text",
          value: `Lighthouse scores 90+ as good, 50-89 as needs improvement, below 50 as poor.`,
        },
        fixableByAI: false,
      };
    },
  },

  {
    id: "perf.lcp.slow",
    page: "perf",
    severity: "high",
    description: "Largest Contentful Paint slower than 2.5s",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const lh = ctx.lighthouse;
      if (!lh || lh.lcp <= 0) return null;
      if (lh.lcp < LCP_NEEDS_WORK_S) return null;

      const severity: Severity = lh.lcp >= LCP_POOR_S ? "high" : "medium";
      return {
        ruleId: "perf.lcp.slow",
        page: "perf",
        severity,
        title: `Largest Contentful Paint is ${lh.lcp}s`,
        evidence: {
          type: "text",
          value:
            `Good is under ${LCP_NEEDS_WORK_S}s. The largest element is usually the hero ` +
            `image — serve it at the size it displays at and avoid lazy-loading it.`,
        },
        fixableByAI: false,
      };
    },
  },

  {
    id: "perf.cls.high",
    page: "perf",
    severity: "high",
    description: "Cumulative Layout Shift above 0.1",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const lh = ctx.lighthouse;
      if (!lh) return null;
      if (lh.cls <= CLS_NEEDS_WORK) return null;

      const severity: Severity = lh.cls > CLS_POOR ? "high" : "medium";
      return {
        ruleId: "perf.cls.high",
        page: "perf",
        severity,
        title: `Layout shifts during load (CLS ${lh.cls})`,
        evidence: {
          type: "text",
          value:
            `Good is ${CLS_NEEDS_WORK} or less. Content jumping as it loads causes mis-taps ` +
            `on mobile. Usually images or embeds without reserved width/height.`,
        },
        fixableByAI: false,
      };
    },
  },

  {
    id: "perf.tbt.high",
    page: "perf",
    severity: "high",
    description: "Total Blocking Time above 200ms",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const lh = ctx.lighthouse;
      if (!lh || lh.tbt <= 0) return null;
      if (lh.tbt <= TBT_NEEDS_WORK_MS) return null;

      const severity: Severity = lh.tbt > TBT_POOR_MS ? "high" : "medium";
      return {
        ruleId: "perf.tbt.high",
        page: "perf",
        severity,
        title: `Main thread blocked for ${lh.tbt}ms during load`,
        evidence: {
          type: "text",
          value:
            `Good is under ${TBT_NEEDS_WORK_MS}ms. While blocked the page cannot respond ` +
            `to taps. Deferring non-critical app scripts is the usual fix.`,
        },
        fixableByAI: false,
      };
    },
  },

  {
    id: "perf.inp.slow",
    page: "perf",
    severity: "medium",
    description: "Interaction to Next Paint above 200ms (CrUX field data)",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const lh = ctx.lighthouse;
      // undefined means CrUX has no data for this store, not that INP is fine.
      if (!lh || typeof lh.inp !== "number") return null;
      if (lh.inp <= INP_NEEDS_WORK_MS) return null;

      const severity: Severity = lh.inp > INP_POOR_MS ? "high" : "medium";
      return {
        ruleId: "perf.inp.slow",
        page: "perf",
        severity,
        title: `Real visitors wait ${lh.inp}ms for the page to respond (INP)`,
        evidence: {
          type: "text",
          value:
            `Measured from real Chrome traffic to this store. Good is under ` +
            `${INP_NEEDS_WORK_MS}ms. Heavy third-party JavaScript is the common cause.`,
        },
        fixableByAI: false,
      };
    },
  },

  {
    id: "perf.js.weight",
    page: "perf",
    severity: "high",
    description: "Total JavaScript transfer weight over budget",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const lh = ctx.lighthouse;
      if (!lh || lh.totalJsWeight <= 0) return null;
      if (lh.totalJsWeight <= JS_BUDGET) return null;

      const severity: Severity = lh.totalJsWeight > JS_POOR ? "high" : "medium";
      return {
        ruleId: "perf.js.weight",
        page: "perf",
        severity,
        title: `Page loads ${kb(lh.totalJsWeight)} of JavaScript`,
        evidence: {
          type: "text",
          value: `Budget is ${kb(JS_BUDGET)}. Most of this is usually apps rather than the theme.`,
        },
        fixableByAI: false,
      };
    },
  },

  {
    id: "perf.apps.weight",
    page: "perf",
    severity: "medium",
    description: "Third-party app scripts add significant page weight",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const lh = ctx.lighthouse;
      if (!lh || lh.thirdPartyScripts.length === 0) return null;

      const total = lh.thirdPartyScripts.reduce((sum, s) => sum + s.size, 0);
      if (total <= APP_SCRIPT_BUDGET) return null;

      // Name the biggest contributors so the merchant knows what to review.
      const top = [...lh.thirdPartyScripts]
        .sort((a, b) => b.size - a.size)
        .slice(0, 5)
        .map((s) => `${label(s)} ${kb(s.size)}`)
        .join(", ");

      const severity: Severity = total > APP_SCRIPT_BUDGET * 2 ? "high" : "medium";
      return {
        ruleId: "perf.apps.weight",
        page: "perf",
        severity,
        title: `Apps and third-party scripts add ${kb(total)} to every page`,
        evidence: {
          type: "text",
          value: `Heaviest: ${top}. Uninstalling an unused app removes its script everywhere.`,
        },
        fixableByAI: false,
      };
    },
  },

  {
    id: "perf.apps.blocking",
    page: "perf",
    severity: "medium",
    description: "A third-party script blocks the main thread",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const lh = ctx.lighthouse;
      if (!lh) return null;

      const blockers = lh.thirdPartyScripts
        .filter((s) => s.blocking)
        .sort((a, b) => b.blockingTimeMs - a.blockingTimeMs);
      if (blockers.length === 0) return null;

      const worst = blockers[0];
      return {
        ruleId: "perf.apps.blocking",
        page: "perf",
        severity: "medium",
        title: `${label(worst)} blocks the main thread for ${worst.blockingTimeMs}ms`,
        evidence: {
          type: "text",
          value:
            blockers.length > 1
              ? `${blockers.length} third parties block rendering. Worst: ` +
                blockers
                  .slice(0, 3)
                  .map((s) => `${label(s)} ${s.blockingTimeMs}ms`)
                  .join(", ")
              : `Ask the app's support whether its script can load deferred or async.`,
        },
        fixableByAI: false,
      };
    },
  },

  {
    id: "perf.render.blocking",
    page: "perf",
    severity: "medium",
    description: "Render-blocking resources delay first paint",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const lh = ctx.lighthouse;
      if (!lh || lh.renderBlockingCount === 0) return null;

      return {
        ruleId: "perf.render.blocking",
        page: "perf",
        severity: "medium",
        title: `${lh.renderBlockingCount} render-blocking ${
          lh.renderBlockingCount === 1 ? "resource" : "resources"
        } delay first paint`,
        evidence: {
          type: "text",
          value: `Nothing displays until these finish loading. Usually CSS or synchronous scripts in the theme head.`,
        },
        fixableByAI: false,
      };
    },
  },

  {
    id: "perf.fonts.count",
    page: "perf",
    severity: "low",
    description: "More than 3 font files requested",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const lh = ctx.lighthouse;
      if (!lh || lh.fontCount <= MAX_FONTS) return null;

      return {
        ruleId: "perf.fonts.count",
        page: "perf",
        severity: "low",
        title: `${lh.fontCount} font files loaded`,
        evidence: {
          type: "text",
          value: `${MAX_FONTS} or fewer is typical. Each weight and style is a separate download.`,
        },
        fixableByAI: false,
      };
    },
  },

  {
    id: "perf.image.weight",
    page: "perf",
    severity: "medium",
    description: "Total image transfer weight over budget",
    fixableByAI: false,
    check: (ctx: RuleContext): Finding | null => {
      const lh = ctx.lighthouse;
      if (!lh || lh.totalImageWeight <= 0) return null;
      if (lh.totalImageWeight <= IMAGE_BUDGET) return null;

      return {
        ruleId: "perf.image.weight",
        page: "perf",
        severity: "medium",
        title: `Page loads ${kb(lh.totalImageWeight)} of images`,
        evidence: {
          type: "text",
          value:
            `Budget is ${kb(IMAGE_BUDGET)}. Shopify's CDN already handles format and ` +
            `compression — the fix is requesting smaller dimensions and lazy-loading ` +
            `images below the fold, not re-encoding files.`,
        },
        fixableByAI: false,
      };
    },
  },
];
