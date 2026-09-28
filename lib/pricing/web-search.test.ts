import { describe, expect, it } from "vitest";
import { pickWebSearchPricing } from "./web-search";

describe("pickWebSearchPricing", () => {
  it("returns the unsupported shape when path is null", () => {
    expect(pickWebSearchPricing({ path: null })).toEqual({
      usdPerCall: null,
      creditsPerCall: null,
      source: "unsupported",
    });
  });

  it("returns the Tavily basic estimate for path 'tavily'", () => {
    expect(pickWebSearchPricing({ path: "tavily" })).toEqual({
      usdPerCall: 0.008,
      creditsPerCall: 104,
      source: "tavily-basic",
    });
  });

  it("returns the native OpenRouter price when modelWebSearchPriceUsd is set ($0.01)", () => {
    expect(
      pickWebSearchPricing({ path: "openrouter", modelWebSearchPriceUsd: 0.01 }),
    ).toEqual({
      usdPerCall: 0.01,
      creditsPerCall: 130,
      source: "openrouter-native",
    });
  });

  it("returns the native OpenRouter price when modelWebSearchPriceUsd is set ($0.014, Gemini 2.5 Pro)", () => {
    expect(
      pickWebSearchPricing({ path: "openrouter", modelWebSearchPriceUsd: 0.014 }),
    ).toEqual({
      usdPerCall: 0.014,
      creditsPerCall: 182,
      source: "openrouter-native",
    });
  });

  it("falls back to the server-tool default ($0.02) when modelWebSearchPriceUsd is undefined", () => {
    expect(
      pickWebSearchPricing({
        path: "openrouter",
        modelWebSearchPriceUsd: undefined,
      }),
    ).toEqual({
      usdPerCall: 0.02,
      creditsPerCall: 260,
      source: "openrouter-server-tool",
    });
  });

  it("falls back to the server-tool default when modelWebSearchPriceUsd is null (the gateway nullable case)", () => {
    expect(
      pickWebSearchPricing({
        path: "openrouter",
        modelWebSearchPriceUsd: null,
      }),
    ).toEqual({
      usdPerCall: 0.02,
      creditsPerCall: 260,
      source: "openrouter-server-tool",
    });
  });

  it("treats modelWebSearchPriceUsd === 0 as 'no native price' and falls back to server tool", () => {
    expect(
      pickWebSearchPricing({ path: "openrouter", modelWebSearchPriceUsd: 0 }),
    ).toEqual({
      usdPerCall: 0.02,
      creditsPerCall: 260,
      source: "openrouter-server-tool",
    });
  });

  it("recomputes the server-tool price from maxResults when provided", () => {
    expect(
      pickWebSearchPricing({
        path: "openrouter",
        modelWebSearchPriceUsd: undefined,
        maxResults: 10,
      }),
    ).toEqual({
      usdPerCall: 0.04,
      creditsPerCall: 520,
      source: "openrouter-server-tool",
    });
  });

  it("ignores maxResults on the native OpenRouter branch (native rates are flat per call)", () => {
    expect(
      pickWebSearchPricing({
        path: "openrouter",
        modelWebSearchPriceUsd: 0.01,
        maxResults: 10,
      }),
    ).toEqual({
      usdPerCall: 0.01,
      creditsPerCall: 130,
      source: "openrouter-native",
    });
  });

  it("propagates an explicit markup override into the credits estimate (Tavily, markup=2.0)", () => {
    expect(
      pickWebSearchPricing({ path: "tavily", markup: 2.0 }),
    ).toEqual({
      usdPerCall: 0.008,
      creditsPerCall: 160,
      source: "tavily-basic",
    });
  });
});
