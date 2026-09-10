/**
 * Single OpenAI wrapper for StoreRx
 *
 * All LLM calls go through this module.
 * Uses Structured Outputs (JSON schema) - never free-text parsing.
 * Never called inside HTTP request handlers - only in BullMQ workers.
 *
 * Mock mode: If OPENAI_API_KEY is not set, returns mock data for development/demo.
 */

import { z } from "zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { getMockForSchema } from "./mock";

// Check for mock mode
export const USE_MOCK_AI = !process.env.OPENAI_API_KEY;

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
  schemaName?: string; // For mock mode matching
  mockContext?: Record<string, unknown>; // Context for mock data generation
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
    schemaName,
    mockContext,
  } = options;

  // Mock mode - return fake data for development/demo
  if (USE_MOCK_AI) {
    console.warn("[AI] Running in mock mode - set OPENAI_API_KEY for real AI");
    const mockData = getMockForSchema(schemaName || "", mockContext);
    return {
      data: mockData as z.infer<T>,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

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
 * Log AI usage for cost tracking
 */
export async function logUsage(
  shopDomain: string,
  task: string,
  model: string,
  usage: { promptTokens: number; completionTokens: number }
): Promise<void> {
  // TODO: Save to AiUsage table via Prisma
  console.log(
    `[AI Usage] ${shopDomain} - ${task} (${model}): ` +
    `${usage.promptTokens}/${usage.completionTokens} tokens`
  );
}
