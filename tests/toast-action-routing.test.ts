import { describe, expect, it } from "vitest";
import { resolveToastActionRoute } from "../lib/toast/action-routing";

describe("toast action routing", () => {
  it("routes AI settings related codes to /settings/ai", () => {
    expect(resolveToastActionRoute("AI_CREDITS_DISABLED")).toBe("/settings/ai");
    expect(resolveToastActionRoute("AI_VALIDATION_ERROR")).toBe("/settings/ai");
    expect(resolveToastActionRoute("API_KEY_INVALID_FORMAT")).toBe("/settings/ai");
  });

  it("routes AI_API_KEY_REQUIRED to /sign-in (secondary action handles /settings/ai)", () => {
    expect(resolveToastActionRoute("AI_API_KEY_REQUIRED")).toBe("/sign-in");
  });

  it("routes unauthenticated codes to /sign-in", () => {
    expect(resolveToastActionRoute("AI_UNAUTHENTICATED")).toBe("/sign-in");
    expect(resolveToastActionRoute("UNAUTHENTICATED")).toBe("/sign-in");
  });

  it("routes credit related codes to /settings/billing", () => {
    expect(resolveToastActionRoute("AI_INSUFFICIENT_CREDITS")).toBe("/settings/billing");
    expect(resolveToastActionRoute("INSUFFICIENT_CREDITS")).toBe("/settings/billing");
    expect(resolveToastActionRoute("CREDITS_TOPUP_BUNDLE_INVALID")).toBe("/settings/billing");
    expect(resolveToastActionRoute("CREDITS_PRODUCT_NOT_CONFIGURED")).toBe("/settings/billing");
  });

  it("routes plan entitlement codes to /pricing", () => {
    expect(resolveToastActionRoute("AI_PLAN_ENTITLEMENT")).toBe("/pricing");
    expect(resolveToastActionRoute("EXTRACTION_PLAN_REQUIRED")).toBe("/pricing");
  });

  it("returns undefined when no route applies", () => {
    expect(resolveToastActionRoute(undefined)).toBeUndefined();
    expect(resolveToastActionRoute("BILLING_NETWORK_ERROR")).toBeUndefined();
  });
});
