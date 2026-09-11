import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectStorefrontPage,
  cookieHeader,
  extractAuthenticityToken,
  isPasswordPage,
  mergeCookies,
} from "../../app/collectors/storefront";
import { runLighthouseAudit } from "../../app/collectors/lighthouse";
import { NonRetryableError, StorefrontLockedError } from "../../app/errors";

const passwordPage = readFileSync(
  join(__dirname, "..", "fixtures", "storefront", "password-page.html"),
  "utf8",
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isPasswordPage", () => {
  it("recognises the password page with or without a trailing slash", () => {
    expect(isPasswordPage("https://shop.myshopify.com/password")).toBe(true);
    expect(isPasswordPage("https://shop.myshopify.com/password/")).toBe(true);
  });

  it("does not flag real storefront pages", () => {
    expect(isPasswordPage("https://shop.myshopify.com/")).toBe(false);
    expect(isPasswordPage("https://shop.myshopify.com/products/password-safe")).toBe(false);
    expect(isPasswordPage("not a url")).toBe(false);
  });
});

describe("extractAuthenticityToken", () => {
  it("reads the CSRF token from a real Shopify password page", () => {
    expect(extractAuthenticityToken(passwordPage)).toBe("FIXTURE_AUTH_TOKEN");
  });

  it("returns null when the form has no token", () => {
    expect(extractAuthenticityToken("<form><input name='password'></form>")).toBeNull();
  });
});

describe("mergeCookies", () => {
  it("keeps name=value, drops attributes, and lets later cookies win", () => {
    const jar = mergeCookies(new Map(), [
      "_shopify_essential=first; Path=/; HttpOnly; Secure",
      "cart_currency=USD; Path=/",
    ]);
    mergeCookies(jar, ["_shopify_essential=second; Path=/; HttpOnly"]);
    expect(cookieHeader(jar)).toBe("_shopify_essential=second; cart_currency=USD");
  });
});

describe("collectStorefrontPage", () => {
  it("refuses a page that redirected to the password page", async () => {
    // Shopify answers with a 200 after redirecting, so status alone looks fine.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      url: "https://shop.myshopify.com/password",
      text: async () => passwordPage,
    })));

    const attempt = collectStorefrontPage(
      "https://shop.myshopify.com/products/blue",
      "product",
      { domain: "shop.myshopify.com" },
    );
    await expect(attempt).rejects.toBeInstanceOf(StorefrontLockedError);
  });

  it("marks a locked storefront as not worth retrying", () => {
    expect(new StorefrontLockedError("locked")).toBeInstanceOf(NonRetryableError);
  });

  it("sends the session cookie and returns the real page", async () => {
    // Typed signature so the call args can be inspected below.
    type FetchInit = { headers: Record<string, string> };
    const fetchMock = vi.fn<(url: string, init?: FetchInit) => Promise<unknown>>(async () => ({
      ok: true,
      status: 200,
      url: "https://shop.myshopify.com/products/blue",
      text: async () => "<html>real product</html>",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const page = await collectStorefrontPage(
      "https://shop.myshopify.com/products/blue",
      "product",
      { domain: "shop.myshopify.com", cookie: "_shopify_essential=unlocked" },
    );
    expect(page.html).toContain("real product");
    const init = fetchMock.mock.calls[0][1];
    expect(init?.headers.Cookie).toBe("_shopify_essential=unlocked");
  });
});

describe("PageSpeed on a password-protected store", () => {
  it("records performance as unmeasured instead of scoring the lock screen", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        lighthouseResult: {
          finalDisplayedUrl: "https://shop.myshopify.com/password",
          categories: { performance: { score: 0.99 } },
          audits: {},
        },
      }),
    })));

    const result = await runLighthouseAudit({ url: "https://shop.myshopify.com", mobile: true });
    // The lock screen scores ~99; that must never reach the store's score.
    expect(result.combinedScore).toBeNull();
    expect(result.mobile).toBeUndefined();
  });
});
