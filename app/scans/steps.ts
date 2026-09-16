/**
 * What a scan does, step by step.
 *
 * The worker walks this list to report progress, and the dashboard renders the
 * same list so a merchant can see what is being checked rather than watching a
 * bar move. Both read it from here: a step the UI shows but the worker never
 * runs would leave the scan looking stuck.
 */

import { SCAN_SCOPES, type ScanScope, type StorefrontArea } from "./scopes";

export const AREA_STEP: Record<StorefrontArea, string> = {
  homepage: "Checking your homepage",
  collection: "Checking your collections",
  product: "Checking your product pages",
  cart: "Checking your cart",
};

export const AREA_ORDER: StorefrontArea[] = ["homepage", "collection", "product", "cart"];

export const IMAGES_STEP = "Reading your product images";
export const PERFORMANCE_STEP = "Measuring speed with Google PageSpeed";
export const CHECKOUT_STEP = "Checking your checkout settings";
export const ANALYSIS_STEP = "Writing recommendations";

/**
 * The ordered steps for a scope. Derived from the scope spec alone, so the
 * worker cannot run a different set than the one shown.
 */
export function planScanSteps(scope: ScanScope): string[] {
  const spec = SCAN_SCOPES[scope];
  return [
    ...AREA_ORDER.filter((area) => spec.pages.includes(area)).map((area) => AREA_STEP[area]),
    ...(spec.catalogImages ? [IMAGES_STEP] : []),
    ...(spec.performance ? [PERFORMANCE_STEP] : []),
    ...(spec.checkout ? [CHECKOUT_STEP] : []),
    ANALYSIS_STEP,
  ];
}

export type StepState = "done" | "active" | "pending";

/**
 * Where a scan has got to, from the step it last reported.
 *
 * The worker appends detail to the label it is on ("Checking your collections
 * 2/3"), so a step matches when it prefixes what was reported. An unrecognised
 * or missing step leaves everything pending rather than guessing at progress.
 */
export function stepStates(steps: string[], currentStep: string | null): StepState[] {
  const active = currentStep ? steps.findIndex((step) => currentStep.startsWith(step)) : -1;
  if (active < 0) return steps.map(() => "pending");
  return steps.map((_, index) =>
    index < active ? "done" : index === active ? "active" : "pending",
  );
}
