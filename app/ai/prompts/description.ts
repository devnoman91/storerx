/**
 * Generate product descriptions
 */

import { z } from "zod";
import { generate, type GenerateResult } from "../generate";

export const DescriptionSchema = z.object({
  description: z.string().describe("HTML product description, 100-200 words"),
  highlights: z.array(z.string()).describe("3-5 key selling points"),
});

export type DescriptionResult = z.infer<typeof DescriptionSchema>;

export interface ProductContext {
  title: string;
  currentDescription?: string;
  variants: Array<{ title: string; price: string }>;
  tags?: string[];
  vendor?: string;
  productType?: string;
}

export async function generateDescription(
  product: ProductContext,
  brandVoice?: string
): Promise<GenerateResult<DescriptionResult>> {
  const prompt = `Generate a compelling product description for an e-commerce store.

Product: ${product.title}
${product.vendor ? `Brand: ${product.vendor}` : ""}
${product.productType ? `Category: ${product.productType}` : ""}
${product.tags?.length ? `Tags: ${product.tags.join(", ")}` : ""}
Variants: ${product.variants.map(v => `${v.title} ($${v.price})`).join(", ")}

${product.currentDescription ? `Current description (improve this):\n${product.currentDescription}` : ""}

${brandVoice ? `Write in this brand voice:\n${brandVoice}` : "Write in a professional, friendly tone."}

Requirements:
- 100-200 words
- Use HTML formatting (paragraphs, bullet points if needed)
- Focus on benefits, not just features
- Include a clear value proposition
- No fluff or filler phrases`;

  return generate(prompt, DescriptionSchema, {
    model: "gpt-4.1",
    schemaName: "DescriptionSchema",
    mockContext: { productTitle: product.title },
  });
}
