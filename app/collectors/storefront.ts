/**
 * Storefront Collector (Playwright)
 *
 * Crawls storefront pages to collect:
 * - HTML content
 * - Mobile + desktop screenshots
 * - DOM structure for rule checks
 */

export interface StorefrontPage {
  url: string;
  html: string;
  mobileScreenshot: string; // File path
  desktopScreenshot: string; // File path
}

export interface StorefrontCollectorOptions {
  /** Store domain (without protocol) */
  domain: string;
  /** Storefront access token for password-protected stores */
  storefrontPassword?: string;
  /** Output directory for screenshots */
  screenshotDir: string;
}

/**
 * Collect page data via Playwright
 */
export async function collectStorefrontPage(
  url: string,
  options: StorefrontCollectorOptions
): Promise<StorefrontPage> {
  // TODO: Implement Playwright page collection
  // - Navigate to URL
  // - Wait for load
  // - Capture mobile screenshot (390px viewport)
  // - Capture desktop screenshot (1440px viewport)
  // - Get HTML content

  throw new Error(
    "Playwright integration not yet implemented. " +
    "Install playwright and configure browser."
  );
}

/**
 * Collect all audit pages for a store
 *
 * Pages sampled:
 * - Homepage
 * - 3 collections (largest by product count)
 * - 5 products (top sellers)
 * - Cart
 */
export async function collectAuditPages(
  options: StorefrontCollectorOptions,
  pages: { type: string; url: string }[]
): Promise<StorefrontPage[]> {
  const results: StorefrontPage[] = [];

  for (const page of pages) {
    try {
      const pageData = await collectStorefrontPage(page.url, options);
      results.push(pageData);
    } catch (error) {
      console.error(`Failed to collect ${page.url}:`, error);
    }
  }

  return results;
}
