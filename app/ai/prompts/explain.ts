/**
 * Explain audit findings in merchant-friendly language
 */

import { z } from "zod";
import { generate, type GenerateResult } from "../generate";
import type { Finding } from "../../rules/types";

export const ExplanationSchema = z.object({
  findings: z.array(z.object({
    ruleId: z.string(),
    explanation: z.string().describe("1-2 sentence explanation of why this matters"),
    priority: z.number().min(1).max(10).describe("Priority score 1-10"),
    recommendation: z.string().describe("Specific action to fix this"),
  })),
  summary: z.string().describe("2-3 sentence overall summary"),
});

export type ExplanationResult = z.infer<typeof ExplanationSchema>;

export async function explainFindings(
  findings: Finding[],
  storeContext: { name: string; industry?: string; brandVoice?: string }
): Promise<GenerateResult<ExplanationResult>> {
  const prompt = `You are a conversion rate optimization expert explaining audit findings to a Shopify store owner.

Store: ${storeContext.name}
${storeContext.industry ? `Industry: ${storeContext.industry}` : ""}
${storeContext.brandVoice ? `Brand voice sample: ${storeContext.brandVoice}` : ""}

Audit findings to explain:
${JSON.stringify(findings, null, 2)}

For each finding:
1. Explain WHY it matters in plain language (no jargon)
2. Assign a priority score (1-10, where 10 is most urgent)
3. Give a specific, actionable recommendation

Be helpful and specific, not alarmist. Focus on impact and solutions.`;

  return generate(prompt, ExplanationSchema, { model: "gpt-4.1-mini" });
}
