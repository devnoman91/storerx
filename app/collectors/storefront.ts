/**
 * Storefront Collector (Lightweight)
 *
 * Uses fetch to get page HTML - no browser needed.
 * Screenshots handled separately via PageSpeed Insights API if needed.
 */

import { StorefrontLockedError } from "../errors";

export interface StorefrontPage {
  url: string;
  pageType: "homepage" | "collection" | "product" | "cart";
  html: string;
  fetchedAt: Date;
}

export interface StorefrontCollectorOptions {
  domain: string;
  /** Cookie header from `openStorefrontSession`, for password-protected stores. */
  cookie?: string;
}

const USER_AGENT = "Mozilla/5.0 (compatible; StoreRx/1.0; +https://storerx.app)";

/**
 * Shopify serves the storefront password page with a 200 after redirecting,
 * so a plain fetch "succeeds" and returns the wrong page. The final URL is
 * the only reliable signal.
 */
export function isPasswordPage(finalUrl: string): boolean {
  try {
    return new URL(finalUrl).pathname.replace(/\/$/, "") === "/password";
  } catch {
    return false;
  }
}

/** The CSRF token the password form requires. */
export function extractAuthenticityToken(html: string): string | null {
  const match =
    html.match(/name="authenticity_token"[^>]*value="([^"]+)"/i) ??
    html.match(/value="([^"]+)"[^>]*name="authenticity_token"/i);
  return match?.[1] ?? null;
}

/** Merge Set-Cookie headers into an existing name=value jar. */
export function mergeCookies(jar: Map<string, string>, setCookies: string[]): Map<string, string> {
  for (const header of setCookies) {
    const pair = header.split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return jar;
}

export function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * Log in to a password-protected storefront and return a Cookie header that
 * later page fetches can send.
 *
 * Throws StorefrontLockedError when the password is rejected, so the audit
 * fails with an actionable message rather than scanning the password page.
 */
export async function openStorefrontSession(domain: string, password: string): Promise<string> {
  const base = `https://${domain}`;
  const jar = new Map<string, string>();

  // The form's CSRF token is bound to the session cookies issued with it.
  const form = await fetch(`${base}/password`, { headers: { "User-Agent": USER_AGENT } });
  mergeCookies(jar, form.headers.getSetCookie());
  const token = extractAuthenticityToken(await form.text());

  const body = new URLSearchParams({ password });
  if (token) body.set("authenticity_token", token);

  const login = await fetch(`${base}/password`, {
    method: "POST",
    body,
    redirect: "manual",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
    },
  });
  mergeCookies(jar, login.headers.getSetCookie());

  // Confirm by asking for the homepage: unlocked sessions are not sent back
  // to /password. Checking this beats trusting the POST's status code.
  const check = await fetch(base, {
    headers: { "User-Agent": USER_AGENT, Cookie: cookieHeader(jar) },
    redirect: "follow",
  });
  await check.arrayBuffer();
  if (isPasswordPage(check.url)) {
    throw new StorefrontLockedError(
      "The storefront password saved in Settings was not accepted. Check it under " +
        "Online Store → Preferences in Shopify admin, then update it in StoreRx Settings.",
    );
  }

  return cookieHeader(jar);
}

/**
 * Fetch page HTML using native fetch
 */
export async function collectStorefrontPage(
  url: string,
  pageType: StorefrontPage["pageType"],
  options: StorefrontCollectorOptions
): Promise<StorefrontPage> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml",
  };
  if (options.cookie) headers.Cookie = options.cookie;

  const response = await fetch(url, {
    headers,
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  // Never run rules against the password page — every finding would be about
  // the lock screen, not the store.
  if (isPasswordPage(response.url)) {
    throw new StorefrontLockedError(
      "Your storefront is password-protected, so StoreRx can only see the password " +
        "page. Add your storefront password in StoreRx Settings to scan your real pages.",
    );
  }

  const html = await response.text();

  return {
    url,
    pageType,
    html,
    fetchedAt: new Date(),
  };
}

/**
 * Collect all audit pages for a store
 */
export async function collectAuditPages(
  options: StorefrontCollectorOptions,
  pages: Array<{ type: StorefrontPage["pageType"]; url: string }>
): Promise<StorefrontPage[]> {
  const results: StorefrontPage[] = [];

  for (const page of pages) {
    try {
      const pageData = await collectStorefrontPage(page.url, page.type, options);
      results.push(pageData);
    } catch (error) {
      console.error(`Failed to collect ${page.url}:`, error);
    }
  }

  return results;
}

/**
 * Build audit page list from shop data
 */
export function buildAuditPageList(
  domain: string,
  collections: Array<{ handle: string }>,
  products: Array<{ handle: string }>
): Array<{ type: StorefrontPage["pageType"]; url: string }> {
  const baseUrl = `https://${domain}`;

  const pages: Array<{ type: StorefrontPage["pageType"]; url: string }> = [
    { type: "homepage", url: baseUrl },
    { type: "cart", url: `${baseUrl}/cart` },
  ];

  // Add top 3 collections
  for (const coll of collections.slice(0, 3)) {
    pages.push({ type: "collection", url: `${baseUrl}/collections/${coll.handle}` });
  }

  // Add top 5 products
  for (const prod of products.slice(0, 5)) {
    pages.push({ type: "product", url: `${baseUrl}/products/${prod.handle}` });
  }

  return pages;
}

// No browser cleanup needed
export async function closeBrowser(): Promise<void> {
  // No-op for fetch-based collector
}
