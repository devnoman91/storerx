/**
 * Draft FAQ entries for a product page.
 *
 * The merchant pastes each question and answer into their theme's collapsible
 * content blocks or the product description. Answers may only use facts
 * from the product data given — a FAQ that invents a return window or a
 * material is worse than none.
 */

import { z } from "zod";
import { generate, type GenerateResult } from "../generate";

export const FaqSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().describe("A question a shopper would ask, under 100 characters"),
        answer: z.string().describe("1-3 sentences, using only facts from the product data"),
      }),
    )
    // Not min(3): a thin product may only support one honest answer, and a
    // floor would push the model to invent the rest.
    .min(1)
    .max(6),
});

export type FaqResult = z.infer<typeof FaqSchema>;

export interface FaqContext {
  productTitle: string;
  productDescription: string;
  productType?: string;
  vendor?: string;
  variants?: string[];
  tags?: string[];
}

export async function generateFaq(
  context: FaqContext,
  brandVoice?: string,
): Promise<GenerateResult<FaqResult>> {
  const prompt = `You are an ecommerce copywriter. Draft FAQ entries for this product page.

Product: ${context.productTitle}
${context.vendor ? `Brand: ${context.vendor}` : ""}
${context.productType ? `Category: ${context.productType}` : ""}
${context.variants?.length ? `Variants: ${context.variants.join(", ")}` : ""}
${context.tags?.length ? `Tags: ${context.tags.join(", ")}` : ""}

Description:
${context.productDescription || "(none)"}

${brandVoice ? `Write in this brand voice:\n${brandVoice}` : "Write in a clear, friendly tone."}

Requirements:
- Up to 6 questions a shopper deciding whether to buy would ask: what it is, sizing or dimensions, materials, care, what's included, which variant to pick
- Answer only from the product data above. Never invent materials, dimensions, certifications, reviews, shipping times or return policies
- If the data can't answer a question, leave that question out rather than guessing
- Questions under 100 characters; answers 1-3 sentences, plain text`;

  return generate(prompt, FaqSchema, { model: "gpt-4.1-mini" });
}
