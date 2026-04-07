import { describe, expect, it } from "vitest";
import {
  calculateCreditsToDeductFromUsage,
  convertUsdCostToCredits,
} from "../convex/ai/lib/creditBilling";

describe("AI credit billing helpers", () => {
  it("returns zero credits for zero usage", () => {
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 0, outputTokens: 0 },
      provider: "openai",
      modelId: "gpt-5-mini",
    });

    expect(credits).toBe(0);
  });

  it("returns non-zero credits for non-zero usage when model pricing is unknown", () => {
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 12_000, outputTokens: 8_000 },
      provider: "openrouter",
      modelId: "google/gemini-3-flash-preview",
    });

    expect(credits).toBeGreaterThan(0);
  });

  it("matches direct USD conversion when pricing data is available", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000 };
    // gpt-5-mini pricing in this codebase is $0.25 / 1M input and $2.00 / 1M output.
    const expectedCostDollars = 0.25 + 1.0;
    const expectedCredits = convertUsdCostToCredits(expectedCostDollars);

    const actualCredits = calculateCreditsToDeductFromUsage({
      usage,
      provider: "openai",
      modelId: "gpt-5-mini",
    });

    expect(actualCredits).toBe(expectedCredits);
  });

  it("uses pricingOverride instead of model lookup", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const override = { input: 10.0, output: 20.0 };

    const withOverride = calculateCreditsToDeductFromUsage({
      usage,
      provider: "openrouter",
      modelId: "unknown/model",
      pricingOverride: override,
    });

    // Override provides real pricing → should compute actual credits, not fall back to 1
    const expectedCost = 10.0 + 20.0;
    const expectedCredits = convertUsdCostToCredits(expectedCost);
    expect(withOverride).toBe(expectedCredits);
  });
});
