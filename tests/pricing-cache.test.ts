import { describe, expect, it } from "vitest";
import { parseOpenRouterPricing } from "../convex/pricing/actions";

describe("parseOpenRouterPricing", () => {
  it("converts per-token strings to per-1M-token numbers", () => {
    const result = parseOpenRouterPricing({
      prompt: "0.000003",
      completion: "0.000015",
    });
    expect(result).toEqual({
      inputPerMillion: 3.0,
      outputPerMillion: 15.0,
    });
  });

  it("handles zero pricing (free models)", () => {
    const result = parseOpenRouterPricing({
      prompt: "0",
      completion: "0",
    });
    expect(result).toEqual({
      inputPerMillion: 0,
      outputPerMillion: 0,
    });
  });

  it("handles very small pricing values", () => {
    const result = parseOpenRouterPricing({
      prompt: "0.00000025",
      completion: "0.0000015",
    });
    expect(result).toEqual({
      inputPerMillion: 0.25,
      outputPerMillion: 1.5,
    });
  });

  it("returns null when pricing is undefined", () => {
    expect(parseOpenRouterPricing(undefined)).toBeNull();
  });

  it("returns null when prompt is missing", () => {
    expect(parseOpenRouterPricing({ completion: "0.000015" })).toBeNull();
  });

  it("returns null when completion is missing", () => {
    expect(parseOpenRouterPricing({ prompt: "0.000003" })).toBeNull();
  });

  it("returns null for non-numeric strings", () => {
    expect(
      parseOpenRouterPricing({ prompt: "free", completion: "free" }),
    ).toBeNull();
  });
});
