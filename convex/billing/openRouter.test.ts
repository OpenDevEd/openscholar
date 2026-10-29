import { describe, expect, it } from "vitest";
import {
  getGenerationRetryDelayMs,
  normalizeOpenRouterGeneration,
} from "./openRouter";

describe("OpenRouter billing helpers", () => {
  it("normalizes OpenRouter generation payloads using native token counts when present", () => {
    expect(
      normalizeOpenRouterGeneration({
        id: "gen_789",
        model: "google/gemini-3.1-flash-lite-preview",
        provider_name: "Google AI Studio",
        cancelled: false,
        finish_reason: "stop",
        native_finish_reason: "STOP",
        tokens_prompt: 9,
        tokens_completion: 2,
        native_tokens_prompt: 8,
        native_tokens_completion: 1,
        native_tokens_reasoning: 4,
        native_tokens_cached: 7,
        total_cost: 0.0000035,
      }),
    ).toEqual({
      generationId: "gen_789",
      model: "google/gemini-3.1-flash-lite-preview",
      providerName: "Google AI Studio",
      cancelled: false,
      finishReason: "stop",
      nativeFinishReason: "STOP",
      promptTokens: 8,
      completionTokens: 1,
      reasoningTokens: 4,
      cachedPromptTokens: 7,
      totalCostUsd: 0.0000035,
    });
  });

  // A reply stopped or failed mid-stream is settled from its generation record. On our own provider key its
  // `total_cost` is OpenRouter's fee alone, so the provider's charge is added; on OpenRouter's credits it's all of it.
  it("charges a stopped reply on our own key what the provider billed", () => {
    const base = { id: "gen_1", model: "anthropic/claude-haiku-5.5", native_tokens_prompt: 100, native_tokens_completion: 10 };
    expect(normalizeOpenRouterGeneration({ ...base, total_cost: 0, upstream_inference_cost: 0.01, is_byok: true }).totalCostUsd).toBeCloseTo(0.01, 9);
    expect(normalizeOpenRouterGeneration({ ...base, total_cost: 0.0000293, upstream_inference_cost: 0.0000293, is_byok: false }).totalCostUsd).toBeCloseTo(0.0000293, 12);
  });

  it("rejects incomplete OpenRouter generation payloads", () => {
    expect(() =>
      normalizeOpenRouterGeneration({
        id: "gen_missing_cost",
        model: "google/gemini-3.1-flash-lite-preview",
      }),
    ).toThrow(/total_cost/);
  });

  it("stops retrying after the configured retry budget", () => {
    expect(getGenerationRetryDelayMs(0)).toBe(1_000);
    expect(getGenerationRetryDelayMs(6)).toBe(60_000);
    expect(getGenerationRetryDelayMs(7)).toBeNull();
  });
});
