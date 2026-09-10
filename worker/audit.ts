/**
 * Audit Worker (BullMQ)
 *
 * Background job that runs store audits.
 * Never runs inside HTTP request handlers.
 *
 * Pages sampled per audit (not full crawl):
 * - Homepage
 * - 3 collections (largest by product count)
 * - 5 products (top sellers from last 30 days; fallback: newest)
 * - Cart
 * - Checkout settings (Admin API, not crawled)
 */

import { runRulesWithSummary, type Finding, type PageType } from "../app/rules";
import { calculateScore, calculateStoreHealth } from "../app/scoring";
import { collectStorefrontPage, buildAuditPageList, closeBrowser } from "../app/collectors/storefront";
import { runLighthouseAudit } from "../app/collectors/lighthouse";
import { explainFindings } from "../app/ai/prompts";
import { join } from "path";

export interface AuditJobData {
  shopDomain: string;
  auditId: string;
  accessToken: string;
}

export interface AuditJobResult {
  shopDomain: string;
  auditId: string;
  findings: Finding[];
  scores: {
    overall: number;
    conversion: number;
    ux: number;
    performance: number;
    seo: number;
    productPages: number;
  };
  pageResults: Array<{
    url: string;
    pageType: PageType;
    croScore: number;
    perfScore: number;
    findings: Finding[];
  }>;
  completedAt: Date;
}

export interface AuditProgress {
  status: "pending" | "running" | "completed" | "failed";
  currentStep: string;
  current: number;
  total: number;
  percent: number;
}

const AUDIT_STEPS = [
  { step: "Collecting store data", weight: 5 },
  { step: "Scanning homepage", weight: 15 },
  { step: "Scanning collections", weight: 20 },
  { step: "Scanning product pages", weight: 35 },
  { step: "Running performance audit", weight: 15 },
  { step: "Analyzing results", weight: 10 },
];

export async function processAuditJob(
  data: AuditJobData,
  shopData: {
    domain: string;
    products: Array<{ handle: string }>;
    collections: Array<{ handle: string }>;
    checkoutSettings: any;
    installedApps?: string[];
  },
  onProgress?: (progress: AuditProgress) => void
): Promise<AuditJobResult> {
  const { shopDomain, auditId } = data;
  const allFindings: Finding[] = [];
  const pageResults: AuditJobResult["pageResults"] = [];

  const updateProgress = (stepIndex: number, substep?: string) => {
    const step = AUDIT_STEPS[stepIndex];
    const completedWeight = AUDIT_STEPS.slice(0, stepIndex).reduce((s, t) => s + t.weight, 0);
    onProgress?.({
      status: "running",
      currentStep: substep || step.step,
      current: stepIndex + 1,
      total: AUDIT_STEPS.length,
      percent: Math.round(completedWeight),
    });
  };

  try {
    // Step 1: Build page list
    updateProgress(0);
    const pages = buildAuditPageList(
      shopDomain,
      shopData.collections,
      shopData.products
    );

    // Normalize shopData for rule context (cast to any since we only need partial data)
    const normalizedShopData = {
      ...shopData,
      installedApps: shopData.installedApps || [],
    };

    // Step 2: Scan homepage
    updateProgress(1);
    const homepageUrl = `https://${shopDomain}`;
    const homepage = await collectStorefrontPage(homepageUrl, "homepage", {
      domain: shopDomain,
    });

    const homepageRules = runRulesWithSummary("homepage", {
      html: homepage.html,
      shopData: normalizedShopData as any,
    });

    allFindings.push(...homepageRules.findings);
    pageResults.push({
      url: homepageUrl,
      pageType: "homepage",
      croScore: calculateScore(homepageRules.findings),
      perfScore: 0, // Set after Lighthouse
      findings: homepageRules.findings,
    });

    // Step 3: Scan collections
    updateProgress(2);
    const collectionPages = pages.filter((p) => p.type === "collection");
    for (let i = 0; i < collectionPages.length; i++) {
      updateProgress(2, `Scanning collection ${i + 1}/${collectionPages.length}`);
      const page = collectionPages[i];

      const collPage = await collectStorefrontPage(page.url, "collection", {
        domain: shopDomain,
      });

      const collRules = runRulesWithSummary("collection", {
        html: collPage.html,
        shopData: normalizedShopData as any,
      });

      allFindings.push(...collRules.findings);
      pageResults.push({
        url: page.url,
        pageType: "collection",
        croScore: calculateScore(collRules.findings),
        perfScore: 0,
        findings: collRules.findings,
      });
    }

    // Step 4: Scan product pages
    updateProgress(3);
    const productPages = pages.filter((p) => p.type === "product");
    for (let i = 0; i < productPages.length; i++) {
      updateProgress(3, `Scanning product ${i + 1}/${productPages.length}`);
      const page = productPages[i];

      const prodPage = await collectStorefrontPage(page.url, "product", {
        domain: shopDomain,
      });

      const prodRules = runRulesWithSummary("product", {
        html: prodPage.html,
        shopData: normalizedShopData as any,
      });

      allFindings.push(...prodRules.findings);
      pageResults.push({
        url: page.url,
        pageType: "product",
        croScore: calculateScore(prodRules.findings),
        perfScore: 0,
        findings: prodRules.findings,
      });
    }

    // Clean up browser
    await closeBrowser();

    // Step 5: Run Lighthouse on homepage
    updateProgress(4);
    const lighthouseResult = await runLighthouseAudit({ url: homepageUrl });
    const homepageIdx = pageResults.findIndex((p) => p.pageType === "homepage");
    if (homepageIdx >= 0) {
      pageResults[homepageIdx].perfScore = lighthouseResult.combinedScore;
    }

    // Step 6: Check checkout settings + calculate final scores
    updateProgress(5);
    const checkoutRules = runRulesWithSummary("checkout", {
      html: "",
      shopData: normalizedShopData as any,
    });
    allFindings.push(...checkoutRules.findings);

    // Calculate overall scores
    const storeHealth = calculateStoreHealth(allFindings);

    return {
      shopDomain,
      auditId,
      findings: allFindings,
      scores: {
        overall: storeHealth.overall,
        conversion: storeHealth.categories.find((c) => c.category === "conversion")?.score || 0,
        ux: storeHealth.categories.find((c) => c.category === "ux")?.score || 0,
        performance: lighthouseResult.combinedScore,
        seo: storeHealth.categories.find((c) => c.category === "seo")?.score || 0,
        productPages: storeHealth.categories.find((c) => c.category === "productPages")?.score || 0,
      },
      pageResults,
      completedAt: new Date(),
    };
  } catch (error) {
    await closeBrowser();
    onProgress?.({
      status: "failed",
      currentStep: "Error",
      current: 0,
      total: AUDIT_STEPS.length,
      percent: 0,
    });
    throw error;
  }
}
