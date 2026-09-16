/**
 * The loop StoreRx runs, in four steps.
 *
 * Shown to a merchant who has not scanned yet and on the help page, because
 * the single thing the product has to get across is who does what: StoreRx
 * finds and explains, the merchant changes, StoreRx verifies.
 */

import type { IconName } from "./tokens";

const STEPS: Array<{ icon: IconName; title: string; detail: string }> = [
  {
    icon: "search",
    title: "Examine",
    detail: "StoreRx checks one area of your store at a time, against a fixed list of checks.",
  },
  {
    icon: "clipboard-checklist",
    title: "Diagnose",
    detail: "It shows what it found, the evidence for it, and why it costs you sales.",
  },
  {
    icon: "wand",
    title: "Recommend",
    detail: "You get one recommended treatment and the steps to carry it out.",
  },
  {
    icon: "check-circle",
    title: "Verify",
    detail: "You make the change. Scan that area again and StoreRx confirms it.",
  },
];

export function HowItWorks({ heading }: { heading?: string }) {
  return (
    <s-stack direction="block" gap="base">
      {heading && <s-heading>{heading}</s-heading>}
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
        {STEPS.map((step, index) => (
          <s-stack key={step.title} direction="block" gap="small-300">
            <s-stack direction="inline" gap="small-300" alignItems="center">
              <s-icon type={step.icon} tone="info" size="base" />
              <s-text type="strong">
                {index + 1}. {step.title}
              </s-text>
            </s-stack>
            <s-text color="subdued">{step.detail}</s-text>
          </s-stack>
        ))}
      </s-grid>
    </s-stack>
  );
}
