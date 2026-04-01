import { describe, expect, it } from "vitest";
import {
  FREE_SIGNUP_CREDIT_GRANT,
  PLAN_CONFIG,
  getFreeCreditCapForPlan,
} from "../convex/lib/constants";
import { applyTierFreeCreditCap } from "../convex/lib/freeCredits";

describe("free credit cap policy", () => {
  it("defines cap per tier using the selected 1x monthly model", () => {
    expect(getFreeCreditCapForPlan("free")).toBe(FREE_SIGNUP_CREDIT_GRANT);
    expect(getFreeCreditCapForPlan("go")).toBe(PLAN_CONFIG.go.freeCreditCap);
    expect(getFreeCreditCapForPlan("pro")).toBe(PLAN_CONFIG.pro.freeCreditCap);
    expect(getFreeCreditCapForPlan("enterprise")).toBe(PLAN_CONFIG.enterprise.freeCreditCap);
  });

  it("clamps under-cap additions at the tier cap", () => {
    const result = applyTierFreeCreditCap({
      plan: "go",
      currentFreeBalance: 5_800,
      amountToAdd: 300,
    });

    expect(result.newFreeBalance).toBe(PLAN_CONFIG.go.freeCreditCap);
    expect(result.actualAdded).toBe(200);
    expect(result.cap).toBe(PLAN_CONFIG.go.freeCreditCap);
  });

  it("returns zero added when current balance is exactly at cap", () => {
    const result = applyTierFreeCreditCap({
      plan: "go",
      currentFreeBalance: PLAN_CONFIG.go.freeCreditCap,
      amountToAdd: 500,
    });

    expect(result.newFreeBalance).toBe(PLAN_CONFIG.go.freeCreditCap);
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
