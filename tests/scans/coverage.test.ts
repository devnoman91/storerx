import { describe, expect, it } from "vitest";
import { scanCoverage, verificationScopes } from "../../app/scans/coverage";
import { SCAN_SCOPE_ORDER } from "../../app/scans/scopes";

describe("scan coverage", () => {
  it("counts the areas that have been checked", () => {
    const coverage = scanCoverage({ scanned: ["homepage", "seo"], scansLeft: 6 });
    expect(coverage.checked).toBe(2);
    expect(coverage.total).toBe(SCAN_SCOPE_ORDER.length);
  });

  it("suggests the first unchecked area in the recommended order", () => {
    // Nothing invented: SCAN_SCOPE_ORDER is the order StoreRx recommends.
    expect(scanCoverage({ scanned: [], scansLeft: null }).next?.scope).toBe(SCAN_SCOPE_ORDER[0]);
    expect(scanCoverage({ scanned: ["homepage", "seo"], scansLeft: 6 }).next?.scope).toBe("product");
  });

  it("does not suggest an area that is already queued", () => {
    const coverage = scanCoverage({ scanned: ["homepage"], inFlight: ["product"], scansLeft: 5 });
    expect(coverage.next?.scope).toBe("collection");
    // Queued areas are not offered for queueing again either.
    expect(coverage.remaining).toBe(SCAN_SCOPE_ORDER.length - 2);
  });

  it("offers only as many scans as the plan has left", () => {
    // This store: 7 areas unchecked, 6 scans left — the button must not claim
    // it will check all 7.
    const coverage = scanCoverage({ scanned: ["homepage", "seo"], scansLeft: 6 });
    expect(coverage.remaining).toBe(7);
    expect(coverage.canQueue).toBe(6);
  });

  it("offers every remaining area on an unlimited plan", () => {
    const coverage = scanCoverage({ scanned: [], scansLeft: null });
    expect(coverage.canQueue).toBe(SCAN_SCOPE_ORDER.length);
  });

  it("offers nothing when the plan is spent", () => {
    expect(scanCoverage({ scanned: [], scansLeft: 0 }).canQueue).toBe(0);
  });

  it("has nothing to suggest once every area has been checked", () => {
    const coverage = scanCoverage({ scanned: SCAN_SCOPE_ORDER, scansLeft: 3 });
    expect(coverage.next).toBeNull();
    expect(coverage.remaining).toBe(0);
    expect(coverage.checked).toBe(coverage.total);
  });

  it("ignores scopes that are no longer offered", () => {
    // "full" is retired; an old scan of it must not count as coverage.
    expect(scanCoverage({ scanned: ["full"], scansLeft: 9 }).checked).toBe(0);
  });
});

describe("verification scopes", () => {
  it("costs one scan per area, however many issues are involved", () => {
    // Four issues, two areas: two scans settle all four.
    expect(
      verificationScopes(["prod.reviews.fold", "prod.desc.short", "home.hero.cta", "home.trust.badges"]),
    ).toEqual(["homepage", "product"]);
  });

  it("returns the areas in the order StoreRx offers them", () => {
    expect(verificationScopes(["cart.upsell.none", "home.hero.cta"])).toEqual(["homepage", "cart"]);
  });

  it("skips an area whose scan is already on its way", () => {
    expect(verificationScopes(["home.hero.cta", "prod.desc.short"], ["homepage"])).toEqual(["product"]);
  });

  it("ignores a rule no scan covers", () => {
    expect(verificationScopes(["not.a.real.rule"])).toEqual([]);
  });

  it("has nothing to run when nothing is awaiting verification", () => {
    expect(verificationScopes([])).toEqual([]);
  });
});
