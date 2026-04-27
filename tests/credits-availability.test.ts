import { describe, expect, it } from "vitest";

import {
  hasEnoughCredits,
  resolveCreditsAvailability,
} from "@/lib/credits/availability";

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

describe("resolveCreditsAvailability", () => {
  it("returns 'unknown' when not authenticated", () => {
    expect(
      resolveCreditsAvailability({
        isAuthenticated: false,
        settlement: "settled",
        totalCredits: 100,
        requiredCredits: 10,
      }),
    ).toBe("unknown");
  });

  it("returns 'unknown' when settlement is 'loading'", () => {
    expect(
      resolveCreditsAvailability({
        isAuthenticated: true,
        settlement: "loading",
        totalCredits: 100,
        requiredCredits: 10,
      }),
    ).toBe("unknown");
  });

  it("returns 'unknown' when settlement is 'error'", () => {
    expect(
      resolveCreditsAvailability({
        isAuthenticated: true,
        settlement: "error",
        totalCredits: 100,
        requiredCredits: 10,
      }),
    ).toBe("unknown");
  });

  it("returns 'unavailable' when settled, authenticated, and totalCredits < requiredCredits", () => {
    expect(
      resolveCreditsAvailability({
        isAuthenticated: true,
        settlement: "settled",
        totalCredits: 3,
        requiredCredits: 10,
      }),
    ).toBe("unavailable");
  });

  it("returns 'unavailable' when settled, authenticated, and totalCredits is undefined", () => {
    expect(
      resolveCreditsAvailability({
        isAuthenticated: true,
        settlement: "settled",
        totalCredits: undefined,
        requiredCredits: 10,
      }),
    ).toBe("unavailable");
  });

  it("returns 'available' when settled, authenticated, and totalCredits >= requiredCredits", () => {
    expect(
      resolveCreditsAvailability({
        isAuthenticated: true,
        settlement: "settled",
        totalCredits: 10,
        requiredCredits: 10,
      }),
    ).toBe("available");
    expect(
      resolveCreditsAvailability({
        isAuthenticated: true,
        settlement: "settled",
        totalCredits: 100,
        requiredCredits: 10,
      }),
    ).toBe("available");
  });

  it("returns 'unavailable' for totalCredits=5, requiredCredits=10 (the bug-class missed by '> 0' checks)", () => {
    expect(
      resolveCreditsAvailability({
        isAuthenticated: true,
        settlement: "settled",
        totalCredits: 5,
        requiredCredits: 10,
      }),
    ).toBe("unavailable");
  });
});
