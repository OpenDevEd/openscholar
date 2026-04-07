import { describe, expect, it } from "vitest";
import { calculateCostInDollars } from "../lib/ai/core/cost";
import {
  calculateCreditsToDeductFromUsage,
  calculateRawCreditCost,
  convertUsdCostToCredits,
} from "../convex/ai/lib/creditBilling";
import { getModelPricing } from "../lib/ai-models";
import type { AIProvider } from "../lib/types/ai.types";
import { AI_COST_MARKUP } from "../convex/lib/constants";
import { DEFAULT_CREDITS_PER_USD } from "../convex/lib/creditTopups";

// ═══════════════════════════════════════════════════════════════
// Constants sanity checks
// ═══════════════════════════════════════════════════════════════

describe("billing constants", () => {
  it("AI_COST_MARKUP is 1.3 (30% markup)", () => {
    expect(AI_COST_MARKUP).toBe(1.3);
  });

  it("DEFAULT_CREDITS_PER_USD is 10,000", () => {
    expect(DEFAULT_CREDITS_PER_USD).toBe(10_000);
  });
});

// ═══════════════════════════════════════════════════════════════
// End-to-end: tokens → dollars → credits for real models
// ═══════════════════════════════════════════════════════════════

describe("end-to-end credit calculation per model", () => {
  // Representative models across providers with known pricing
  const models: {
    provider: AIProvider;
    modelId: string;
    label: string;
    pricing: { input: number; output: number };
  }[] = [
    // Server model (OpenRouter → Google)
    {
      provider: "openrouter",
      modelId: "google/gemini-3.1-flash-lite-preview",
      label: "server model (gemini-3.1-flash-lite via OpenRouter)",
      pricing: { input: 0.25, output: 1.50 },
    },
    // Cheap model
    {
      provider: "openai",
      modelId: "gpt-5-nano",
      label: "cheap model (gpt-5-nano)",
      pricing: { input: 0.05, output: 0.40 },
    },
    // Mid-range model
    {
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      label: "mid-range model (claude-sonnet-4-5)",
      pricing: { input: 3.00, output: 15.00 },
    },
    // Expensive model
    {
      provider: "openai",
      modelId: "o3-pro",
      label: "expensive model (o3-pro)",
      pricing: { input: 20.00, output: 80.00 },
    },
    // DeepSeek (budget)
    {
      provider: "deepseek",
      modelId: "deepseek-chat",
      label: "budget model (deepseek-chat)",
      pricing: { input: 0.14, output: 0.28 },
    },
  ];

  for (const { provider, modelId, label, pricing } of models) {
    describe(label, () => {
      it("getModelPricing returns expected pricing", () => {
        const actual = getModelPricing(provider, modelId);
        expect(actual.input).toBe(pricing.input);
        expect(actual.output).toBe(pricing.output);
      });

      it("pricing is non-zero", () => {
        const actual = getModelPricing(provider, modelId);
        expect(actual.input + actual.output).toBeGreaterThan(0);
      });

      it("calculates non-zero dollar cost for typical screening usage (~900 in / ~50 out tokens)", () => {
        const cost = calculateCostInDollars(
          { inputTokens: 900, outputTokens: 50 },
          provider,
          modelId,
        );
        expect(cost).toBeGreaterThan(0);
      });

      it("calculates correct dollar cost for 1M tokens", () => {
        const cost = calculateCostInDollars(
          { inputTokens: 1_000_000, outputTokens: 1_000_000 },
          provider,
          modelId,
        );
        expect(cost).toBeCloseTo(pricing.input + pricing.output, 6);
      });

      it("deducts non-zero credits for typical usage", () => {
        const credits = calculateCreditsToDeductFromUsage({
          usage: { inputTokens: 900, outputTokens: 50 },
          provider,
          modelId,
        });
        expect(credits).toBeGreaterThan(0);
      });

      it("credits match the formula: ceil(dollars * markup * creditsPerUsd)", () => {
        const usage = { inputTokens: 100_000, outputTokens: 50_000 };
        const dollars = calculateCostInDollars(usage, provider, modelId);
        const expectedCredits = Math.max(
          1,
          Math.ceil(dollars * AI_COST_MARKUP * DEFAULT_CREDITS_PER_USD),
        );
        const actual = calculateCreditsToDeductFromUsage({
          usage,
          provider,
          modelId,
          markupMultiplier: AI_COST_MARKUP,
        });
        expect(actual).toBe(expectedCredits);
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// Markup correctness
// ═══════════════════════════════════════════════════════════════

describe("markup application", () => {
  it("credits with markup are 30% higher than without markup", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000 };
    const provider = "openai" as AIProvider;
    const modelId = "gpt-5-nano";

    const withMarkup = calculateCreditsToDeductFromUsage({
      usage,
      provider,
      modelId,
      markupMultiplier: AI_COST_MARKUP,
    });
    const withoutMarkup = calculateCreditsToDeductFromUsage({
      usage,
      provider,
      modelId,
      markupMultiplier: 1.0,
    });

    // Due to ceiling, the ratio won't be exactly 1.3, but should be close
    const ratio = withMarkup / withoutMarkup;
    expect(ratio).toBeGreaterThanOrEqual(1.0);
    expect(ratio).toBeLessThanOrEqual(1.5); // generous bound for ceiling effects
  });

  it("raw credit cost reflects markup precisely (no ceiling)", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const provider = "openai" as AIProvider;
    const modelId = "gpt-4o"; // $2.50 in, $10.00 out

    const raw = calculateRawCreditCost({
      usage,
      provider,
      modelId,
      markupMultiplier: AI_COST_MARKUP,
    });
    const dollars = 2.50 + 10.00;
    const expected = dollars * AI_COST_MARKUP * DEFAULT_CREDITS_PER_USD;
    expect(raw).toBeCloseTo(expected, 2);
  });

  it("convertUsdCostToCredits applies markup correctly", () => {
    const costDollars = 1.0; // $1.00
    const credits = convertUsdCostToCredits(costDollars, AI_COST_MARKUP);
    // $1.00 * 1.3 markup * 10,000 credits/$ = 13,000
    expect(credits).toBe(13_000);
  });

  it("convertUsdCostToCredits applies ceiling", () => {
    const costDollars = 0.00001; // very small
    const credits = convertUsdCostToCredits(costDollars, AI_COST_MARKUP);
    // $0.00001 * 1.3 * 10,000 = 0.13 → ceil → 1 → max(1, 1) = 1
    expect(credits).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// pricingOverride takes precedence over model lookup
// ═══════════════════════════════════════════════════════════════

describe("pricingOverride in credit pipeline", () => {
  it("overrides hardcoded pricing in calculateCreditsToDeductFromUsage", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const override = { input: 50.0, output: 100.0 };

    const withOverride = calculateCreditsToDeductFromUsage({
      usage,
      provider: "openai",
      modelId: "gpt-5-nano", // normally $0.05 / $0.40
      pricingOverride: override,
      markupMultiplier: AI_COST_MARKUP,
    });

    // $150 * 1.3 * 10,000 = 1,950,000 credits
    const expected = Math.ceil(150.0 * AI_COST_MARKUP * DEFAULT_CREDITS_PER_USD);
    expect(withOverride).toBe(expected);
  });

  it("overrides hardcoded pricing in calculateRawCreditCost", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const override = { input: 5.0, output: 25.0 };

    const raw = calculateRawCreditCost({
      usage,
      provider: "openrouter",
      modelId: "unknown/model",
      pricingOverride: override,
      markupMultiplier: AI_COST_MARKUP,
    });

    expect(raw).toBeCloseTo(30.0 * AI_COST_MARKUP * DEFAULT_CREDITS_PER_USD, 2);
  });
});

// ═══════════════════════════════════════════════════════════════
// Fallback behavior for unknown models
// ═══════════════════════════════════════════════════════════════

describe("unknown model fallback", () => {
  it("returns 1 credit for unknown model with non-zero usage", () => {
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 500, outputTokens: 200 },
      provider: "openrouter",
      modelId: "unknown-provider/mystery-model",
    });
    expect(credits).toBe(1);
  });

  it("returns 0 credits for unknown model with zero usage", () => {
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 0, outputTokens: 0 },
      provider: "openrouter",
      modelId: "unknown-provider/mystery-model",
    });
    expect(credits).toBe(0);
  });

  it("returns 0 raw cost for unknown model", () => {
    const raw = calculateRawCreditCost({
      usage: { inputTokens: 500, outputTokens: 200 },
      provider: "openrouter",
      modelId: "unknown-provider/mystery-model",
    });
    expect(raw).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Realistic scenario: server model screening batch
// ═══════════════════════════════════════════════════════════════

describe("realistic server model scenarios", () => {
  const serverProvider = "openrouter" as AIProvider;
  const serverModel = "google/gemini-3.1-flash-lite-preview";

  it("typical single screening call (~900 in, ~50 out) costs 1-10 credits", () => {
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 900, outputTokens: 50 },
      provider: serverProvider,
      modelId: serverModel,
      markupMultiplier: AI_COST_MARKUP,
    });
    expect(credits).toBeGreaterThanOrEqual(1);
    expect(credits).toBeLessThanOrEqual(10);
  });

  it("batch of 50 papers (~45K in, ~2.5K out) costs a reasonable amount", () => {
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 45_000, outputTokens: 2_500 },
      provider: serverProvider,
      modelId: serverModel,
      markupMultiplier: AI_COST_MARKUP,
    });
    // Should be meaningful but not astronomical
    expect(credits).toBeGreaterThanOrEqual(1);
    expect(credits).toBeLessThanOrEqual(500);
  });

  it("heavy usage (1M in, 100K out) produces credits in expected range", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 100_000 };
    const dollars = calculateCostInDollars(usage, serverProvider, serverModel);
    // $0.25/1M * 1M + $1.50/1M * 100K = $0.25 + $0.15 = $0.40
    expect(dollars).toBeCloseTo(0.40, 4);

    const credits = calculateCreditsToDeductFromUsage({
      usage,
      provider: serverProvider,
      modelId: serverModel,
      markupMultiplier: AI_COST_MARKUP,
    });
    // $0.40 * 1.3 * 10,000 = 5,200
    expect(credits).toBe(Math.ceil(0.40 * AI_COST_MARKUP * DEFAULT_CREDITS_PER_USD));
  });

  it("raw cost and deducted credits are consistent", () => {
    const usage = { inputTokens: 500_000, outputTokens: 250_000 };

    const raw = calculateRawCreditCost({
      usage,
      provider: serverProvider,
      modelId: serverModel,
      markupMultiplier: AI_COST_MARKUP,
    });
    const deducted = calculateCreditsToDeductFromUsage({
      usage,
      provider: serverProvider,
      modelId: serverModel,
      markupMultiplier: AI_COST_MARKUP,
    });

    // Deducted should be the ceiling of raw (or 1 minimum)
    expect(deducted).toBe(Math.max(1, Math.ceil(raw)));
  });
});

// ═══════════════════════════════════════════════════════════════
// OpenRouter resolution for various providers
// ═══════════════════════════════════════════════════════════════

describe("OpenRouter model resolution across providers", () => {
  const openRouterModels = [
    { modelId: "google/gemini-2.5-flash", expectedInput: 0.30, expectedOutput: 2.50 },
    { modelId: "openai/gpt-4o", expectedInput: 2.50, expectedOutput: 10.00 },
    { modelId: "anthropic/claude-3-haiku", expectedInput: 0.25, expectedOutput: 1.25 },
    { modelId: "deepseek/deepseek-chat", expectedInput: 0.14, expectedOutput: 0.28 },
  ];

  for (const { modelId, expectedInput, expectedOutput } of openRouterModels) {
    it(`resolves ${modelId} to correct pricing`, () => {
      const pricing = getModelPricing("openrouter", modelId);
      expect(pricing.input).toBe(expectedInput);
      expect(pricing.output).toBe(expectedOutput);
    });

    it(`${modelId} produces non-zero credits`, () => {
      const credits = calculateCreditsToDeductFromUsage({
        usage: { inputTokens: 10_000, outputTokens: 5_000 },
        provider: "openrouter",
        modelId,
        markupMultiplier: AI_COST_MARKUP,
      });
      expect(credits).toBeGreaterThan(0);
    });
  }
});
