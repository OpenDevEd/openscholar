import { describe, expect, it } from "vitest";
import {
  FREE_SIGNUP_CREDIT_GRANT,
  getFreeCreditCapForPlan,
} from "../convex/lib/constants";
import { applyTierFreeCreditCap } from "../convex/lib/freeCredits";

describe("free credit cap policy", () => {
  it("defines cap per tier using the selected 1x monthly model", () => {
    expect(getFreeCreditCapForPlan("free")).toBe(FREE_SIGNUP_CREDIT_GRANT);
    expect(getFreeCreditCapForPlan("go")).toBe(6_000);
    expect(getFreeCreditCapForPlan("pro")).toBe(30_000);
    expect(getFreeCreditCapForPlan("enterprise")).toBe(300_000);
  });

  it("clamps under-cap additions at the tier cap", () => {
    const result = applyTierFreeCreditCap({
      plan: "go",
      currentFreeBalance: 5_800,
      amountToAdd: 300,
    });

    expect(result.newFreeBalance).toBe(6_000);
    expect(result.actualAdded).toBe(200);
    expect(result.cap).toBe(6_000);
  });

  it("returns zero added when current balance is exactly at cap", () => {
    const result = applyTierFreeCreditCap({
      plan: "go",
      currentFreeBalance: 6_000,
      amountToAdd: 500,
    });

    expect(result.newFreeBalance).toBe(6_000);
    expect(result.actualAdded).toBe(0);
  });

  it("returns zero added when current balance is already above cap", () => {
    const result = applyTierFreeCreditCap({
      plan: "go",
      currentFreeBalance: 6_500,
      amountToAdd: 200,
    });

    expect(result.newFreeBalance).toBe(6_500);
    expect(result.actualAdded).toBe(0);
  });

  it("keeps non-positive additions uncapped as normal delta operations", () => {
    const result = applyTierFreeCreditCap({
      plan: "go",
      currentFreeBalance: 6_500,
      amountToAdd: -200,
    });

    expect(result.newFreeBalance).toBe(6_300);
    expect(result.actualAdded).toBe(-200);
  });
});
