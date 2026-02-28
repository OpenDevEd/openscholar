import { describe, expect, it } from "vitest";
import { calculateCostInDollars, aggregateUsage } from "../lib/ai/core/cost";
import type { Usage } from "../lib/ai/core/types";
import type { AIProvider } from "../lib/types/ai.types";

describe("calculateCostInDollars", () => {
  const providerCases = [
    {
      provider: "openai" as AIProvider,
      modelId: "gpt-5-nano",
      inputPrice: 0.05,
      outputPrice: 0.4,
    },
    {
      provider: "anthropic" as AIProvider,
      modelId: "claude-3-haiku",
      inputPrice: 0.25,
      outputPrice: 1.25,
    },
    {
      provider: "google" as AIProvider,
      modelId: "gemini-2.0-flash",
      inputPrice: 0.1,
      outputPrice: 0.4,
    },
    {
      provider: "deepseek" as AIProvider,
      modelId: "deepseek-chat",
      inputPrice: 0.14,
      outputPrice: 0.28,
    },
  ];

  it.each(providerCases)(
    "returns correct cost for $provider / $modelId",
    ({ provider, modelId, inputPrice, outputPrice }) => {
      const usage: Usage = {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
      };
      const cost = calculateCostInDollars(usage, provider, modelId);
      expect(cost).toBeCloseTo(inputPrice + outputPrice, 6);
    }
  );

  it("returns zero when both token counts are zero", () => {
    const cost = calculateCostInDollars(
      { promptTokens: 0, completionTokens: 0 },
      "openai",
      "gpt-5-nano"
    );
    expect(cost).toBe(0);
  });

  it("calculates cost for prompt-only usage", () => {
    const cost = calculateCostInDollars(
      { promptTokens: 1_000_000, completionTokens: 0 },
      "openai",
      "gpt-5-nano"
    );
    expect(cost).toBeCloseTo(0.05, 6);
  });

  it("calculates cost for completion-only usage", () => {
    const cost = calculateCostInDollars(
      { promptTokens: 0, completionTokens: 1_000_000 },
      "openai",
      "gpt-5-nano"
    );
    expect(cost).toBeCloseTo(0.4, 6);
  });

  it("falls back from promptTokens to inputTokens", () => {
    const costWithInput = calculateCostInDollars(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      "openai",
      "gpt-5-nano"
    );
    const costWithPrompt = calculateCostInDollars(
      { promptTokens: 1_000_000, completionTokens: 1_000_000 },
      "openai",
      "gpt-5-nano"
    );
    expect(costWithInput).toBeCloseTo(costWithPrompt, 6);
  });

  it("promptTokens takes priority over inputTokens", () => {
    const cost = calculateCostInDollars(
      { promptTokens: 1_000_000, inputTokens: 2_000_000, completionTokens: 0 },
      "openai",
      "gpt-5-nano"
    );
    // Should use promptTokens (1M * $0.05/1M = $0.05), not inputTokens (2M)
    expect(cost).toBeCloseTo(0.05, 6);
  });

  it("returns zero cost for openrouter", () => {
    const cost = calculateCostInDollars(
      { promptTokens: 1_000_000, completionTokens: 1_000_000 },
      "openrouter",
      "any-model"
    );
    expect(cost).toBe(0);
  });

  it("returns zero cost for unknown model", () => {
    const cost = calculateCostInDollars(
      { promptTokens: 1_000_000, completionTokens: 1_000_000 },
      "openai",
      "nonexistent-model"
    );
    expect(cost).toBe(0);
  });
});

describe("aggregateUsage", () => {
  it("returns zero totals for empty array", () => {
    const result = aggregateUsage([]);
    expect(result).toEqual({
      promptTokens: 0,
      inputTokens: 0,
      completionTokens: 0,
      outputTokens: 0,
    });
  });

  it("returns identical usage for single-item array", () => {
    const usage: Usage = {
      promptTokens: 100,
      inputTokens: 100,
      completionTokens: 50,
      outputTokens: 50,
    };
    const result = aggregateUsage([usage]);
    expect(result).toEqual(usage);
  });

  it("sums all four fields across multiple Usage objects", () => {
    const usages: Usage[] = [
      {
        promptTokens: 100,
        inputTokens: 200,
        completionTokens: 50,
        outputTokens: 75,
      },
      {
        promptTokens: 300,
        inputTokens: 400,
        completionTokens: 150,
        outputTokens: 125,
      },
      {
        promptTokens: 50,
        inputTokens: 100,
        completionTokens: 25,
        outputTokens: 50,
      },
    ];
    const result = aggregateUsage(usages);
    expect(result).toEqual({
      promptTokens: 450,
      inputTokens: 700,
      completionTokens: 225,
      outputTokens: 250,
    });
  });

  it("handles missing fields as zero", () => {
    const result = aggregateUsage([
      { promptTokens: 100 } as Usage,
      { completionTokens: 200 } as Usage,
    ]);
    expect(result).toEqual({
      promptTokens: 100,
      inputTokens: 0,
      completionTokens: 200,
      outputTokens: 0,
    });
  });

  it("handles large token counts without overflow", () => {
    const result = aggregateUsage([
      { promptTokens: 10_000_000, completionTokens: 5_000_000 } as Usage,
      { promptTokens: 20_000_000, completionTokens: 15_000_000 } as Usage,
    ]);
    expect(result.promptTokens).toBe(30_000_000);
    expect(result.completionTokens).toBe(20_000_000);
  });
});
