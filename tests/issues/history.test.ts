import { describe, it, expect } from "vitest";
import { fingerprint, normalizePath } from "../../app/issues/identity";
import { reconcile, type Coverage, type KnownIssue } from "../../app/issues/reconcile";
import { explanationContextHash, partitionByCache } from "../../app/issues/explanations";

const loc = (ruleId: string, page: string, pageUrl: string | null = null, targetId: string | null = null) => ({
  ruleId,
  page,
  pageUrl,
  fingerprint: fingerprint({ ruleId, pageUrl, targetId }),
});

const issue = (
  ruleId: string,
  page: string,
  pageUrl: string | null = null,
  status: KnownIssue["status"] = "open",
  targetId: string | null = null,
): KnownIssue => ({ id: `${ruleId}-${pageUrl ?? targetId ?? "store"}`, status, ...loc(ruleId, page, pageUrl, targetId) });

const coverage = (rules: string[], paths: string[] = []): Coverage => ({
  evaluatedRules: new Set(rules),
  scannedPaths: new Set(paths.map((p) => normalizePath(`https://s.com${p}`))),
});

describe("issue identity", () => {
  it("is the same page regardless of domain, trailing slash, case or query string", () => {
    const a = fingerprint({ ruleId: "prod.reviews.fold", pageUrl: "https://shop.myshopify.com/products/Blue" });
    const b = fingerprint({ ruleId: "prod.reviews.fold", pageUrl: "https://www.shop.com/products/blue/?utm=x" });
    expect(a).toBe(b);
  });

  it("separates the same rule on different pages", () => {
    expect(fingerprint({ ruleId: "prod.reviews.fold", pageUrl: "https://s.com/products/a" })).not.toBe(
      fingerprint({ ruleId: "prod.reviews.fold", pageUrl: "https://s.com/products/b" }),
    );
  });

  it("identifies image issues by the image, so a renamed product keeps its history", () => {
    const before = fingerprint({ ruleId: "img.size", pageUrl: "https://s.com/products/old", targetId: "gid://shopify/MediaImage/1" });
    const after = fingerprint({ ruleId: "img.size", pageUrl: "https://s.com/products/new", targetId: "gid://shopify/MediaImage/1" });
    expect(before).toBe(after);
  });
});

describe("reconcile: a full re-scan", () => {
  it("opens, keeps and resolves issues", () => {
    const known = [issue("home.trust", "homepage", "https://s.com/"), issue("coll.empty", "collection", "https://s.com/collections/a")];
    const current = [loc("home.trust", "homepage", "https://s.com/"), loc("home.popups", "homepage", "https://s.com/")];
    const r = reconcile(known, current, coverage(["home.trust", "home.popups", "coll.empty"], ["/", "/collections/a"]), new Set(["home.popups"]));

    expect(r.stillOpen.map((e) => e.issue.ruleId)).toEqual(["home.trust"]);
    expect(r.opened.map((e) => [e.finding.ruleId, e.isNew])).toEqual([["home.popups", true]]);
    expect(r.resolved.map((i) => i.ruleId)).toEqual(["coll.empty"]);
    expect([r.newCount, r.resolvedCount]).toEqual([1, 1]);
  });

  it("brings a fixed issue back as new when it returns", () => {
    const known = [issue("home.popups", "homepage", "https://s.com/", "resolved")];
    const r = reconcile(known, [loc("home.popups", "homepage", "https://s.com/")], coverage(["home.popups"], ["/"]), new Set(["home.popups"]));
    expect(r.reopened).toHaveLength(1);
    expect(r.newCount).toBe(1);
  });
});

describe("reconcile: partial scans only touch what they checked", () => {
  const known = [
    issue("home.trust", "homepage", "https://s.com/"),
    issue("prod.reviews.fold", "product", "https://s.com/products/blue"),
    issue("img.alt", "images", "https://s.com/products/blue", "open", "gid://shopify/MediaImage/7"),
    issue("perf.lcp.slow", "perf"),
  ];

  it("a homepage scan cannot resolve product, image or speed issues", () => {
    const r = reconcile(known, [], coverage(["home.trust", "home.popups"], ["/"]), new Set());
    expect(r.resolved.map((i) => i.ruleId)).toEqual(["home.trust"]);
  });

  it("an images scan cannot resolve an alt-text issue", () => {
    const r = reconcile(known, [], coverage(["img.size", "img.dims.large", "img.count"]), new Set());
    expect(r.resolved).toEqual([]);
  });

  it("an alt-text scan resolves alt-text issues across the catalog", () => {
    const r = reconcile(known, [], coverage(["img.alt"]), new Set());
    expect(r.resolved.map((i) => i.ruleId)).toEqual(["img.alt"]);
  });

  it("a product issue stays open when that product was not sampled again", () => {
    const r = reconcile(known, [], coverage(["prod.reviews.fold"], ["/products/new-bestseller"]), new Set());
    expect(r.resolved).toEqual([]);
  });

  it("a speed issue stays open when PageSpeed did not run", () => {
    const r = reconcile(known, [], coverage(["home.trust"], ["/"]), new Set());
    expect(r.resolved.some((i) => i.ruleId === "perf.lcp.slow")).toBe(false);
  });

  it("a rule that crashed does not resolve its issues", () => {
    // home.trust threw, so it is absent from evaluatedRules even though "/" was fetched.
    const r = reconcile(known, [], coverage(["home.popups"], ["/"]), new Set());
    expect(r.resolved).toEqual([]);
  });
});

describe("reconcile: first look at an area is a baseline", () => {
  it("does not call issues new when their rule never ran before", () => {
    const r = reconcile([], [loc("img.alt", "images", null, "gid://shopify/MediaImage/1")], coverage(["img.alt"]), new Set(["home.trust"]));
    expect(r.opened[0].isNew).toBe(false);
    expect(r.newCount).toBe(0);
  });

  it("calls an issue new when its rule ran before and did not report it", () => {
    const r = reconcile([], [loc("home.trust", "homepage", "https://s.com/")], coverage(["home.trust"], ["/"]), new Set(["home.trust"]));
    expect(r.newCount).toBe(1);
  });
});

describe("reconcile: verifying what the merchant says they fixed", () => {
  const awaiting = (ruleId: string, pageUrl: string) =>
    issue(ruleId, "homepage", pageUrl, "awaiting_verification");

  it("verifies an issue the merchant marked done and the scan no longer finds", () => {
    const known = [awaiting("home.trust", "https://s.com/")];
    const r = reconcile(known, [], coverage(["home.trust"], ["/"]), new Set(["home.trust"]));

    expect(r.resolved.map((i) => i.ruleId)).toEqual(["home.trust"]);
    expect(r.resolvedCount).toBe(1);
  });

  it("reports a failed verification rather than counting it as a new issue", () => {
    const known = [awaiting("home.trust", "https://s.com/")];
    const r = reconcile(
      known,
      [loc("home.trust", "homepage", "https://s.com/")],
      coverage(["home.trust"], ["/"]),
      new Set(["home.trust"]),
    );

    expect(r.verificationFailed.map((e) => e.issue.ruleId)).toEqual(["home.trust"]);
    expect(r.stillOpen).toEqual([]);
    expect(r.newCount).toBe(0);
  });

  it("leaves a marked issue alone when the scan did not cover it", () => {
    const known = [awaiting("home.trust", "https://s.com/")];
    const r = reconcile(known, [], coverage(["img.alt"]), new Set(["home.trust"]));

    expect(r.resolved).toEqual([]);
    expect(r.verificationFailed).toEqual([]);
  });
});

describe("explanation cache", () => {
  const hash = explanationContextHash({ promptVersion: "2", shopName: "Shop", brandVoice: "Friendly" });
  const cached = [
    {
      ruleId: "home.trust",
      contextHash: hash,
      explanation: "Why",
      recommendation: "Add social proof",
      steps: ["Collect reviews", "Show them near the buy button"],
    },
  ];

  it("reuses an explanation it has already generated", () => {
    const { hits, misses } = partitionByCache(["home.trust", "home.trust"], cached, hash);
    expect(hits.get("home.trust")).toEqual({
      explanation: "Why",
      recommendation: "Add social proof",
      steps: ["Collect reviews", "Show them near the buy button"],
    });
    expect(misses).toEqual([]);
  });

  it("only asks the AI about rules it has not explained yet", () => {
    expect(partitionByCache(["home.trust", "coll.empty"], cached, hash).misses).toEqual(["coll.empty"]);
  });

  it("regenerates when the brand voice or prompt version changes", () => {
    const voice = explanationContextHash({ promptVersion: "2", shopName: "Shop", brandVoice: "Formal" });
    const prompt = explanationContextHash({ promptVersion: "3", shopName: "Shop", brandVoice: "Friendly" });
    expect(partitionByCache(["home.trust"], cached, voice).misses).toEqual(["home.trust"]);
    expect(partitionByCache(["home.trust"], cached, prompt).misses).toEqual(["home.trust"]);
  });
});
