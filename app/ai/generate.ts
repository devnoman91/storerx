/**
 * Single OpenAI wrapper for StoreRx
 *
 * All LLM calls go through this module.
 * Uses Structured Outputs (JSON schema) - never free-text parsing.
 * Never called inside HTTP request handlers - only in BullMQ workers.
 */

import { z } from "zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import prisma from "../db.server";

// Initialize OpenAI client (lazy)
let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

export interface GenerateOptions {
  model?: "gpt-4.1" | "gpt-4.1-mini";
  images?: string[]; // Base64 encoded images for vision
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateResult<T> {
  data: T;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Generate structured output from OpenAI
 */
export async function generate<T extends z.ZodType>(
  prompt: string,
  schema: T,
  options: GenerateOptions = {}
): Promise<GenerateResult<z.infer<T>>> {
  const {
    model = "gpt-4.1-mini",
    images,
    maxTokens = 2048,
    temperature = 0.7,
  } = options;

  const client = getClient();

  // Build messages
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (images && images.length > 0) {
    // Vision request with images
    const content: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: "text", text: prompt },
      ...images.map((img) => ({
        type: "image_url" as const,
        image_url: { url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}` },
      })),
    ];
    messages.push({ role: "user", content });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  const response = await client.chat.completions.create({
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    response_format: zodResponseFormat(schema, "response"),
  });

  const content = response.choices[0].message.content;
  if (!content) {
    throw new Error("Empty response from OpenAI");
  }

  // Parse and validate with zod
  const parsed = schema.parse(JSON.parse(content));

  return {
    data: parsed as z.infer<T>,
    usage: {
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
    },
  };
}

/**
 * USD per 1M tokens. OpenAI list prices, verified 2026-09-11 — re-check when
 * adding a model, since a stale rate here silently misreports cost.
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
};

/** Cost in cents, or null for a model with no rate on file. */
function estimateCents(
  model: string,
  usage: { promptTokens: number; completionTokens: number },
): number | null {
  const rate = MODEL_PRICING[model];
  if (!rate) return null;
  const dollars =
    (usage.promptTokens * rate.input + usage.completionTokens * rate.output) / 1_000_000;
  return dollars * 100;
}

/**
 * Log AI usage per shop for cost tracking, and count it against the shop's
 * plan allowance (FEATURES.md §11).
 */
export async function logUsage(
  shopDomain: string,
  task: string,
  model: string,
  usage: { promptTokens: number; completionTokens: number }
): Promise<void> {
  const shop = await prisma.shop.findUnique({
    where: { domain: shopDomain },
    select: { id: true },
  });
  if (!shop) return;

  await prisma.$transaction([
    prisma.aiUsage.create({
      data: {
        shopId: shop.id,
        task,
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.promptTokens + usage.completionTokens,
        estimatedCost: estimateCents(model, usage),
      },
    }),
    prisma.shop.update({
      where: { id: shop.id },
      data: { aiGenerationsUsed: { increment: 1 } },
    }),
  ]);
}

/**
 * Whether the shop has plan allowance left. Callers must check this *before*
 * generating — `logUsage` only counts what already happened.
 */
export async function hasGenerationsRemaining(shopDomain: string): Promise<boolean> {
  const shop = await prisma.shop.findUnique({
    where: { domain: shopDomain },
    select: { aiGenerationsUsed: true, aiGenerationsLimit: true },
  });
  if (!shop) return false;
  return shop.aiGenerationsUsed < shop.aiGenerationsLimit;
}
