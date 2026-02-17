import { describe, expect, it } from "vitest";
import { isSubscriptionScheduledToCancel } from "../convex/subscriptions/lib/cancellation";

describe("subscription cancellation policy", () => {
  it("returns true when cancel_at_period_end is true", () => {
    expect(
      isSubscriptionScheduledToCancel({
        cancelAtPeriodEnd: true,
        cancelAt: null,
        currentPeriodEnd: 1_700_000_000,
      }),
    ).toBe(true);
  });

  it("returns true for future cancel_at even when cancel_at_period_end is false", () => {
    expect(
      isSubscriptionScheduledToCancel({
        cancelAtPeriodEnd: false,
        cancelAt: 1_800_000_000,
        currentPeriodEnd: 1_800_000_000,
        nowUnixSeconds: 1_700_000_000,
      }),
    ).toBe(true);
  });

  it("returns false for past cancel_at", () => {
    expect(
      isSubscriptionScheduledToCancel({
        cancelAtPeriodEnd: false,
        cancelAt: 1_600_000_000,
        currentPeriodEnd: 1_600_000_000,
        nowUnixSeconds: 1_700_000_000,
      }),
    ).toBe(false);
  });
});
