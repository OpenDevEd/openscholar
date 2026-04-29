import { describe, expect, it } from "vitest";
import { formatSearchCostLabel } from "./format-search-cost";

describe("formatSearchCostLabel", () => {
  it("returns the singular '1 credit' when creditsUsed is exactly 1", () => {
    expect(
      formatSearchCostLabel({
        creditsUsed: 1,
        creditsPerSearchEstimate: 3,
        costUsdEstimate: 0.02,
      }),
    ).toBe("1 credit");
  });

  it("returns the plural form for creditsUsed > 1", () => {
    expect(
      formatSearchCostLabel({
        creditsUsed: 2,
        creditsPerSearchEstimate: 3,
        costUsdEstimate: 0.02,
      }),
    ).toBe("2 credits");
  });

  it("returns the estimate string when creditsUsed is undefined", () => {
    expect(
      formatSearchCostLabel({
        creditsPerSearchEstimate: 3,
        costUsdEstimate: 0.02,
      }),
    ).toBe("~$0.02 / ~3 credits");
  });

  it("uses plural for the deliberate creditsUsed=0 (free Tavily search) case", () => {
    expect(
      formatSearchCostLabel({
        creditsUsed: 0,
        creditsPerSearchEstimate: 3,
        costUsdEstimate: 0.02,
      }),
    ).toBe("0 credits");
  });
});
