import { describe, expect, it } from "vitest";
import {
  APPLY_SCOPES,
  applyOperation,
  applyScopeFor,
  canApply,
  checkApply,
  checkUndo,
  isAppliable,
  sameValue,
} from "../../app/suggestions/apply";
import { RULE_REMEDIES } from "../../app/remedies/catalog";

const PRODUCT = "gid://shopify/Product/1";
const IMAGE = "gid://shopify/MediaImage/5";

describe("what StoreRx can apply", () => {
  it("applies product copy with write_products and alt text with write_files", () => {
    expect(applyScopeFor("seo_title")).toBe("write_products");
    expect(applyScopeFor("seo_meta")).toBe("write_products");
    expect(applyScopeFor("product_description")).toBe("write_products");
    expect(applyScopeFor("alt_text")).toBe("write_files");
  });

  it("cannot apply a FAQ, which has no field in Shopify", () => {
    expect(isAppliable("faq")).toBe(false);
    expect(applyOperation("faq", PRODUCT, "{}")).toBeNull();
  });

  it("cannot apply where there is no draft kind at all", () => {
    expect(isAppliable(null)).toBe(false);
    expect(isAppliable("something_else")).toBe(false);
  });

  it("asks for every scope applying can need, once", () => {
    expect([...APPLY_SCOPES].sort()).toEqual(["write_files", "write_products"]);
  });

  it("has an operation for every draft kind it says it can apply", () => {
    for (const remedy of Object.values(RULE_REMEDIES)) {
      if (!remedy.suggestion || !isAppliable(remedy.suggestion)) continue;
      expect(applyOperation(remedy.suggestion, PRODUCT, "x")).not.toBeNull();
    }
  });
});

describe("permission to apply", () => {
  it("needs the scope for that kind of draft, not just any write scope", () => {
    const readOnly = ["read_products", "read_content", "read_themes"];
    expect(canApply("seo_title", readOnly)).toBe(false);
    expect(canApply("seo_title", [...readOnly, "write_products"])).toBe(true);
    expect(canApply("alt_text", [...readOnly, "write_products"])).toBe(false);
    expect(canApply("alt_text", [...readOnly, "write_files"])).toBe(true);
  });

  it("never allows a kind that cannot be applied", () => {
    expect(canApply("faq", ["write_products", "write_files"])).toBe(false);
  });
});

describe("what is written", () => {
  it("writes only the one field the draft is for", () => {
    expect(applyOperation("seo_title", PRODUCT, "Blue Mug")?.variables).toEqual({
      product: { id: PRODUCT, seo: { title: "Blue Mug" } },
    });
    expect(applyOperation("seo_meta", PRODUCT, "A mug.")?.variables).toEqual({
      product: { id: PRODUCT, seo: { description: "A mug." } },
    });
    expect(applyOperation("product_description", PRODUCT, "<p>A mug.</p>")?.variables).toEqual({
      product: { id: PRODUCT, descriptionHtml: "<p>A mug.</p>" },
    });
  });

  it("writes alt text to the image, not the product", () => {
    const operation = applyOperation("alt_text", IMAGE, "Blue mug on a desk");
    expect(operation?.field).toBe("fileUpdate");
    expect(operation?.variables).toEqual({ files: [{ id: IMAGE, alt: "Blue mug on a desk" }] });
  });
});

describe("refusing to overwrite", () => {
  const draft = { suggested: "New title", current: "Old title", appliedAt: null };

  it("applies when the store still holds what the draft was compared against", () => {
    expect(checkApply({ ...draft, live: "Old title" })).toEqual({ ok: true });
  });

  it("treats an unset field and an empty one as the same value", () => {
    expect(sameValue(null, "")).toBe(true);
    expect(sameValue(" Title ", "Title")).toBe(true);
    expect(checkApply({ ...draft, current: null, live: "" })).toEqual({ ok: true });
  });

  it("refuses when the merchant has edited the field since the draft", () => {
    expect(checkApply({ ...draft, live: "Edited by hand" }).ok).toBe(false);
  });

  it("refuses to apply twice, or with nothing drafted", () => {
    expect(checkApply({ ...draft, appliedAt: new Date(), live: "Old title" }).ok).toBe(false);
    expect(checkApply({ ...draft, suggested: null, live: "Old title" }).ok).toBe(false);
  });
});

describe("undo", () => {
  const applied = { suggested: "New title", appliedAt: new Date() };

  it("undoes while the store still holds what StoreRx wrote", () => {
    expect(checkUndo({ ...applied, live: "New title" })).toEqual({ ok: true });
  });

  it("refuses when the merchant has edited it since, rather than discard their edit", () => {
    expect(checkUndo({ ...applied, live: "Edited again" }).ok).toBe(false);
  });

  it("has nothing to undo for a draft that was never applied", () => {
    expect(checkUndo({ suggested: "New title", appliedAt: null, live: "New title" }).ok).toBe(false);
  });
});
