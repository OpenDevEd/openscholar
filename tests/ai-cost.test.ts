import { describe, expect, it } from "vitest";
import { calculateCostInDollars, aggregateUsage } from "../lib/ai/core/cost";
import type { Usage } from "../lib/ai/core/types";

describe("calculateCostInDollars", () => {
  const pricingCases = [
    { label: "cheap model", pricing: { input: 0.05, output: 0.4 } },
    { label: "mid-range model", pricing: { input: 0.25, output: 1.25 } },
    { label: "flash model", pricing: { input: 0.1, output: 0.4 } },
    { label: "budget model", pricing: { input: 0.14, output: 0.28 } },
  ];

  it.each(pricingCases)(
    "returns correct cost for $label",
    ({ pricing }) => {
      const usage: Usage = {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
      };
      const cost = calculateCostInDollars(usage, pricing);
      expect(cost).toBeCloseTo(pricing.input + pricing.output, 6);
    }
  );

  it("returns zero when both token counts are zero", () => {
    const cost = calculateCostInDollars(
      { promptTokens: 0, completionTokens: 0 },
      { input: 0.05, output: 0.4 },
    );
    expect(cost).toBe(0);
  });

  it("calculates cost for prompt-only usage", () => {
    const cost = calculateCostInDollars(
      { promptTokens: 1_000_000, completionTokens: 0 },
      { input: 0.05, output: 0.4 },
    );
    expect(cost).toBeCloseTo(0.05, 6);
  });

  it("calculates cost for completion-only usage", () => {
    const cost = calculateCostInDollars(
      { promptTokens: 0, completionTokens: 1_000_000 },
      { input: 0.05, output: 0.4 },
    );
    expect(cost).toBeCloseTo(0.4, 6);
  });

  it("falls back from promptTokens to inputTokens", () => {
    const pricing = { input: 0.05, output: 0.4 };
    const costWithInput = calculateCostInDollars(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      pricing,
    );
    const costWithPrompt = calculateCostInDollars(
      { promptTokens: 1_000_000, completionTokens: 1_000_000 },
      pricing,
    );
    expect(costWithInput).toBeCloseTo(costWithPrompt, 6);
  });

  it("promptTokens takes priority over inputTokens", () => {
    const cost = calculateCostInDollars(
      { promptTokens: 1_000_000, inputTokens: 2_000_000, completionTokens: 0 },
      { input: 0.05, output: 0.4 },
    );
    // Should use promptTokens (1M * $0.05/1M = $0.05), not inputTokens (2M)
    expect(cost).toBeCloseTo(0.05, 6);
  });

  it("returns zero cost for zero pricing", () => {
    const cost = calculateCostInDollars(
      { promptTokens: 1_000_000, completionTokens: 1_000_000 },
      { input: 0, output: 0 },
    );
    expect(cost).toBe(0);
  });
});

describe("calculateCostInDollars with a reported cost", () => {
  it("charges what OpenRouter reported instead of tokens at the catalog price", () => {
    // 1M input tokens at $3/M would be $3; mostly cached, OpenRouter billed $0.60.
    expect(calculateCostInDollars({ inputTokens: 1_000_000, cacheReadTokens: 900_000, costUsd: 0.6 }, { input: 3, output: 15 })).toBe(0.6);
  });
});

describe("aggregateUsage", () => {
  it("returns zero totals for empty array", () => {
    const result = aggregateUsage([]);
    expect(result).not.toHaveProperty("costUsd");
    expect(result).toMatchObject({
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
    expect(result).toMatchObject(usage);
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
    expect(result).toMatchObject({
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
    expect(result).toMatchObject({
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

  it("sums cache and reasoning tokens, and a reported cost only when every call reported one", () => {
    const reported = { inputTokens: 1000, cacheReadTokens: 800, cacheWriteTokens: 0, reasoningTokens: 40, costUsd: 0.002 };
    expect(aggregateUsage([reported, { ...reported, cacheWriteTokens: 200, costUsd: 0.003 }])).toMatchObject({
      cacheReadTokens: 1600,
      cacheWriteTokens: 200,
      reasoningTokens: 80,
      costUsd: 0.005,
    });
    // One call without a reported cost sends the whole batch back to token prices.
    expect(aggregateUsage([reported, { inputTokens: 1000 }])).not.toHaveProperty("costUsd");
  });
});
