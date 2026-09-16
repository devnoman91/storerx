/**
 * Turn rule findings into merchant-facing advice.
 *
 * The rules decide *what* is wrong; this decides how to say it and what the
 * merchant should do about it. StoreRx never makes the change itself, so
 * every step is written as an instruction the merchant carries out, in the
 * place their remedy points at (app/remedies).
 */

import { z } from "zod";
import { generate, type GenerateResult } from "../generate";
import { remedyForRule } from "../../remedies/catalog";
import type { RemedyKind } from "../../remedies/types";
import type { Finding } from "../../rules/types";

/**
 * Bump whenever the prompt or schema changes: cached explanations generated
 * with an older version are regenerated instead of reused.
 */
export const EXPLAIN_PROMPT_VERSION = "3";

export const ExplanationSchema = z.object({
  findings: z.array(
    z.object({
      ruleId: z.string(),
      explanation: z
        .string()
        .describe("1-2 sentences on why this costs the store sales. Plain language, no jargon."),
      recommendation: z
        .string()
        .describe("The single best solution, stated in 1-2 sentences. Not a list."),
      steps: z
        .array(z.string())
        .describe("2-5 ordered steps the merchant performs themselves. One action each."),
    }),
  ),
  summary: z.string().describe("2-3 sentence overall summary"),
});

export type ExplanationResult = z.infer<typeof ExplanationSchema>;

/** What the merchant will be doing, so the steps are written for that place. */
const REMEDY_BRIEF: Record<RemedyKind, string> = {
  admin:
    "The merchant edits this on the product or collection in Shopify admin. Steps should describe " +
    "navigating there and what to change.",
  settings:
    "The merchant changes this in their Shopify settings. Steps should name the setting and the " +
    "value to choose.",
  theme:
    "The merchant changes this in their theme editor, by adding, moving or configuring a section " +
    "or block. Steps should describe the structural change.",
  messaging:
    "This is a copy and positioning judgement. Steps should describe what to say and where to put " +
    "it, not which buttons to click.",
};

export async function explainFindings(
  findings: Finding[],
  storeContext: { name: string; industry?: string; brandVoice?: string },
): Promise<GenerateResult<ExplanationResult>> {
  // Only what the model needs. Sending whole findings leaked internal fields
  // into the prompt and invited the model to echo them back.
  const payload = findings.map((finding) => {
    const remedy = remedyForRule(finding.ruleId);
    return {
      ruleId: finding.ruleId,
      page: finding.page,
      severity: finding.severity,
      detected: finding.title,
      evidence: finding.evidence?.value,
      merchantActsIn: remedy.kind,
    };
  });

  const usedRemedies = [...new Set(payload.map((item) => item.merchantActsIn))];

  const prompt = `You are a conversion rate optimization consultant advising a Shopify store owner.

Store: ${storeContext.name}
${storeContext.industry ? `Industry: ${storeContext.industry}` : ""}
${storeContext.brandVoice ? `Brand voice sample: ${storeContext.brandVoice}` : ""}

Issues detected by the audit:
${JSON.stringify(payload, null, 2)}

For each issue, write:
1. explanation — why this costs the store sales, in plain language
2. recommendation — the single best solution, stated plainly
3. steps — 2 to 5 ordered actions the merchant performs themselves

Where each issue is acted on:
${usedRemedies.map((kind) => `- ${kind}: ${REMEDY_BRIEF[kind as RemedyKind]}`).join("\n")}

Be specific and practical, not alarmist. Recommend the best solution rather than listing options.

Hard rules — follow them even when an issue seems to invite otherwise:
- You are advising, not acting. Never say StoreRx, the app, or "we" will make, apply or publish a
  change. Every step is something the merchant does. Never write "click Fix" or imply automation.
- Never recommend converting images to WebP, AVIF, or any other format. Shopify's CDN already
  serves optimized formats and sizes automatically.
- Never state or estimate a numeric effect such as "+12% conversion" or "2x faster". Describe
  impact in words only.
- Only use numbers that appear in the issues themselves (file sizes, pixel dimensions, counts).
- Do not invent facts about the store's products, policies, shipping times or customers.`;

  return generate(prompt, ExplanationSchema, { model: "gpt-4.1-mini" });
}
