import { describe, it, expect } from "vitest";
import { CATEGORY_CHECK_COUNTS, UNREACHABLE_RULE_IDS } from "../../app/scoring";
import {
  ANALYSIS_STEP,
  AREA_STEP,
  IMAGES_STEP,
  PERFORMANCE_STEP,
  planScanSteps,
  stepStates,
} from "../../app/scans/steps";
import {
  CATALOG_IMAGE_RULE_IDS,
  allRules,
  getRulesForPage,
  runRulesDetailed,
} from "../../app/rules";
import { imageRules } from "../../app/rules/images";
import { perfRules } from "../../app/rules/perf";
import {
  SCAN_SCOPES,
  SCAN_SCOPE_ORDER,
  isScanScope,
  isSelectableScope,
  needsStorefront,
  type ScanScope,
} from "../../app/scans/scopes";

const IMAGE_RULE_IDS = ["img.alt", "img.size", "img.dims.large", "img.dims.small", "img.count", "img.ratio", "img.duplicate"];
const pageRuleIds = (page: "homepage" | "collection" | "product") => getRulesForPage(page).map((r) => r.id);
const rulesIn = (scope: ScanScope, ids: string[]) => ids.filter(SCAN_SCOPES[scope].includesRule);

describe("scan scopes", () => {
  it("homepage scan runs every homepage rule and nothing else", () => {
    expect(rulesIn("homepage", pageRuleIds("homepage"))).toEqual(pageRuleIds("homepage"));
    expect(rulesIn("homepage", [...pageRuleIds("product"), ...IMAGE_RULE_IDS])).toEqual([]);
  });

  it("SEO rules belong to the SEO scan, not the CRO scans", () => {
    const seo = ["prod.seo.title", "prod.seo.meta", "prod.schema", "coll.description"];
    expect(rulesIn("seo", [...pageRuleIds("product"), ...pageRuleIds("collection")]).sort()).toEqual(seo.sort());
    expect(rulesIn("product", seo)).toEqual([]);
    expect(rulesIn("collection", seo)).toEqual([]);
  });

  it("splits image checks from alt text", () => {
    expect(rulesIn("alt", IMAGE_RULE_IDS)).toEqual(["img.alt"]);
    expect(rulesIn("images", IMAGE_RULE_IDS)).toEqual(IMAGE_RULE_IDS.filter((id) => id !== "img.alt"));
  });

  it("area scans together cover every page and image rule exactly once", () => {
    const areaScopes: ScanScope[] = ["homepage", "product", "collection", "seo", "images", "alt"];
    const ids = [...pageRuleIds("homepage"), ...pageRuleIds("collection"), ...pageRuleIds("product"), ...IMAGE_RULE_IDS];
    for (const id of ids) {
      const owners = areaScopes.filter((scope) => SCAN_SCOPES[scope].includesRule(id));
      expect(owners, id).toHaveLength(1);
    }
  });

  it("the areas together run every rule the scanner has", () => {
    // Speed and checkout have their own area now that there is no full scan,
    // and cart rules have one too — without it they could never run.
    for (const rule of [...allRules, ...perfRules]) {
      const owners = SCAN_SCOPE_ORDER.filter((scope) => SCAN_SCOPES[scope].includesRule(rule.id));
      expect(owners, rule.id).toHaveLength(1);
    }
    expect(SCAN_SCOPES.speed.performance).toBe(true);
    expect(SCAN_SCOPES.checkout.checkout).toBe(true);
  });

  it("only page scans need the storefront password", () => {
    expect(SCAN_SCOPE_ORDER.filter(needsStorefront)).toEqual([
      "homepage",
      "product",
      "collection",
      "cart",
      "seo",
    ]);
  });

  it("rejects unknown scope names, and the retired full scan, from the form", () => {
    expect(isSelectableScope("images")).toBe(true);
    expect(isSelectableScope("toString")).toBe(false);
    expect(isSelectableScope("everything")).toBe(false);
    // Old scans still read back as "Full scan", but none can be requested.
    expect(isScanScope("full")).toBe(true);
    expect(isSelectableScope("full")).toBe(false);
  });

  it("every page rule reports findings under its own rule id", () => {
    // Coverage is keyed by rule id; a finding under a different id could never be marked fixed.
    const html = "<html><body></body></html>";
    for (const page of ["homepage", "collection", "product"] as const) {
      const run = runRulesDetailed(page, { html });
      for (const finding of run.findings) expect(run.evaluated, finding.ruleId).toContain(finding.ruleId);
    }
    expect(imageRules.every((rule) => rule.id.startsWith("img."))).toBe(true);
  });
});

describe("scan steps", () => {
  it("plans only the steps a scope actually runs", () => {
    expect(planScanSteps("homepage")).toEqual([AREA_STEP.homepage, ANALYSIS_STEP]);
    expect(planScanSteps("alt")).toEqual([IMAGES_STEP, ANALYSIS_STEP]);
    expect(planScanSteps("speed")).toEqual([PERFORMANCE_STEP, ANALYSIS_STEP]);
    expect(planScanSteps("seo")).toEqual([
      AREA_STEP.collection,
      AREA_STEP.product,
      ANALYSIS_STEP,
    ]);
  });

  it("always ends by writing recommendations", () => {
    for (const scope of SCAN_SCOPE_ORDER) {
      expect(planScanSteps(scope).at(-1)).toBe(ANALYSIS_STEP);
    }
  });

  it("marks steps done, active and pending from what the worker reported", () => {
    const steps = planScanSteps("seo");
    expect(stepStates(steps, AREA_STEP.product)).toEqual(["done", "active", "pending"]);
    // The worker appends detail to the label it is on.
    expect(stepStates(steps, `${AREA_STEP.collection} 2/3`)).toEqual([
      "active",
      "pending",
      "pending",
    ]);
  });

  it("shows nothing as started rather than guessing when no step was reported", () => {
    const steps = planScanSteps("images");
    expect(stepStates(steps, null)).toEqual(["pending", "pending"]);
    expect(stepStates(steps, "Something else entirely")).toEqual(["pending", "pending"]);
  });
});

describe("rule reachability", () => {
  it("has exactly one rule no scan can run, and it is a known one", () => {
    // img.lazy is a page rule living in the image scopes, which read the Admin
    // API and fetch no pages. Listed here so a newly stranded rule fails the
    // build rather than quietly inflating a category's check count.
    expect(UNREACHABLE_RULE_IDS).toEqual(["img.lazy"]);
  });

  it("leaves unreachable rules out of category totals", () => {
    const reachableImageRules = CATALOG_IMAGE_RULE_IDS.length;
    expect(CATEGORY_CHECK_COUNTS.seo).toBe(reachableImageRules);
  });

  it("counts every reachable rule in exactly one category", () => {
    const counted = Object.values(CATEGORY_CHECK_COUNTS).reduce((sum, n) => sum + n, 0);
    expect(counted).toBe(
      allRules.length - UNREACHABLE_RULE_IDS.length + CATALOG_IMAGE_RULE_IDS.length,
    );
  });
});
