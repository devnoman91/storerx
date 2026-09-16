import { describe, expect, it } from "vitest";
import { allRules, CATALOG_IMAGE_RULE_IDS } from "../../app/rules";
import { RULE_REMEDIES } from "../../app/remedies/catalog";
import { actionsFor, SUGGESTION_LABELS } from "../../app/remedies/actions";
import { adminUrl, numericId } from "../../app/remedies/links";
import { scopeForRule } from "../../app/scans/scopes";

/**
 * Catalog image checks are plain functions rather than Rule objects, so they
 * are not in `allRules` — but they still report findings the UI must be able
 * to act on.
 */
const ALL_RULE_IDS = [...allRules.map((rule) => rule.id), ...CATALOG_IMAGE_RULE_IDS];

describe("remedy catalog", () => {
  it("covers every rule", () => {
    expect(ALL_RULE_IDS.filter((id) => !(id in RULE_REMEDIES))).toEqual([]);
  });

  it("does not describe rules that no longer exist", () => {
    const known = new Set<string>(ALL_RULE_IDS);
    expect(Object.keys(RULE_REMEDIES).filter((id) => !known.has(id))).toEqual([]);
  });

  it("only offers drafted copy for things a merchant edits in admin", () => {
    for (const [ruleId, remedy] of Object.entries(RULE_REMEDIES)) {
      if (remedy.suggestion) expect(remedy.kind, ruleId).toBe("admin");
    }
  });

  it("gives settings and theme remedies a destination", () => {
    for (const [ruleId, remedy] of Object.entries(RULE_REMEDIES)) {
      if (remedy.kind === "settings") expect(remedy.ref, ruleId).toBeTruthy();
      if (remedy.kind !== "messaging") expect(remedy.area, ruleId).toBeTruthy();
    }
  });

  it("can send every rule back to an area that re-checks it", () => {
    expect(ALL_RULE_IDS.filter((id) => scopeForRule(id) === null)).toEqual([]);
  });
});

describe("admin links", () => {
  it("takes the numeric id out of a GID", () => {
    expect(numericId("gid://shopify/Product/12345")).toBe("12345");
    expect(numericId("gid://shopify/MediaImage/98765")).toBe("98765");
    expect(numericId("12345")).toBe("12345");
    expect(numericId(null)).toBeNull();
    expect(numericId("not-a-gid")).toBeNull();
  });

  it("builds admin URLs App Bridge can resolve", () => {
    expect(adminUrl({ area: "product", ref: "gid://shopify/Product/7" })).toBe(
      "shopify://admin/products/7",
    );
    expect(adminUrl({ area: "collection", ref: "gid://shopify/Collection/9" })).toBe(
      "shopify://admin/collections/9",
    );
    expect(adminUrl({ area: "settings", ref: "checkout" })).toBe("shopify://admin/settings/checkout");
    expect(adminUrl({ area: "settings", ref: "apps" })).toBe("shopify://admin/apps");
    expect(adminUrl({ area: "theme", ref: "product" })).toBe(
      "shopify://admin/themes/current/editor?template=product",
    );
    expect(adminUrl({ area: "theme", ref: null })).toBe("shopify://admin/themes/current/editor");
  });

  it("returns no link rather than a wrong one when the resource is unknown", () => {
    expect(adminUrl({ area: "product", ref: null })).toBeNull();
    expect(adminUrl({ area: null, ref: "gid://shopify/Product/7" })).toBeNull();
  });
});

describe("issue actions", () => {
  it("offers an admin edit link for admin remedies", () => {
    const actions = actionsFor({
      remedy: "admin",
      status: "open",
      suggestion: "alt_text",
      adminArea: "product",
      adminRef: "gid://shopify/Product/7",
    });
    expect(actions.primary.label).toBe(SUGGESTION_LABELS.alt_text.view);
    expect(actions.secondary).toEqual({
      label: "Edit in Shopify Admin",
      href: "shopify://admin/products/7",
    });
  });

  it("explains why an admin link is missing instead of linking nowhere", () => {
    const actions = actionsFor({ remedy: "admin", status: "open", adminArea: "product", adminRef: null });
    expect(actions.secondary?.href).toBeUndefined();
    expect(actions.secondary?.unavailable).toBeTruthy();
  });

  it("sends CRO issues to guidance, not to an edit screen", () => {
    expect(actionsFor({ remedy: "theme", status: "open" }).secondary).toEqual({
      label: "How to improve",
    });
    expect(actionsFor({ remedy: "messaging", status: "open" }).secondary).toEqual({
      label: "See suggested approach",
    });
  });

  it("never promises to change the store", () => {
    const kinds = ["admin", "settings", "theme", "messaging"] as const;
    for (const remedy of kinds) {
      const actions = actionsFor({
        remedy,
        status: "open",
        adminArea: remedy === "messaging" ? null : "theme",
        adminRef: "product",
      });
      for (const label of [actions.primary.label, actions.secondary?.label ?? ""]) {
        expect(label.toLowerCase()).not.toMatch(/fix with ai|apply|automatic/);
      }
    }
  });

  it("drops the call to action once an issue is verified", () => {
    const actions = actionsFor({ remedy: "theme", status: "resolved", adminArea: "theme" });
    expect(actions.secondary).toBeNull();
  });
});
