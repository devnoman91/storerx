/**
 * Storefront Collector (Lightweight)
 *
 * Uses fetch to get page HTML - no browser needed.
 * Screenshots handled separately via PageSpeed Insights API if needed.
 */

export interface StorefrontPage {
  url: string;
  pageType: "homepage" | "collection" | "product" | "cart";
  html: string;
  fetchedAt: Date;
}

export interface StorefrontCollectorOptions {
  domain: string;
  storefrontPassword?: string;
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
    "User-Agent": "Mozilla/5.0 (compatible; StoreRx/1.0; +https://storerx.app)",
    "Accept": "text/html,application/xhtml+xml",
  };

  // Handle password-protected stores
  if (options.storefrontPassword) {
    // Shopify uses a cookie after password submission
    // For now, we'll skip password-protected stores in MVP
  }

  const response = await fetch(url, {
    headers,
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
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
