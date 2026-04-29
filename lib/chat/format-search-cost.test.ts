import { describe, expect, it } from "vitest";
import { formatSearchCostLabel } from "./format-search-cost";

describe("formatSearchCostLabel", () => {
  it("returns '1 credit' (singular) when creditsUsed is exactly 1", () => {
    expect(
      formatSearchCostLabel({
        creditsUsed: 1,
        estimate: { source: "tavily-basic", creditsPerCall: 104 },
      }),
    ).toBe("1 credit");
  });

  it("returns the plural form for creditsUsed > 1", () => {
    expect(
      formatSearchCostLabel({
        creditsUsed: 2,
        estimate: { source: "tavily-basic", creditsPerCall: 104 },
      }),
    ).toBe("2 credits");
  });

  it("uses plural for the deliberate creditsUsed=0 (free Tavily search) case", () => {
    expect(
      formatSearchCostLabel({
        creditsUsed: 0,
        estimate: { source: "tavily-basic", creditsPerCall: 104 },
      }),
    ).toBe("0 credits");
  });

  it("returns the Tavily-basic estimate label when no creditsUsed is supplied", () => {
    expect(
      formatSearchCostLabel({
        estimate: { source: "tavily-basic", creditsPerCall: 104 },
      }),
    ).toBe("~104 credits");
  });

  it("returns the OpenRouter-native estimate label when no creditsUsed is supplied", () => {
    expect(
      formatSearchCostLabel({
        estimate: { source: "openrouter-native", creditsPerCall: 130 },
      }),
    ).toBe("~130 credits");
  });

  it("returns the OpenRouter-server-tool estimate label when no creditsUsed is supplied", () => {
    expect(
      formatSearchCostLabel({
        estimate: { source: "openrouter-server-tool", creditsPerCall: 260 },
      }),
    ).toBe("~260 credits");
  });

  it("returns an empty string when the path is unsupported (caller decides whether to hide)", () => {
    expect(
      formatSearchCostLabel({
        estimate: { source: "unsupported", creditsPerCall: null },
      }),
    ).toBe("");
  });
});
