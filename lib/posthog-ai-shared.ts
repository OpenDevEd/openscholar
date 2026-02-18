/**
 * Shared logic for PostHog $ai_generation payloads.
 * Used by both client (posthog-ai) and server (posthog-server).
 */

import type { AIProvider } from "./types";
import { getModelPricing } from "./ai-models";

export interface AIGenerationParams {
  provider: AIProvider;
  modelId: string;
  feature: string;
  usage: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
  input: string;
  output: string;
  isError?: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Builds the $ai_generation event properties.
 * Shared between client and server capture.
 */
export function buildAIGenerationProperties(params: AIGenerationParams): Record<string, unknown> {
  const promptTokens = params.usage.inputTokens ?? 0;
  const completionTokens = params.usage.outputTokens ?? 0;
  const pricing = getModelPricing(params.provider, params.modelId);
  const hasPricing = pricing.input > 0 || pricing.output > 0;

  // Only send cost properties when we have known pricing.
  // When omitted, PostHog auto-calculates costs from its own pricing database.
  const costProps = hasPricing
    ? {
        $ai_input_cost_usd: (promptTokens / 1_000_000) * pricing.input,
        $ai_output_cost_usd: (completionTokens / 1_000_000) * pricing.output,
        $ai_total_cost_usd:
          (promptTokens / 1_000_000) * pricing.input +
          (completionTokens / 1_000_000) * pricing.output,
      }
    : {};

  return {
    $ai_trace_id: crypto.randomUUID(),
    $ai_provider: params.provider,
    $ai_model: params.modelId,
    $ai_input_tokens: promptTokens,
    $ai_output_tokens: completionTokens,
    ...costProps,
    $ai_latency: params.latencyMs / 1000,
    $ai_is_error: params.isError ?? false,
    $ai_http_status: params.isError ? 500 : 200,
    $ai_input: [{ role: "user" as const, content: params.input }],
    $ai_output_choices: [{ role: "assistant" as const, content: params.output }],
    feature: params.feature,
    ...(params.errorMessage && { $ai_error: params.errorMessage }),
    ...(params.metadata || {}),
  };
}
