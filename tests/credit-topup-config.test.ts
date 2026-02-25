import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_CREDITS_PER_USD = process.env.CREDITS_PER_USD;

async function loadModule() {
  vi.resetModules();
  return import("../convex/lib/creditTopups");
}

afterEach(() => {
  if (ORIGINAL_CREDITS_PER_USD === undefined) {
    delete process.env.CREDITS_PER_USD;
  } else {
    process.env.CREDITS_PER_USD = ORIGINAL_CREDITS_PER_USD;
  }
});

describe("credit topup config", () => {
  it("falls back to default conversion rate when env is absent or invalid", async () => {
    delete process.env.CREDITS_PER_USD;
    let topups = await loadModule();
    expect(topups.getCreditsPerUsd()).toBe(10_000);

    process.env.CREDITS_PER_USD = "0";
    topups = await loadModule();
    expect(topups.getCreditsPerUsd()).toBe(10_000);

    process.env.CREDITS_PER_USD = "not-a-number";
    topups = await loadModule();
    expect(topups.getCreditsPerUsd()).toBe(10_000);
  });

  it("uses env conversion rate for catalog pricing and credit conversion", async () => {
    process.env.CREDITS_PER_USD = "125";
    const topups = await loadModule();

    expect(topups.getCreditsPerUsd()).toBe(125);
    expect(topups.convertDollarsToCredits(2)).toBe(250);
    expect(topups.convertCreditsToAmountCents(1_000)).toBe(800);

    const catalog = topups.getCreditTopupCatalog();
    expect(catalog.map((bundle) => bundle.credits)).toEqual([10_000, 50_000, 100_000]);
    expect(catalog.map((bundle) => bundle.amountCents)).toEqual([8_000, 40_000, 80_000, 200_000]);
    expect(catalog.every((bundle) => bundle.currency === "usd")).toBe(true);
  });
});
