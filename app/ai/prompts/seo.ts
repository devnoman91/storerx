/**
 * Generate SEO title and meta description
 */

import { z } from "zod";
import { generate, type GenerateResult } from "../generate";

export const SeoSchema = z.object({
  title: z.string().max(60).describe("SEO title, max 60 characters"),
  metaDescription: z.string().max(160).describe("Meta description, max 160 characters"),
});

export type SeoResult = z.infer<typeof SeoSchema>;

export interface SeoContext {
  productTitle: string;
  productType?: string;
  vendor?: string;
  storeName: string;
  currentTitle?: string;
  currentMeta?: string;
}

export async function generateSeo(
  context: SeoContext
): Promise<GenerateResult<SeoResult>> {
  const prompt = `Generate SEO metadata for a product page.

Product: ${context.productTitle}
Store: ${context.storeName}
${context.vendor ? `Brand: ${context.vendor}` : ""}
${context.productType ? `Category: ${context.productType}` : ""}

${context.currentTitle ? `Current title: ${context.currentTitle}` : ""}
${context.currentMeta ? `Current meta: ${context.currentMeta}` : ""}

Requirements:
- Title: max 60 characters, include product name and key benefit
- Meta description: max 160 characters, compelling and action-oriented
- Include brand name if space allows
- Do NOT stuff keywords unnaturally`;

  return generate(prompt, SeoSchema, { model: "gpt-4.1-mini" });
}
