/**
 * Single OpenAI wrapper for StoreRx
 *
 * All LLM calls go through this module.
 * Uses Structured Outputs (JSON schema) - never free-text parsing.
 * Never called inside HTTP request handlers - only in BullMQ workers.
 */

import { z } from "zod";

// Types for the generate function
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
 *
 * @param prompt - The prompt to send
 * @param schema - Zod schema for the expected output
 * @param options - Generation options
 * @returns Parsed and validated response
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

  // TODO: Implement actual OpenAI call with structured outputs
  // For now, throw to indicate not implemented
  throw new Error(
    "OpenAI integration not yet implemented. " +
    "Install openai package and add OPENAI_API_KEY to env."
  );
}

/**
 * Log AI usage for cost tracking
 */
export async function logUsage(
  shopDomain: string,
  task: string,
  usage: { promptTokens: number; completionTokens: number }
): Promise<void> {
  // TODO: Log to AiUsage table in database
  console.log(`[AI Usage] ${shopDomain} - ${task}: ${usage.promptTokens + usage.completionTokens} tokens`);
}
