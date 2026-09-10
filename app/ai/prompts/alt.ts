/**
 * Generate image alt text
 */

import { z } from "zod";
import { generate, type GenerateResult } from "../generate";

export const AltTextSchema = z.object({
  altText: z.string().max(125).describe("Descriptive alt text, max 125 characters"),
});

export type AltTextResult = z.infer<typeof AltTextSchema>;

export async function generateAltText(
  imageBase64: string,
  productTitle: string,
  productContext?: string
): Promise<GenerateResult<AltTextResult>> {
  const prompt = `Generate alt text for this product image.

Product: ${productTitle}
${productContext ? `Context: ${productContext}` : ""}

Requirements:
- Max 125 characters
- Describe what's visible in the image
- Include product name naturally
- Be specific (color, angle, features visible)
- Do NOT start with "Image of" or "Picture of"`;

  return generate(prompt, AltTextSchema, {
    model: "gpt-4.1-mini",
    images: [imageBase64],
    schemaName: "AltTextSchema",
    mockContext: { productTitle },
  });
}
