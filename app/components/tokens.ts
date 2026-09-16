/**
 * StoreRx's visual vocabulary.
 *
 * One place that decides what a severity, a status, a remedy or a score
 * *looks* like, so the same idea never appears as two different colours or
 * icons on two screens. Everything maps onto Polaris tones and icons rather
 * than inventing a parallel palette — the exception is the score dial, which
 * has no Polaris equivalent and is documented below.
 */

import type { ScoreCategory } from "../scoring";
import type { RemedyKind } from "../remedies/types";
import type { ScanScope } from "../scans/scopes";
import type { Severity } from "../rules/types";

/** The tones Polaris accepts on a badge, a button, an icon and text alike. */
export type Tone = "info" | "success" | "caution" | "warning" | "critical" | "neutral";

/**
 * Taken from Polaris rather than typed as `string`, so a mistyped icon name is
 * a build error instead of a silently missing glyph.
 */
export type IconName = NonNullable<JSX.IntrinsicElements["s-icon"]["type"]>;

export interface Token {
  label: string;
  tone: Tone;
  icon: IconName;
}

/** Impact is always words, never a predicted percentage (project rule 3). */
export const SEVERITY: Record<Severity, Token & { rank: number; blurb: string }> = {
  high: {
    label: "High impact",
    tone: "critical",
    icon: "alert-triangle",
    rank: 0,
    blurb: "Costing you sales right now",
  },
  medium: {
    label: "Medium impact",
    tone: "warning",
    icon: "alert-circle",
    rank: 1,
    blurb: "Worth improving soon",
  },
  low: {
    label: "Low impact",
    tone: "info",
    icon: "info",
    rank: 2,
    blurb: "Polish when you have time",
  },
};

export function severityToken(severity: string) {
  return SEVERITY[severity as Severity] ?? SEVERITY.low;
}

export const sortBySeverity = (a: { severity: string }, b: { severity: string }) =>
  severityToken(a.severity).rank - severityToken(b.severity).rank;

/**
 * Where the merchant does the work. The icon is the fastest signal on a card
 * that an issue is a field to edit rather than a layout change to make.
 */
export const REMEDY: Record<RemedyKind, Token & { verb: string }> = {
  admin: { label: "Shopify admin", tone: "info", icon: "store", verb: "Edit in Shopify Admin" },
  settings: { label: "Shopify settings", tone: "info", icon: "settings", verb: "Open Shopify settings" },
  theme: { label: "Theme", tone: "neutral", icon: "paint-brush-flat", verb: "How to improve" },
  messaging: { label: "Messaging", tone: "neutral", icon: "text", verb: "See suggested approach" },
};

export function remedyToken(remedy: string) {
  return REMEDY[remedy as RemedyKind] ?? REMEDY.messaging;
}

/** Icons for the areas a merchant can scan, so the list reads at a glance. */
export const AREA_ICON: Record<ScanScope, IconName> = {
  homepage: "home",
  product: "product",
  collection: "collection",
  cart: "cart",
  seo: "search",
  images: "image",
  alt: "image-alt",
  speed: "gauge",
  checkout: "cash-dollar",
  full: "store",
};

/**
 * `scope` is where a merchant starts measuring a category, not the whole of
 * it — Conversion is also fed by the cart and checkout scans, and SEO by the
 * image ones. The button names the scan it runs so it never over-promises.
 */
export const CATEGORY: Record<ScoreCategory, { label: string; blurb: string; scope: ScanScope | null }> = {
  conversion: {
    label: "Conversion",
    blurb: "Homepage, collections, cart and checkout",
    scope: "homepage",
  },
  productPages: {
    label: "Product pages",
    blurb: "What shoppers see before they buy",
    scope: "product",
  },
  performance: {
    label: "Speed",
    blurb: "Measured by Google PageSpeed",
    scope: "speed",
  },
  seo: {
    // Fed entirely by the image checks — the SEO scan's own rules report into
    // Conversion and Product pages, so pointing here at "seo" offered a scan
    // that would not move this score at all.
    label: "SEO & images",
    blurb: "Image quality across your catalog",
    scope: "images",
  },
  ux: {
    label: "Usability",
    blurb: "No checks for this yet",
    scope: null,
  },
};

export const CATEGORY_ORDER: ScoreCategory[] = [
  "conversion",
  "productPages",
  "performance",
  "seo",
  "ux",
];

/**
 * Score bands.
 *
 * The dial is the one place StoreRx draws its own colour: Polaris has no gauge
 * component, and a bare number carries none of the "is this good?" signal a
 * merchant needs at a glance. The three values are mid-tones chosen to hold
 * contrast on both the light and dark admin backgrounds, and they are the only
 * hard-coded colours in the app — everything else uses Polaris tones.
 */
export interface ScoreBand {
  label: string;
  tone: Tone;
  colour: string;
  summary: string;
}

const BANDS: Array<ScoreBand & { min: number }> = [
  {
    min: 80,
    label: "Healthy",
    tone: "success",
    colour: "#2A845A",
    summary: "Your store is in good shape. Work through what is left when you can.",
  },
  {
    min: 50,
    label: "Needs work",
    tone: "warning",
    colour: "#B98900",
    summary: "There are real wins available here. Start with the high-impact issues.",
  },
  {
    min: 0,
    label: "Critical",
    tone: "critical",
    colour: "#C5321E",
    summary: "Several issues are likely costing you sales. The list below is in priority order.",
  },
];

export function scoreBand(score: number): ScoreBand {
  return BANDS.find((band) => score >= band.min) ?? BANDS[BANDS.length - 1];
}

/**
 * Mid grey for bars that measure something other than health — plan usage,
 * for example, where colouring "60% spent" red would be alarming rather than
 * informative. Holds contrast on both admin backgrounds.
 */
export const NEUTRAL_BAR = "#8C9196";

/**
 * A track colour from a fill colour. `opacity` cannot be used for this: it
 * applies to the whole subtree, so a dimmed track would dim the fill inside
 * it too.
 */
export function withAlpha(colour: string, alpha: number): string {
  const hex = colour.replace("#", "");
  const value = parseInt(hex, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Why a category has no score, which is never the same as scoring zero. */
export type UnmeasuredReason = "no-checks" | "not-scanned";

export const UNMEASURED: Record<UnmeasuredReason, { label: string; detail: string }> = {
  "no-checks": {
    label: "No checks yet",
    detail: "StoreRx doesn't have checks for this area yet, so it isn't scored.",
  },
  "not-scanned": {
    label: "Not measured",
    detail: "Scan this area and StoreRx will score it.",
  },
};
