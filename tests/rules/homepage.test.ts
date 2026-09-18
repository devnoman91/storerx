import { describe, expect, it } from "vitest";
import { homepageRules } from "../../app/rules/homepage";
import { checked, fixture, run, without } from "./helpers";

const dawn = fixture("dawn", "home");
const check = (id: string, html: string) => checked(run(homepageRules, id, { html }));

/** Dawn's first homepage section: the image banner with "Shop now". */
const HERO = "#shopify-section-template--15968257704025__image_banner";

describe("home.hero.cta", () => {
  it("passes when the first section has a button or link", () => {
    expect(check("home.hero.cta", dawn)).toBeNull();
  });

  it("fires when the first section has nothing to click", () => {
    const finding = check("home.hero.cta", without(dawn, `${HERO} a`, `${HERO} button`));
    expect(finding?.title).toMatch(/first section has no call to action/);
  });
});

describe("home.announcement", () => {
  it("passes on Dawn's announcement bar", () => {
    expect(check("home.announcement", dawn)).toBeNull();
  });

  it("fires with no bar and no shipping promise in the header", () => {
    expect(check("home.announcement", without(dawn, '[class*="announcement"]'))?.ruleId).toBe(
      "home.announcement",
    );
  });

  it("accepts a shipping promise in the header without a bar", () => {
    const html = "<header><p>Free shipping over $50</p></header><main><a href='/products/x'>x</a></main>";
    expect(check("home.announcement", html)).toBeNull();
  });
});

describe("home.featured", () => {
  it("passes when the homepage links to products", () => {
    expect(check("home.featured", dawn)).toBeNull();
  });

  it("fires when the homepage features nothing", () => {
    const html = without(dawn, 'main a[href*="/products/"]', 'main a[href*="/collections/"]');
    expect(check("home.featured", html)?.ruleId).toBe("home.featured");
  });
});

describe("home.trust", () => {
  it("is not fooled by 'secure' in a meta tag", () => {
    // The old rule passed Dawn's homepage because og:image:secure_url
    // contains "secure". Dawn's demo homepage has no reviews or testimonials.
    expect(dawn).toContain("og:image:secure_url");
    expect(check("home.trust", dawn)?.ruleId).toBe("home.trust");
  });

  it("passes on visible social proof", () => {
    const html = "<main><section><h2>Rated 4.8 by 2,000 happy customers</h2></section></main>";
    expect(check("home.trust", html)).toBeNull();
  });

  it("passes on a review widget", () => {
    expect(check("home.trust", '<main><div class="jdgm-carousel"></div></main>')).toBeNull();
  });
});

describe("home.popups", () => {
  it("does not count a theme's own modals as popups", () => {
    // Dawn uses modals for search and the cart; the old rule counted the
    // word "modal" and fired on every Dawn store.
    expect(dawn.match(/modal/gi)!.length).toBeGreaterThan(3);
    expect(check("home.popups", dawn)).toBeNull();
  });

  it("fires on two popup tools and names them", () => {
    const html = `<head>
      <script src="https://static.klaviyo.com/onsite/js/klaviyo.js"></script>
      <script src="https://widget.privy.com/assets/widget.js"></script></head><main></main>`;
    const finding = check("home.popups", html);
    expect(finding?.title).toBe("2 popup and email-capture tools load on your homepage");
    expect(finding?.evidence?.value).toContain("Klaviyo, Privy");
  });

  it("allows a single popup tool", () => {
    const html = '<script src="https://widget.privy.com/assets/widget.js"></script><main></main>';
    expect(check("home.popups", html)).toBeNull();
  });
});

describe("home.nav", () => {
  it("passes when the header has search", () => {
    expect(check("home.nav", dawn)).toBeNull();
  });

  it("is not fooled by 'search' in a script", () => {
    const html = "<header><nav><a href='/'>Home</a></nav></header><script>var isSearchTemplate = true</script>";
    expect(check("home.nav", html)?.ruleId).toBe("home.nav");
  });
});

describe("home.contact", () => {
  it("passes when the footer links to contact and about pages", () => {
    expect(check("home.contact", dawn)).toBeNull();
  });

  it("fires and names what is missing when the footer has no such links", () => {
    const finding = check("home.contact", without(dawn, "footer a"));
    expect(finding?.evidence?.value).toBe("No contact or about or policies links in the footer");
  });
});
