import { describe, expect, it } from "vitest";
import { collectionRules } from "../../app/rules/collection";
import { UNCHECKED } from "../../app/rules/types";
import { checked, fixture, run, without } from "./helpers";

const dawn = fixture("dawn", "collection");
const check = (id: string, html: string) => checked(run(collectionRules, id, { html }));

/** A grid of product cards, each image at the given width × height. */
function grid(sizes: Array<[number, number] | null>, extra = ""): string {
  const cards = sizes
    .map((size, i) => {
      const img = size ? `<img width="${size[0]}" height="${size[1]}">` : "<img>";
      return `<li><a href="/products/p${i}">${img}</a><span class="price">$10</span>${extra}</li>`;
    })
    .join("");
  return `<main><ul id="product-grid">${cards}</ul></main>`;
}

describe("coll.filters", () => {
  it("passes on Shopify's own filter and sort controls", () => {
    expect(check("coll.filters", dawn)).toBeNull();
  });

  it("names what is missing", () => {
    // Sorting stays: in Dawn the filter form also holds the sort control, so
    // filtering can be off while the form is still there.
    const noFilters = without(dawn, '[name^="filter."]');
    expect(noFilters).toContain("facet-filters-form");
    expect(check("coll.filters", noFilters)?.title).toBe("Collection pages have no filters");
    expect(check("coll.filters", without(dawn, '[name="sort_by"]'))?.title).toBe(
      "Collection pages have no sorting",
    );
  });
});

describe("coll.card.price", () => {
  it("passes when every card has a price", () => {
    expect(check("coll.card.price", dawn)).toBeNull();
  });

  it("counts the cards without one", () => {
    const finding = check("coll.card.price", without(dawn, '#product-grid [class*="price"]'));
    expect(finding?.evidence?.value).toBe("16 of 16 product cards on this page show no price");
  });
});

describe("coll.card.atc", () => {
  it("fires on Dawn's demo, which has quick add switched off", () => {
    expect(check("coll.card.atc", dawn)?.ruleId).toBe("coll.card.atc");
  });

  it("passes when cards have quick add", () => {
    expect(check("coll.card.atc", grid([null, null], '<button class="quick-add__submit">Add</button>'))).toBeNull();
  });
});

describe("coll.thin and coll.empty", () => {
  it("pass on a full collection", () => {
    expect(check("coll.thin", dawn)).toBeNull();
    expect(check("coll.empty", dawn)).toBeNull();
  });

  it("do not call a 16-product collection empty", () => {
    // The old rule matched /no.*products/ in the raw HTML — "noopener"
    // followed later by a /products/ link was enough — and reported this
    // collection, with sixteen products, as empty.
    expect(new RegExp("no.*products", "i").test(dawn)).toBe(true);
    expect(check("coll.empty", dawn)).toBeNull();
  });

  it("report thin and empty collections separately", () => {
    expect(check("coll.thin", grid([null, null]))?.title).toBe("Collection has only 2 products");
    expect(check("coll.empty", grid([null, null]))).toBeNull();

    const empty = "<main><p>No products found</p></main>";
    expect(check("coll.empty", empty)?.ruleId).toBe("coll.empty");
    expect(check("coll.thin", empty)).toBeNull();
  });
});

describe("coll.image.consistency", () => {
  it("passes when card images share a shape", () => {
    expect(check("coll.image.consistency", dawn)).toBeNull();
  });

  it("fires on mixed shapes, with the measured range", () => {
    const finding = check("coll.image.consistency", grid([[1600, 1600], [1600, 2400]]));
    expect(finding?.evidence?.value).toBe("Width ÷ height ranges from 0.67 to 1.00 across 2 card images");
  });

  it("reports it could not check when images carry no size", () => {
    // Unknown shapes are not the same as matching shapes.
    expect(run(collectionRules, "coll.image.consistency", { html: grid([null, null]) })).toBe(UNCHECKED);
  });
});

describe("coll.description", () => {
  it("fires when the collection shows no description", () => {
    expect(check("coll.description", dawn)?.ruleId).toBe("coll.description");
  });

  it("passes on a description", () => {
    const html = `<main><div class="collection-hero__description">
      Everyday bags built to last, in leather and canvas.</div></main>`;
    expect(check("coll.description", html)).toBeNull();
  });
});
