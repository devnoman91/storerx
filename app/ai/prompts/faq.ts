/**
 * Generate FAQ section
 */

import { z } from "zod";
import { generate, type GenerateResult } from "../generate";

export const FaqSchema = z.object({
  questions: z.array(z.object({
    question: z.string(),
    answer: z.string(),
  })).min(5).max(8),
});

export type FaqResult = z.infer<typeof FaqSchema>;

export interface FaqContext {
  productTitle: string;
  productDescription: string;
  productType?: string;
  variants?: string[];
  tags?: string[];
}

export async function generateFaq(
  context: FaqContext
): Promise<GenerateResult<FaqResult>> {
  const prompt = `Generate FAQ questions and answers for a product page.

Product: ${context.productTitle}
${context.productType ? `Category: ${context.productType}` : ""}
${context.variants?.length ? `Variants: ${context.variants.join(", ")}` : ""}

Description:
${context.productDescription}

Generate 5-8 relevant FAQ items covering:
- Product features and specifications
- Sizing/dimensions if applicable
- Care instructions if applicable
- Shipping and returns (general)
- Compatibility or usage

Keep answers concise (1-3 sentences). Be helpful and accurate.`;

  return generate(prompt, FaqSchema, { model: "gpt-4.1-mini" });
}
