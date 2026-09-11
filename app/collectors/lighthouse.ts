/**
 * Performance Collector (Lightweight)
 *
 * Uses Google PageSpeed Insights API - no local browser needed.
 * Free API, rate limited but sufficient for store audits.
 */

import type { LighthouseMetrics, ThirdPartyScript } from "../rules/types";
import { isPasswordPage } from "./storefront";

// PageSpeed Insights API (free, no key needed for basic use)
const PSI_API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/** Lighthouse flags third-party entities blocking the main thread over this. */
const BLOCKING_TIME_THRESHOLD_MS = 250;

/** Pause before retrying a rate-limited PageSpeed request. */
const RATE_LIMIT_BACKOFF_MS = 5_000;

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
  /** null when neither strategy produced a result — not the same as 0. */
  combinedScore: number | null;
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
  // Unkeyed PSI is throttled aggressively; a key raises the quota substantially.
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (apiKey) params.set("key", apiKey);

  let response = await fetch(`${PSI_API}?${params}`);

  // 429 is common on the unkeyed quota. Back off once before giving up.
  if (response.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_BACKOFF_MS));
    response = await fetch(`${PSI_API}?${params}`);
  }

  if (!response.ok) {
    throw new Error(
      `PageSpeed API error: ${response.status}` +
        (response.status === 429 && !apiKey
          ? " (rate limited — set PAGESPEED_API_KEY to raise the quota)"
          : ""),
    );
  }

  const data = await response.json();
  const lhr = data.lighthouseResult;

  if (!lhr) {
    throw new Error("No Lighthouse result in response");
  }

  // PSI cannot log in, so on a password-protected store it measures the lock
  // screen — a near-perfect score for a page with no store on it. Refuse it,
  // so the caller records performance as unmeasured instead.
  const measured: string = lhr.finalDisplayedUrl || lhr.finalUrl || "";
  if (isPasswordPage(measured)) {
    throw new Error(`PageSpeed measured the storefront password page (${measured}), not the store`);
  }

  const audits = lhr.audits || {};

  // Third-party weight comes from `third-party-summary`, which reports real
  // transfer bytes and main-thread blocking time per entity. `bootup-time`
  // reports CPU milliseconds only — using it as a byte count is wrong.
  const thirdPartyScripts: ThirdPartyScript[] = [];
  const storeHostname = new URL(url).hostname;
  const thirdPartyItems = audits["third-party-summary"]?.details?.items || [];

  for (const item of thirdPartyItems) {
    // `entity` is a display name in newer Lighthouse, an object in older ones.
    const entity =
      typeof item.entity === "string" ? item.entity : item.entity?.text || item.entity?.url;
    const label: string = entity || item.url || "";
    if (!label || label.includes(storeHostname)) continue;

    const blockingTimeMs = Math.round(item.blockingTime || 0);
    thirdPartyScripts.push({
      url: label,
      size: Math.round(item.transferSize || 0),
      blocking: blockingTimeMs > BLOCKING_TIME_THRESHOLD_MS,
      blockingTimeMs,
      appName: matchScriptToApp(label) || (entity ? label : undefined),
    });
  }

  thirdPartyScripts.sort((a, b) => b.size - a.size);

  // Calculate weights
  let totalJsWeight = 0;
  let totalCssWeight = 0;
  let totalImageWeight = 0;

  let fontCount = 0;

  const resourceItems = audits["resource-summary"]?.details?.items || [];
  for (const item of resourceItems) {
    if (item.resourceType === "script") totalJsWeight = item.transferSize || 0;
    if (item.resourceType === "stylesheet") totalCssWeight = item.transferSize || 0;
    if (item.resourceType === "image") totalImageWeight = item.transferSize || 0;
    if (item.resourceType === "font") fontCount = item.requestCount || 0;
  }

  const renderBlockingCount =
    audits["render-blocking-resources"]?.details?.items?.length || 0;

  // INP is field-only data from CrUX; absent on low-traffic stores.
  const inpMs = data.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT_MS?.percentile;

  return {
    performanceScore: Math.round((lhr.categories?.performance?.score || 0) * 100),
    lcp: Math.round((audits["largest-contentful-paint"]?.numericValue || 0) / 1000 * 10) / 10,
    cls: Math.round((audits["cumulative-layout-shift"]?.numericValue || 0) * 100) / 100,
    inp: typeof inpMs === "number" ? Math.round(inpMs) : undefined,
    tbt: Math.round(audits["total-blocking-time"]?.numericValue || 0),
    totalJsWeight,
    totalCssWeight,
    totalImageWeight,
    renderBlockingCount,
    fontCount,
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
): number | null {
  if (mobile && desktop) {
    return Math.round(mobile.performanceScore * 0.7 + desktop.performanceScore * 0.3);
  }
  if (mobile) return mobile.performanceScore;
  if (desktop) return desktop.performanceScore;
  return null;
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
