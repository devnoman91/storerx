import { describe, expect, it } from "vitest";
import { draftTargetFor } from "../../app/suggestions/target";
import { RULE_REMEDIES } from "../../app/remedies/catalog";
import { SUGGESTION_LABELS } from "../../app/remedies/actions";

describe("draft targets", () => {
  it("drafts alt text for the image, not the product it sits on", () => {
    expect(
      draftTargetFor({
        suggestionKind: "alt_text",
        targetId: "gid://shopify/MediaImage/5",
        adminRef: "gid://shopify/Product/1",
      }),
    ).toBe("gid://shopify/MediaImage/5");
  });

  it("drafts product fields for the product", () => {
    for (const kind of ["seo_title", "seo_meta", "product_description"]) {
      expect(
        draftTargetFor({ suggestionKind: kind, targetId: null, adminRef: "gid://shopify/Product/1" }),
      ).toBe("gid://shopify/Product/1");
    }
  });

  it("has no target when StoreRx cannot draft for the issue", () => {
    expect(draftTargetFor({ suggestionKind: null, targetId: "x", adminRef: "y" })).toBeNull();
  });

  it("has no target when the scan never recorded the resource", () => {
    expect(
      draftTargetFor({ suggestionKind: "seo_title", targetId: null, adminRef: null }),
    ).toBeNull();
  });

  it("can label every kind of copy it offers to draft", () => {
    for (const remedy of Object.values(RULE_REMEDIES)) {
      if (remedy.suggestion) expect(SUGGESTION_LABELS[remedy.suggestion]).toBeTruthy();
    }
  });
});
