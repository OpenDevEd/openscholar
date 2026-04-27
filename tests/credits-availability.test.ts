import { describe, expect, it } from "vitest";

import { hasEnoughCredits } from "@/lib/credits/availability";

describe("hasEnoughCredits", () => {
  it("returns false when balance is null", () => {
    expect(hasEnoughCredits({ balance: null, required: 1 })).toBe(false);
  });

  it("returns false when balance is undefined", () => {
    expect(hasEnoughCredits({ balance: undefined, required: 1 })).toBe(false);
  });

  it("returns false when balance.total is less than required", () => {
    expect(hasEnoughCredits({ balance: { total: 5 }, required: 20 })).toBe(false);
  });

  it("returns true when balance.total exactly equals required", () => {
    expect(hasEnoughCredits({ balance: { total: 20 }, required: 20 })).toBe(true);
  });

  it("returns true when balance.total exceeds required", () => {
    expect(hasEnoughCredits({ balance: { total: 100 }, required: 20 })).toBe(true);
  });

  it("returns true for a non-null balance when required is 0", () => {
    expect(hasEnoughCredits({ balance: { total: 0 }, required: 0 })).toBe(true);
    expect(hasEnoughCredits({ balance: { total: 50 }, required: 0 })).toBe(true);
  });
});
