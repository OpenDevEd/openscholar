import { describe, expect, it } from "vitest";
import {
  isEntitledStatus,
  resolveEffectivePlan,
  type SubscriptionLike,
} from "../lib/billing/entitlements";

describe("subscription entitlements", () => {
  it("keeps access for grace statuses", () => {
    expect(isEntitledStatus("active")).toBe(true);
    expect(isEntitledStatus("trialing")).toBe(true);
    expect(isEntitledStatus("past_due")).toBe(true);
  });

  it("cuts off access for terminal and payment-pending statuses", () => {
    expect(isEntitledStatus("incomplete")).toBe(false);
    expect(isEntitledStatus("unpaid")).toBe(false);
    expect(isEntitledStatus("incomplete_expired")).toBe(false);
    expect(isEntitledStatus("canceled")).toBe(false);
    expect(isEntitledStatus("paused")).toBe(false);
  });

  it("resolves effective plan to free when not entitled", () => {
    const unpaidPro: SubscriptionLike = { plan: "pro", status: "unpaid" };
    const activePro: SubscriptionLike = { plan: "pro", status: "active" };

    expect(resolveEffectivePlan(unpaidPro)).toBe("free");
    expect(resolveEffectivePlan(activePro)).toBe("pro");
    expect(resolveEffectivePlan(null)).toBe("free");
  });
});
