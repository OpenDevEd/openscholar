import { describe, expect, it } from "vitest";
import { convertUsdToCredits } from "./convert";

describe("convertUsdToCredits", () => {
  it("returns 0 for usd = 0", () => {
    expect(convertUsdToCredits({ usd: 0 })).toBe(0);
  });

  it("returns 0 for negative usd", () => {
    expect(convertUsdToCredits({ usd: -0.01 })).toBe(0);
  });

  it("returns 0 for NaN usd", () => {
    expect(convertUsdToCredits({ usd: Number.NaN })).toBe(0);
  });

  it("returns 104 for Tavily basic ($0.008) at default markup and rate", () => {
    expect(convertUsdToCredits({ usd: 0.008 })).toBe(104);
  });

  it("returns 208 for Tavily advanced ($0.016) at default markup and rate", () => {
    expect(convertUsdToCredits({ usd: 0.016 })).toBe(208);
  });

  it("returns 260 for OpenRouter server-tool default ($0.02) at default markup and rate", () => {
    expect(convertUsdToCredits({ usd: 0.02 })).toBe(260);
  });

  it("returns 65 for Perplexity Sonar ($0.005) at default markup and rate", () => {
    expect(convertUsdToCredits({ usd: 0.005 })).toBe(65);
  });

  it("returns 130 for Sonnet 4 native ($0.01) at default markup and rate", () => {
    expect(convertUsdToCredits({ usd: 0.01 })).toBe(130);
  });

  it("uses Math.ceil rather than Math.floor for fractional results", () => {
    // 0.0001 × 1.3 × 10_000 = 1.3 → ceil = 2
    expect(convertUsdToCredits({ usd: 0.0001 })).toBe(2);
  });

  it("clamps sub-cent costs to a minimum of 1 credit", () => {
    // 0.000001 × 1.3 × 10_000 = 0.013 → ceil = 1, clamped to max(1, 1) = 1
    expect(convertUsdToCredits({ usd: 0.000001 })).toBe(1);
  });

  it("honours an explicit markup override", () => {
    // 0.01 × 2.0 × 10_000 = 200
    expect(convertUsdToCredits({ usd: 0.01, markup: 2.0 })).toBe(200);
  });

  it("honours an explicit creditsPerUsd override", () => {
    // 0.01 × 1.3 × 1_000 = 13
    expect(convertUsdToCredits({ usd: 0.01, creditsPerUsd: 1_000 })).toBe(13);
  });
});
