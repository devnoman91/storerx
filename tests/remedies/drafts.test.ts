import { describe, expect, it } from "vitest";
import { draftTargetFor } from "../../app/suggestions/target";
import { RULE_REMEDIES } from "../../app/remedies/catalog";
import { SUGGESTION_LABELS } from "../../app/remedies/actions";
import { parseFaq, serializeFaq } from "../../app/suggestions/faq";

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
    for (const kind of ["seo_title", "seo_meta", "product_description", "faq"]) {
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

describe("drafted FAQ", () => {
  it("drafts a FAQ for the product page issue", () => {
    expect(RULE_REMEDIES["prod.faq"]).toMatchObject({ kind: "admin", area: "product", suggestion: "faq" });
  });

  it("reads back what it stored", () => {
    const entries = [{ question: "Is it machine washable?", answer: "Yes, on a cold cycle." }];
    expect(parseFaq(serializeFaq(entries))).toEqual(entries);
  });

  it("treats a malformed draft as unreadable rather than throwing", () => {
    expect(parseFaq("not json")).toBeNull();
    expect(parseFaq(JSON.stringify({ questions: [] }))).toBeNull();
    expect(parseFaq(JSON.stringify({ questions: [{ question: 1 }] }))).toBeNull();
  });
});
