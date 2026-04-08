import { describe, expect, it } from "vitest";
import { calculateCostInDollars } from "../lib/ai/core/cost";
import {
  calculateCreditsToDeductFromUsage,
  calculateRawCreditCost,
  convertUsdCostToCredits,
} from "../convex/ai/lib/creditBilling";
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
// End-to-end: tokens → dollars → credits for representative pricing
// ═══════════════════════════════════════════════════════════════

describe("end-to-end credit calculation", () => {
  const models = [
    {
      label: "cheap model (gpt-5-nano pricing)",
      pricing: { input: 0.05, output: 0.40 },
    },
    {
      label: "mid-range model (claude-sonnet-4-5 pricing)",
      pricing: { input: 3.00, output: 15.00 },
    },
    {
      label: "expensive model (o3-pro pricing)",
      pricing: { input: 20.00, output: 80.00 },
    },
    {
      label: "budget model (deepseek-chat pricing)",
      pricing: { input: 0.14, output: 0.28 },
    },
    {
      label: "server model (gemini-flash pricing)",
      pricing: { input: 0.25, output: 1.50 },
    },
  ];

  for (const { label, pricing } of models) {
    describe(label, () => {
      it("calculates non-zero dollar cost for typical screening usage (~900 in / ~50 out tokens)", () => {
        const cost = calculateCostInDollars(
          { inputTokens: 900, outputTokens: 50 },
          pricing,
        );
        expect(cost).toBeGreaterThan(0);
      });

      it("calculates correct dollar cost for 1M tokens", () => {
        const cost = calculateCostInDollars(
          { inputTokens: 1_000_000, outputTokens: 1_000_000 },
          pricing,
        );
        expect(cost).toBeCloseTo(pricing.input + pricing.output, 6);
      });

      it("deducts non-zero credits for typical usage", () => {
        const credits = calculateCreditsToDeductFromUsage({
          usage: { inputTokens: 900, outputTokens: 50 },
          pricing,
        });
        expect(credits).toBeGreaterThan(0);
      });

      it("credits match the formula: ceil(dollars * markup * creditsPerUsd)", () => {
        const usage = { inputTokens: 100_000, outputTokens: 50_000 };
        const dollars = calculateCostInDollars(usage, pricing);
        const expectedCredits = Math.max(
          1,
          Math.ceil(dollars * AI_COST_MARKUP * DEFAULT_CREDITS_PER_USD),
        );
        const actual = calculateCreditsToDeductFromUsage({
          usage,
          pricing,
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
  const pricing = { input: 0.05, output: 0.40 };

  it("credits with markup are higher than without markup", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000 };

    const withMarkup = calculateCreditsToDeductFromUsage({
      usage,
      pricing,
      markupMultiplier: AI_COST_MARKUP,
    });
    const withoutMarkup = calculateCreditsToDeductFromUsage({
      usage,
      pricing,
      markupMultiplier: 1.0,
    });

    const ratio = withMarkup / withoutMarkup;
    expect(ratio).toBeGreaterThanOrEqual(1.0);
    expect(ratio).toBeLessThanOrEqual(1.5);
  });

  it("raw credit cost reflects markup precisely (no ceiling)", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const gpt4oPricing = { input: 2.50, output: 10.00 };

    const raw = calculateRawCreditCost({
      usage,
      pricing: gpt4oPricing,
      markupMultiplier: AI_COST_MARKUP,
    });
    const dollars = 2.50 + 10.00;
    const expected = dollars * AI_COST_MARKUP * DEFAULT_CREDITS_PER_USD;
    expect(raw).toBeCloseTo(expected, 2);
  });

  it("convertUsdCostToCredits applies markup correctly", () => {
    const costDollars = 1.0;
    const credits = convertUsdCostToCredits(costDollars, AI_COST_MARKUP);
    expect(credits).toBe(13_000);
  });

  it("convertUsdCostToCredits applies ceiling", () => {
    const costDollars = 0.00001;
    const credits = convertUsdCostToCredits(costDollars, AI_COST_MARKUP);
    expect(credits).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Fallback behavior for zero pricing (model not yet synced)
// ═══════════════════════════════════════════════════════════════

describe("zero pricing fallback", () => {
  const zeroPricing = { input: 0, output: 0 };

  it("returns 1 credit for zero-priced model with non-zero usage", () => {
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 500, outputTokens: 200 },
      pricing: zeroPricing,
    });
    expect(credits).toBe(1);
  });

  it("returns 0 credits for zero-priced model with zero usage", () => {
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 0, outputTokens: 0 },
      pricing: zeroPricing,
    });
    expect(credits).toBe(0);
  });

  it("returns 0 raw cost for zero pricing", () => {
    const raw = calculateRawCreditCost({
      usage: { inputTokens: 500, outputTokens: 200 },
      pricing: zeroPricing,
    });
    expect(raw).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Realistic scenario: server model screening batch
// ═══════════════════════════════════════════════════════════════

describe("realistic server model scenarios", () => {
  // Gemini Flash Lite pricing
  const serverPricing = { input: 0.25, output: 1.50 };

  it("typical single screening call (~900 in, ~50 out) costs 1-10 credits", () => {
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 900, outputTokens: 50 },
      pricing: serverPricing,
      markupMultiplier: AI_COST_MARKUP,
    });
    expect(credits).toBeGreaterThanOrEqual(1);
    expect(credits).toBeLessThanOrEqual(10);
  });

  it("batch of 50 papers (~45K in, ~2.5K out) costs a reasonable amount", () => {
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 45_000, outputTokens: 2_500 },
      pricing: serverPricing,
      markupMultiplier: AI_COST_MARKUP,
    });
    expect(credits).toBeGreaterThanOrEqual(1);
    expect(credits).toBeLessThanOrEqual(500);
  });

  it("heavy usage (1M in, 100K out) produces credits in expected range", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 100_000 };
    const dollars = calculateCostInDollars(usage, serverPricing);
    expect(dollars).toBeCloseTo(0.40, 4);

    const credits = calculateCreditsToDeductFromUsage({
      usage,
      pricing: serverPricing,
      markupMultiplier: AI_COST_MARKUP,
    });
    expect(credits).toBe(Math.ceil(0.40 * AI_COST_MARKUP * DEFAULT_CREDITS_PER_USD));
  });

  it("raw cost and deducted credits are consistent", () => {
    const usage = { inputTokens: 500_000, outputTokens: 250_000 };

    const raw = calculateRawCreditCost({
      usage,
      pricing: serverPricing,
      markupMultiplier: AI_COST_MARKUP,
    });
    const deducted = calculateCreditsToDeductFromUsage({
      usage,
      pricing: serverPricing,
      markupMultiplier: AI_COST_MARKUP,
    });

    expect(deducted).toBe(Math.max(1, Math.ceil(raw)));
  });
});
