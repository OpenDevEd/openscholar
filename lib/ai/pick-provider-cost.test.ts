import { describe, expect, it } from "vitest";
import { openRouterUsageCost, pickProviderCostUsd } from "./pick-provider-cost";

describe("pickProviderCostUsd", () => {
  it("returns null for null", () => {
    expect(pickProviderCostUsd(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(pickProviderCostUsd(undefined)).toBeNull();
  });

  it("returns null for an empty providerMetadata object", () => {
    expect(pickProviderCostUsd({})).toBeNull();
  });

  it("returns null when openrouter is null", () => {
    expect(pickProviderCostUsd({ openrouter: null })).toBeNull();
  });

  it("returns null when openrouter is an empty object", () => {
    expect(pickProviderCostUsd({ openrouter: {} })).toBeNull();
  });

  it("returns null when openrouter.usage is empty", () => {
    expect(pickProviderCostUsd({ openrouter: { usage: {} } })).toBeNull();
  });

  it("returns 0 when cost is exactly zero", () => {
    expect(pickProviderCostUsd({ openrouter: { usage: { cost: 0 } } })).toBe(0);
  });

  it("returns the numeric cost when positive and finite", () => {
    expect(
      pickProviderCostUsd({ openrouter: { usage: { cost: 0.0034 } } }),
    ).toBe(0.0034);
  });

  it("returns null for a negative cost", () => {
    expect(pickProviderCostUsd({ openrouter: { usage: { cost: -1 } } })).toBeNull();
  });

  it("returns null for NaN cost", () => {
    expect(
      pickProviderCostUsd({ openrouter: { usage: { cost: Number.NaN } } }),
    ).toBeNull();
  });

  // On our own provider key (BYOK) OpenRouter's `cost` is only its own fee, often 0, and what the provider charged is
  // `upstreamInferenceCost`. Billing on `cost` alone charged every such call the 1-credit minimum.
  it("adds what the provider charged on our own key to OpenRouter's fee", () => {
    expect(pickProviderCostUsd({ openrouter: { usage: { cost: 0, costDetails: { upstreamInferenceCost: 0.000721 } } } })).toBeCloseTo(0.000721, 9);
    expect(pickProviderCostUsd({ openrouter: { usage: { cost: 0.00004, costDetails: { upstreamInferenceCost: 0.0008 } } } })).toBeCloseTo(0.00084, 9);
  });

  it("counts the cost once when OpenRouter's own credits paid the provider", () => {
    expect(pickProviderCostUsd({ openrouter: { usage: { cost: 0.0034, costDetails: { upstreamInferenceCost: 0 } } } })).toBe(0.0034);
    expect(pickProviderCostUsd({ openrouter: { usage: { cost: 0.0034, costDetails: { upstreamInferenceCost: null } } } })).toBe(0.0034);
  });

  // OpenRouter can report the provider's charge in both fields when its own credits paid: that's one charge, not two.
  it("counts a charge once when OpenRouter's credits paid it and both fields hold it", () => {
    expect(openRouterUsageCost({ cost: 0.0000293, is_byok: false, cost_details: { upstream_inference_cost: 0.0000293 } })).toBeCloseTo(0.0000293, 12);
    // The AI SDK drops `is_byok`: a fee as large as the provider's charge isn't a fee on our own key.
    expect(pickProviderCostUsd({ openrouter: { usage: { cost: 0.0000293, costDetails: { upstreamInferenceCost: 0.0000293 } } } })).toBeCloseTo(0.0000293, 12);
    expect(openRouterUsageCost({ cost: 0.00004, is_byok: true, cost_details: { upstream_inference_cost: 0.0008 } })).toBeCloseTo(0.00084, 9);
  });

  it("reads the raw API's usage the same way", () => {
    expect(openRouterUsageCost({ cost: 0, cost_details: { upstream_inference_cost: 0.0012 } })).toBeCloseTo(0.0012, 9);
    expect(openRouterUsageCost({ cost: 0.002 })).toBe(0.002);
    expect(openRouterUsageCost({ input_tokens: 10 })).toBeNull();
  });

  it("returns null when cost is a string instead of a number", () => {
    expect(
      pickProviderCostUsd({ openrouter: { usage: { cost: "0.01" } } }),
    ).toBeNull();
  });
});
