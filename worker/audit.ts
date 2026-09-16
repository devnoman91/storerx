/**
 * Scan runner.
 *
 * Runs one scan scope (app/scans/scopes.ts): fetches only what that scope
 * needs, runs only its rules, and reports exactly which rules ran and which
 * storefront pages were fetched — the issue list is only updated for what was
 * actually checked. Never runs inside HTTP request handlers.
 *
 * Pages are sampled, not crawled: the homepage, the 3 largest collections and
 * 5 products. Store scores are not computed here; they are recomputed from
 * the shop's open issues when the scan is recorded (app/issues/store.server.ts).
 */

import {
  CATALOG_IMAGE_RULE_IDS,
  checkCatalogImages,
  runRulesDetailed,
  type Finding,
  type PageType,
  type ShopData,
} from "../app/rules";
import type { CatalogImages } from "../app/collectors/images";
import { SCAN_SCOPES, type ScanScope, type StorefrontArea } from "../app/scans/scopes";
import { calculateScore } from "../app/scoring";
import {
  buildAuditPageList,
  closeBrowser,
  collectStorefrontPage,
  type AuditPage,
} from "../app/collectors/storefront";
import { runLighthouseAudit, type LighthouseResult } from "../app/collectors/lighthouse";
import { NonRetryableError } from "../app/errors";

export interface AuditJobData {
  shopDomain: string;
  auditId: string;
  scope: ScanScope;
}

export interface AuditJobResult {
  findings: Finding[];
  /** Lighthouse score, when this scan measured one. */
  performanceScore: number | null;
  pageResults: Array<{
    url: string;
    pageType: PageType;
    croScore: number;
    /** null when Lighthouse did not run for this page. */
    perfScore: number | null;
    findings: Finding[];
  }>;
  /** Rules that ran to completion — the only rules whose issues this scan can resolve. */
  evaluatedRules: string[];
  /** Storefront pages fetched in this scan. */
  scannedUrls: string[];
  completedAt: Date;
}

export interface AuditProgress {
  status: "pending" | "running" | "completed" | "failed";
  currentStep: string;
  current: number;
  total: number;
  percent: number;
}

export interface AuditJobOptions {
  /** Cookie from openStorefrontSession, when the storefront is password-protected. */
  storefrontCookie?: string;
  /**
   * Reads catalog image metadata. A callback rather than an Admin client so
   * the fetch happens inside its own progress step.
   */
  collectImages?: () => Promise<CatalogImages>;
}

const AREA_STEP: Record<StorefrontArea, string> = {
  homepage: "Scanning homepage",
  collection: "Scanning collections",
  product: "Scanning product pages",
  cart: "Scanning cart",
};

const AREA_ORDER: StorefrontArea[] = ["homepage", "collection", "product", "cart"];

/**
 * Record where a page's findings were detected: the storefront URL for the
 * merchant, and the admin GID of the product or collection behind it so the
 * issue can offer a working "Edit in Shopify Admin" link.
 */
function atPage(findings: Finding[], pageUrl: string, resourceId?: string): Finding[] {
  return findings.map((finding) => ({
    ...finding,
    pageUrl,
    adminRef: finding.adminRef ?? resourceId,
  }));
}

export async function processAuditJob(
  data: AuditJobData,
  shopData: ShopData,
  onProgress?: (progress: AuditProgress) => void,
  options: AuditJobOptions = {},
): Promise<AuditJobResult> {
  const { shopDomain, scope } = data;
  const spec = SCAN_SCOPES[scope];
  const include = spec.includesRule;
  const collectorOptions = { domain: shopDomain, cookie: options.storefrontCookie };
  const homepageUrl = `https://${shopDomain}`;

  const findings: Finding[] = [];
  const pageResults: AuditJobResult["pageResults"] = [];
  const evaluated = new Set<string>();
  const scannedUrls: string[] = [];

  // Progress steps follow the scope, so a homepage-only scan does not sit at
  // 20% while skipping steps it never runs.
  const areas = AREA_ORDER.filter((area) => spec.pages.includes(area));
  const steps = [
    ...areas.map((area) => AREA_STEP[area]),
    ...(spec.catalogImages && options.collectImages ? ["Scanning product images"] : []),
    ...(spec.performance ? ["Running performance audit"] : []),
    ...(spec.checkout ? ["Checking checkout settings"] : []),
    "Analyzing results",
  ];
  const progress = (step: string, detail?: string) => {
    const index = Math.max(steps.indexOf(step), 0);
    onProgress?.({
      status: "running",
      currentStep: detail ?? step,
      current: index + 1,
      total: steps.length,
      percent: Math.round((index / steps.length) * 100),
    });
  };

  try {
    // Storefront pages for the requested areas.
    const sampled = buildAuditPageList(shopDomain, shopData.collections, shopData.products);
    for (const area of areas) {
      const targets: AuditPage[] =
        area === "homepage"
          ? [{ type: "homepage", url: homepageUrl }]
          : sampled.filter((page) => page.type === area);

      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        progress(
          AREA_STEP[area],
          targets.length > 1 ? `${AREA_STEP[area]} ${i + 1}/${targets.length}` : undefined,
        );
        const page = await collectStorefrontPage(target.url, area, collectorOptions);
        const run = runRulesDetailed(area, { html: page.html, shopData }, include);

        scannedUrls.push(target.url);
        run.evaluated.forEach((ruleId) => evaluated.add(ruleId));
        const pageFindings = atPage(run.findings, target.url, target.resourceId);
        findings.push(...pageFindings);
        pageResults.push({
          url: target.url,
          pageType: area,
          croScore: calculateScore(run.findings),
          perfScore: null,
          findings: pageFindings,
        });
      }
    }

    // Catalog images: Admin API metadata only, covering the whole catalog up
    // to the scan cap rather than just the sampled product pages.
    if (spec.catalogImages && options.collectImages) {
      progress("Scanning product images");
      const catalog = await options.collectImages();
      findings.push(...checkCatalogImages(catalog.products).filter((f) => include(f.ruleId)));
      CATALOG_IMAGE_RULE_IDS.filter(include).forEach((ruleId) => evaluated.add(ruleId));
      const images = catalog.products.reduce((n, p) => n + p.images.length, 0);
      progress(
        "Scanning product images",
        `Checked ${images} images across ${catalog.products.length} of ${catalog.totalProducts} products`,
      );
    }

    // PageSpeed runs on Google's servers and cannot use our storefront login,
    // so a password-protected store can only ever be measured as its lock
    // screen. Say so rather than reporting a meaningless speed score.
    let lighthouse: LighthouseResult = { combinedScore: null };
    if (spec.performance) {
      progress("Running performance audit");
      if (shopData.passwordProtected) {
        throw new NonRetryableError(
          "Google PageSpeed can only measure a storefront that is open to the public, and yours " +
            "is password-protected. Remove the storefront password, then run the speed scan again.",
        );
      }
      lighthouse = await runLighthouseAudit({
        url: homepageUrl,
        mobile: true,
        // Desktop doubles the PSI calls; without a key the unkeyed quota trips.
        desktop: Boolean(process.env.PAGESPEED_API_KEY),
      });
      if (lighthouse.mobile) {
        const run = runRulesDetailed("perf", { html: "", shopData, lighthouse: lighthouse.mobile }, include);
        run.evaluated.forEach((ruleId) => evaluated.add(ruleId));
        findings.push(...run.findings);
        pageResults.push({
          url: homepageUrl,
          pageType: "perf",
          croScore: 0,
          perfScore: lighthouse.combinedScore,
          findings: run.findings,
        });
        const home = pageResults.find((p) => p.pageType === "homepage");
        if (home) home.perfScore = lighthouse.combinedScore;
      } else {
        console.warn("[audit] Lighthouse unavailable — performance left unmeasured");
      }
    }

    if (spec.checkout) {
      progress("Checking checkout settings");
      const run = runRulesDetailed("checkout", { html: "", shopData }, include);
      run.evaluated.forEach((ruleId) => evaluated.add(ruleId));
      findings.push(...run.findings);
    }

    progress("Analyzing results");
    return {
      findings,
      performanceScore: lighthouse.combinedScore,
      pageResults,
      evaluatedRules: [...evaluated],
      scannedUrls,
      completedAt: new Date(),
    };
  } catch (error) {
    onProgress?.({ status: "failed", currentStep: "Error", current: 0, total: steps.length, percent: 0 });
    throw error;
  } finally {
    await closeBrowser();
  }
}
