/**
 * Chat billing is provider-authoritative: OpenRouter's generation
 * record supplies the billed dollar cost, and the app applies only its
 * existing markup + credit conversion policy on top of that number.
 */
import { describe, expect, it } from "vitest";
import { convertUsdCostToCredits } from "@/convex/ai/lib/creditBilling";
import { AI_COST_MARKUP } from "@/convex/lib/constants";

describe("chat provider-authoritative credit conversion", () => {
  it("converts authoritative provider cost into marked-up credits", () => {
    const credits = convertUsdCostToCredits(0.25, AI_COST_MARKUP);
    expect(credits).toBeGreaterThan(0);
  });

  it("does not charge when OpenRouter billed zero dollars", () => {
    expect(convertUsdCostToCredits(0, AI_COST_MARKUP)).toBe(0);
  });

  it("rounds up to at least 1 credit for any non-zero billed cost", () => {
    expect(convertUsdCostToCredits(0.0000001, 1)).toBe(1);
  });

  it("scales linearly with provider cost (modulo whole-credit rounding)", () => {
    const small = convertUsdCostToCredits(0.01, 1);
    const big = convertUsdCostToCredits(0.1, 1);
    expect(big).toBeGreaterThanOrEqual(small * 9);
    expect(big).toBeLessThanOrEqual(small * 11);
  });
});
