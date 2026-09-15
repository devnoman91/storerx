import { describe, it, expect } from "vitest";
import { allRules, getRulesForPage, runRulesDetailed } from "../../app/rules";
import { imageRules } from "../../app/rules/images";
import { perfRules } from "../../app/rules/perf";
import { SCAN_SCOPES, SCAN_SCOPE_ORDER, isScanScope, needsStorefront, type ScanScope } from "../../app/scans/scopes";

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

  it("full scan runs everything, including speed and checkout", () => {
    const full = SCAN_SCOPES.full;
    expect([...allRules, ...perfRules].every((rule) => full.includesRule(rule.id))).toBe(true);
    expect([full.performance, full.checkout, full.catalogImages]).toEqual([true, true, true]);
  });

  it("only page scans need the storefront password", () => {
    expect(SCAN_SCOPE_ORDER.filter(needsStorefront)).toEqual(["full", "homepage", "product", "collection", "seo"]);
  });

  it("rejects unknown scope names from the form", () => {
    expect(isScanScope("images")).toBe(true);
    expect(isScanScope("toString")).toBe(false);
    expect(isScanScope("everything")).toBe(false);
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
