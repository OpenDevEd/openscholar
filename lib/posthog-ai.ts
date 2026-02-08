import posthog from "posthog-js";
import type { AIProvider } from "@/lib/types";
import { getModelPricing } from "@/lib/ai-models";

interface AIGenerationParams {
  provider: AIProvider;
  modelId: string;
  feature: string;
  usage: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
  input: string;
  output: string;
  isError?: boolean;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export function captureAIGeneration(params: AIGenerationParams): void {
  const promptTokens = params.usage.inputTokens ?? 0;
  const completionTokens = params.usage.outputTokens ?? 0;
  const pricing = getModelPricing(params.provider, params.modelId);
  const hasPricing = pricing.input > 0 || pricing.output > 0;

  // Only send cost properties when we have known pricing.
  // When omitted, PostHog auto-calculates costs from its own pricing database
  // using $ai_model + token counts (e.g. for OpenRouter models).
  const costProps = hasPricing
    ? {
        $ai_input_cost_usd: (promptTokens / 1_000_000) * pricing.input,
        $ai_output_cost_usd: (completionTokens / 1_000_000) * pricing.output,
        $ai_total_cost_usd:
          (promptTokens / 1_000_000) * pricing.input +
          (completionTokens / 1_000_000) * pricing.output,
      }
    : {};

  posthog.capture("$ai_generation", {
    $ai_provider: params.provider,
    $ai_model: params.modelId,
    $ai_input_tokens: promptTokens,
    $ai_output_tokens: completionTokens,
    ...costProps,
    $ai_latency: params.latencyMs / 1000,
    $ai_is_error: params.isError ?? false,
    $ai_http_status: params.isError ? 500 : 200,
    $ai_input: [{ role: "user", content: params.input }],
    $ai_output_choices: [{ role: "assistant", content: params.output }],
    feature: params.feature,
    ...(params.errorMessage && { error_message: params.errorMessage }),
    ...(params.metadata || {}),
  });
}
