import { describe, expect, it } from "vitest";
import { pickProviderCostUsd } from "./pick-provider-cost";

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

  it("returns null when cost is a string instead of a number", () => {
    expect(
      pickProviderCostUsd({ openrouter: { usage: { cost: "0.01" } } }),
    ).toBeNull();
  });
});
