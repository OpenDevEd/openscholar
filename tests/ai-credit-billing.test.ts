import { describe, expect, it } from "vitest";
import {
  calculateCreditsToDeductFromUsage,
  convertUsdCostToCredits,
} from "../convex/ai/lib/creditBilling";

describe("AI credit billing helpers", () => {
  it("returns zero credits for zero usage", () => {
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 0, outputTokens: 0 },
      pricing: { input: 0.25, output: 2.0 },
    });

    expect(credits).toBe(0);
  });

  it("returns 1 credit for non-zero usage with zero pricing", () => {
    const credits = calculateCreditsToDeductFromUsage({
      usage: { inputTokens: 12_000, outputTokens: 8_000 },
      pricing: { input: 0, output: 0 },
    });

    expect(credits).toBe(1);
  });

  it("matches direct USD conversion when pricing is provided", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000 };
    const pricing = { input: 0.25, output: 2.0 };
    // $0.25 + $1.00 = $1.25
    const expectedCostDollars = 0.25 + 1.0;
    const expectedCredits = convertUsdCostToCredits(expectedCostDollars);

    const actualCredits = calculateCreditsToDeductFromUsage({
      usage,
      pricing,
    });

    expect(actualCredits).toBe(expectedCredits);
  });

  it("computes credits from explicit pricing", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const pricing = { input: 10.0, output: 20.0 };

    const credits = calculateCreditsToDeductFromUsage({
      usage,
      pricing,
    });

    const expectedCost = 10.0 + 20.0;
    const expectedCredits = convertUsdCostToCredits(expectedCost);
    expect(credits).toBe(expectedCredits);
  });
});
