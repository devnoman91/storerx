/**
 * Mock AI responses for development/demo mode
 * Used when OPENAI_API_KEY is not set
 */

import type { ExplanationResult } from "./prompts/explain";
import type { DescriptionResult } from "./prompts/description";
import type { SeoResult } from "./prompts/seo";
import type { AltTextResult } from "./prompts/alt";
import type { FaqResult } from "./prompts/faq";

// Rule explanations for common issues
const RULE_EXPLANATIONS: Record<string, { explanation: string; priority: number; recommendation: string }> = {
  "prod.reviews.fold": {
    explanation: "Reviews build trust and help customers make purchase decisions. When reviews are hidden below the fold, visitors may leave before seeing social proof.",
    priority: 9,
    recommendation: "Move your reviews widget above the fold, ideally near the add-to-cart button.",
  },
  "prod.desc.short": {
    explanation: "Short product descriptions don't answer customer questions and hurt your SEO rankings. Detailed descriptions increase conversion.",
    priority: 7,
    recommendation: "Expand your descriptions to 100-200 words, focusing on benefits and key features.",
  },
  "prod.trust.badges": {
    explanation: "Trust badges reduce purchase anxiety by reassuring customers about security, guarantees, and shipping policies.",
    priority: 6,
    recommendation: "Add trust badges near your add-to-cart button showing secure checkout, money-back guarantee, or free shipping.",
  },
  "prod.faq": {
    explanation: "FAQ sections answer common questions before they become objections, reducing support inquiries and increasing confidence.",
    priority: 5,
    recommendation: "Add a FAQ section with 5-8 questions about sizing, shipping, returns, and product care.",
  },
  "img.alt": {
    explanation: "Missing alt text hurts SEO and accessibility. Search engines use alt text to understand images, and screen readers need it for visually impaired visitors.",
    priority: 6,
    recommendation: "Add descriptive alt text to all product images describing what's shown.",
  },
  "cart.shipping.bar": {
    explanation: "Free shipping thresholds with progress bars encourage customers to add more items to their cart, increasing average order value.",
    priority: 5,
    recommendation: "Add a free shipping progress bar showing how much more the customer needs to spend.",
  },
};

export function getMockExplanation(ruleId: string): { explanation: string; priority: number; recommendation: string } {
  return RULE_EXPLANATIONS[ruleId] || {
    explanation: "This issue may be affecting your conversion rate. Addressing it could improve customer experience.",
    priority: 5,
    recommendation: "Review this finding and consider implementing the suggested fix.",
  };
}

export function getMockExplanationResult(findings: Array<{ ruleId: string; title: string }>): ExplanationResult {
  return {
    findings: findings.map((f) => {
      const mock = getMockExplanation(f.ruleId);
      return {
        ruleId: f.ruleId,
        explanation: mock.explanation,
        priority: mock.priority,
        recommendation: mock.recommendation,
      };
    }),
    summary: `Found ${findings.length} issues to address. Focus on high-priority items first for maximum impact on your conversion rate.`,
  };
}

export function getMockDescription(productTitle: string): DescriptionResult {
  return {
    description: `<p>Discover the exceptional quality of the <strong>${productTitle}</strong>. Crafted with attention to detail and designed for everyday use, this product combines style with functionality.</p>
<p>Key features include premium materials, thoughtful design, and lasting durability. Perfect for those who appreciate quality without compromise.</p>
<p>Whether you're looking for reliability, comfort, or style, the ${productTitle} delivers on all fronts. Add it to your collection today.</p>`,
    highlights: [
      "Premium quality materials",
      "Thoughtfully designed for everyday use",
      "Built to last with exceptional durability",
      "Perfect balance of style and function",
    ],
  };
}

export function getMockSeo(productTitle: string, storeName: string): SeoResult {
  const title = `${productTitle} | ${storeName}`.slice(0, 60);
  return {
    title,
    metaDescription: `Shop ${productTitle} at ${storeName}. Premium quality, fast shipping, and hassle-free returns. Order yours today!`.slice(0, 160),
  };
}

export function getMockAltText(productTitle: string): AltTextResult {
  return {
    altText: `${productTitle} - product image showing details and features`.slice(0, 125),
  };
}

export function getMockFaq(productTitle: string): FaqResult {
  return {
    questions: [
      {
        question: `What are the key features of the ${productTitle}?`,
        answer: "This product features premium materials, thoughtful design, and exceptional durability built to last.",
      },
      {
        question: "What is your shipping policy?",
        answer: "We offer fast shipping on all orders. Most orders ship within 1-2 business days and arrive within 3-7 days.",
      },
      {
        question: "What is your return policy?",
        answer: "We offer hassle-free returns within 30 days of purchase. Items must be in original condition with tags attached.",
      },
      {
        question: "How do I care for this product?",
        answer: "Follow the care instructions provided with your purchase. For best results, store in a cool, dry place.",
      },
      {
        question: "Do you offer international shipping?",
        answer: "Yes, we ship to most countries worldwide. International shipping times and rates vary by location.",
      },
    ],
  };
}

// Generic mock that tries to match schema structure
export function getMockForSchema(schemaName: string, context?: Record<string, unknown>): unknown {
  switch (schemaName) {
    case "ExplanationSchema":
      return getMockExplanationResult((context?.findings as Array<{ ruleId: string; title: string }>) || []);
    case "DescriptionSchema":
      return getMockDescription((context?.productTitle as string) || "Product");
    case "SeoSchema":
      return getMockSeo((context?.productTitle as string) || "Product", (context?.storeName as string) || "Store");
    case "AltTextSchema":
      return getMockAltText((context?.productTitle as string) || "Product");
    case "FaqSchema":
      return getMockFaq((context?.productTitle as string) || "Product");
    default:
      return {};
  }
}
