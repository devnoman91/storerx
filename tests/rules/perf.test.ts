import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runRules } from "../../app/rules";
import { perfRules } from "../../app/rules/perf";
import type { Finding, LighthouseMetrics } from "../../app/rules/types";
import { calculateStoreHealth, isMeasurableCategory } from "../../app/scoring";

function fixture(name: string): LighthouseMetrics {
  const path = join(__dirname, "..", "fixtures", "perf", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as LighthouseMetrics;
}

function run(lighthouse?: LighthouseMetrics): Finding[] {
  return runRules("perf", { html: "", lighthouse });
}

function ids(findings: Finding[]): string[] {
  return findings.map((f) => f.ruleId);
}

describe("perf rules", () => {
  it("reports nothing when no measurement is available", () => {
    // A missing Lighthouse run must not read as a passing one.
    expect(run(undefined)).toEqual([]);
  });

  it("reports nothing on a healthy page", () => {
    expect(run(fixture("healthy"))).toEqual([]);
  });

  it("flags every problem on a slow, app-heavy page", () => {
    const found = ids(run(fixture("slow-app-heavy")));
    expect(found).toEqual(
      expect.arrayContaining([
        "perf.score.low",
        "perf.lcp.slow",
        "perf.cls.high",
        "perf.tbt.high",
        "perf.inp.slow",
        "perf.js.weight",
        "perf.apps.weight",
        "perf.apps.blocking",
        "perf.render.blocking",
        "perf.fonts.count",
        "perf.image.weight",
      ]),
    );
  });

  it("skips INP when CrUX has no field data, rather than scoring it as good", () => {
    const found = ids(run(fixture("no-field-data")));
    expect(found).not.toContain("perf.inp.slow");
  });

  it("names the heaviest apps in the app-weight finding", () => {
    const finding = run(fixture("slow-app-heavy")).find(
      (f) => f.ruleId === "perf.apps.weight",
    );
    expect(finding?.title).toContain("KB");
    expect(finding?.evidence?.value).toContain("Klaviyo");
    expect(finding?.evidence?.value).toContain("Yotpo");
  });

  it("scales severity to the measurement", () => {
    const poor = run(fixture("slow-app-heavy"));
    expect(poor.find((f) => f.ruleId === "perf.score.low")?.severity).toBe("high");
    expect(poor.find((f) => f.ruleId === "perf.lcp.slow")?.severity).toBe("high");

    // 88 is "needs improvement", not "poor" — medium, not high.
    const borderline = run({ ...fixture("healthy"), performanceScore: 88 });
    expect(borderline.find((f) => f.ruleId === "perf.score.low")?.severity).toBe("medium");
  });

  it("never recommends re-encoding images (Shopify CDN handles format)", () => {
    // Project rule 7 — a WebP recommendation is always wrong here.
    const text = run(fixture("slow-app-heavy"))
      .map((f) => `${f.title} ${f.evidence?.value ?? ""}`)
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/webp|avif|re-encode|convert.*format/);
  });

  it("quotes no predicted conversion numbers", () => {
    // Project rule 3 — impact is High/Medium/Low, never "+12% conversion".
    const text = run(fixture("slow-app-heavy"))
      .map((f) => `${f.title} ${f.evidence?.value ?? ""}`)
      .join(" ");
    expect(text).not.toMatch(/[+-]\s?\d+(\.\d+)?%/);
  });

  it("registers every rule with a page of 'perf' and a unique id", () => {
    const seen = new Set<string>();
    for (const rule of perfRules) {
      expect(rule.page).toBe("perf");
      expect(seen.has(rule.id)).toBe(false);
      seen.add(rule.id);
      // Rule id must match the returned finding's ruleId, or the UI mislabels it.
      expect(rule.id).toMatch(/^perf\.[a-z]+\.[a-z]+$/);
    }
  });
});

describe("performance scoring", () => {
  it("takes the Performance category score from Lighthouse, not the findings", () => {
    const findings = run(fixture("slow-app-heavy"));
    const health = calculateStoreHealth(findings, { performanceScore: 34 });
    const performance = health.categories.find((c) => c.category === "performance");

    expect(performance?.score).toBe(34);
    // Counts still come from the findings.
    expect(performance?.issueCount).toBe(findings.length);
  });

  it("falls back to the findings-derived score when Lighthouse is absent", () => {
    const findings = run(fixture("slow-app-heavy"));
    const health = calculateStoreHealth(findings);
    const performance = health.categories.find((c) => c.category === "performance");

    expect(performance?.score).toBeLessThan(100);
  });

  it("marks performance unmeasured when Lighthouse failed, rather than scoring 0", () => {
    // PSI returning 429 must not read as "this store scored zero".
    const health = calculateStoreHealth([], { performanceScore: null });
    const performance = health.categories.find((c) => c.category === "performance");

    expect(performance?.measured).toBe(false);
  });

  it("excludes an unmeasured category from overall instead of counting it as 0", () => {
    // Everything else perfect. Performance carries weight 0.20, so counting a
    // failed measurement as zero would report 80 for a flawless store.
    const measured = calculateStoreHealth([], { performanceScore: 100 });
    const unmeasured = calculateStoreHealth([], { performanceScore: null });

    expect(measured.overall).toBe(100);
    expect(unmeasured.overall).toBe(100);
  });

  it("still weights a genuine zero performance score", () => {
    // A real measured 0 must drag the overall down — only *absence* is excluded.
    // Measured weights are conversion .30 + performance .20 + seo .15 +
    // productPages .15 = .80, so (30 + 0 + 15 + 15) / .80 = 75.
    const health = calculateStoreHealth([], { performanceScore: 0 });
    expect(health.categories.find((c) => c.category === "performance")?.measured).toBe(true);
    expect(health.overall).toBe(75);
  });
});

describe("categories nothing measures", () => {
  it("does not score a category no rule reports into", () => {
    const health = calculateStoreHealth([
      { ruleId: "home.trust", severity: "high", page: "homepage" },
    ]);
    const ux = health.categories.find((c) => c.category === "ux")!;

    // No page type maps to UX, so there is nothing behind a score for it.
    expect(ux.measured).toBe(false);
    expect(isMeasurableCategory("ux")).toBe(false);
    expect(isMeasurableCategory("conversion")).toBe(true);
  });

  it("keeps an unmeasurable category out of the overall score", () => {
    const health = calculateStoreHealth([
      { ruleId: "home.trust", severity: "high", page: "homepage" },
    ]);
    const conversion = health.categories.find((c) => c.category === "conversion")!;
    expect(conversion.score).toBe(90);

    // Only measured categories count, and their weights are renormalised:
    // (.30x90 + .20x100 + .15x100 + .15x100) / .80 = 96.25.
    expect(health.overall).toBe(96);

    const weights = health.categories.filter((c) => c.measured).map((c) => c.category);
    expect(weights).not.toContain("ux");
  });
});
