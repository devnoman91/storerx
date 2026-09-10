/**
 * Performance Collector (Lightweight)
 *
 * Uses Google PageSpeed Insights API - no local browser needed.
 * Free API, rate limited but sufficient for store audits.
 */

import type { LighthouseMetrics, ThirdPartyScript } from "../rules/types";

// PageSpeed Insights API (free, no key needed for basic use)
const PSI_API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

// Known app script patterns
const APP_SCRIPT_MAP: Record<string, string> = {
  "klaviyo.com": "Klaviyo",
  "yotpo.com": "Yotpo",
  "judgeme.com": "Judge.me",
  "loox.io": "Loox",
  "stamped.io": "Stamped",
  "okendo.io": "Okendo",
  "gorgias.io": "Gorgias",
  "tidio.com": "Tidio",
  "omnisend.com": "Omnisend",
  "smile.io": "Smile.io",
  "trustpilot.com": "Trustpilot",
  "privy.com": "Privy",
  "hotjar.com": "Hotjar",
  "googletagmanager.com": "Google Tag Manager",
  "google-analytics.com": "Google Analytics",
  "facebook.net": "Meta Pixel",
  "tiktok.com": "TikTok Pixel",
};

export function matchScriptToApp(scriptUrl: string): string | undefined {
  for (const [pattern, name] of Object.entries(APP_SCRIPT_MAP)) {
    if (scriptUrl.includes(pattern)) return name;
  }
  return undefined;
}

export interface LighthouseResult {
  mobile?: LighthouseMetrics;
  desktop?: LighthouseMetrics;
  combinedScore: number;
  screenshot?: string;
}

/**
 * Run PageSpeed Insights audit
 */
async function runPSIAudit(
  url: string,
  strategy: "mobile" | "desktop"
): Promise<LighthouseMetrics> {
  const params = new URLSearchParams({
    url,
    strategy,
    category: "performance",
  });

  const response = await fetch(`${PSI_API}?${params}`);

  if (!response.ok) {
    throw new Error(`PageSpeed API error: ${response.status}`);
  }

  const data = await response.json();
  const lhr = data.lighthouseResult;

  if (!lhr) {
    throw new Error("No Lighthouse result in response");
  }

  const audits = lhr.audits || {};

  // Extract third-party scripts
  const thirdPartyScripts: ThirdPartyScript[] = [];
  const bootupItems = audits["bootup-time"]?.details?.items || [];

  for (const item of bootupItems) {
    if (item.url && !item.url.includes(new URL(url).hostname)) {
      thirdPartyScripts.push({
        url: item.url,
        size: Math.round(item.total || 0),
        blocking: (item.scripting || 0) > 100,
        appName: matchScriptToApp(item.url),
      });
    }
  }

  // Calculate weights
  let totalJsWeight = 0;
  let totalCssWeight = 0;
  let totalImageWeight = 0;

  const resourceItems = audits["resource-summary"]?.details?.items || [];
  for (const item of resourceItems) {
    if (item.resourceType === "script") totalJsWeight = item.transferSize || 0;
    if (item.resourceType === "stylesheet") totalCssWeight = item.transferSize || 0;
    if (item.resourceType === "image") totalImageWeight = item.transferSize || 0;
  }

  return {
    performanceScore: Math.round((lhr.categories?.performance?.score || 0) * 100),
    lcp: Math.round((audits["largest-contentful-paint"]?.numericValue || 0) / 1000 * 10) / 10,
    cls: Math.round((audits["cumulative-layout-shift"]?.numericValue || 0) * 100) / 100,
    inp: Math.round(audits["experimental-interaction-to-next-paint"]?.numericValue || 0),
    tbt: Math.round(audits["total-blocking-time"]?.numericValue || 0),
    totalJsWeight,
    totalCssWeight,
    totalImageWeight,
    thirdPartyScripts,
  };
}

export async function runLighthouseAudit(options: {
  url: string;
  mobile?: boolean;
  desktop?: boolean;
}): Promise<LighthouseResult> {
  const { url, mobile = true, desktop = false } = options;

  let mobileMetrics: LighthouseMetrics | undefined;
  let desktopMetrics: LighthouseMetrics | undefined;

  try {
    if (mobile) {
      mobileMetrics = await runPSIAudit(url, "mobile");
    }
  } catch (error) {
    console.error("Mobile PSI failed:", error);
  }

  try {
    if (desktop) {
      desktopMetrics = await runPSIAudit(url, "desktop");
    }
  } catch (error) {
    console.error("Desktop PSI failed:", error);
  }

  return {
    mobile: mobileMetrics,
    desktop: desktopMetrics,
    combinedScore: calculateCombinedScore(mobileMetrics, desktopMetrics),
  };
}

export function calculateCombinedScore(
  mobile?: LighthouseMetrics,
  desktop?: LighthouseMetrics
): number {
  if (mobile && desktop) {
    return Math.round(mobile.performanceScore * 0.7 + desktop.performanceScore * 0.3);
  }
  if (mobile) return mobile.performanceScore;
  if (desktop) return desktop.performanceScore;
  return 0;
}

/**
 * Quick mobile-only perf check
 */
export async function quickPerfCheck(url: string): Promise<LighthouseMetrics | null> {
  try {
    return await runPSIAudit(url, "mobile");
  } catch (error) {
    console.error("Quick perf check failed:", error);
    return null;
  }
}
