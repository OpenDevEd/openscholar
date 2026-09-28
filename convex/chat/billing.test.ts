import { describe, expect, it } from "vitest";
import {
  getChatGenerationRetryDelayMs,
  normalizeOpenRouterGeneration,
} from "./billing";

describe("chat billing helpers", () => {
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

  it("rejects incomplete OpenRouter generation payloads", () => {
    expect(() =>
      normalizeOpenRouterGeneration({
        id: "gen_missing_cost",
        model: "google/gemini-3.1-flash-lite-preview",
      }),
    ).toThrow(/total_cost/);
  });

  it("stops retrying after the configured retry budget", () => {
    expect(getChatGenerationRetryDelayMs(0)).toBe(1_000);
    expect(getChatGenerationRetryDelayMs(6)).toBe(60_000);
    expect(getChatGenerationRetryDelayMs(7)).toBeNull();
  });
});
