import { describe, expect, it } from "vitest";
import { shouldSkipProcessedTransition } from "../convex/subscriptions/lib/eventLogPolicy";

describe("stripe event log transition policy", () => {
  it("keeps ignored events from being overwritten to processed", () => {
    expect(
      shouldSkipProcessedTransition({
        status: "ignored",
        now: Date.now(),
      }),
    ).toBe(true);
  });

  it("keeps retrying events locked until retry time", () => {
    const now = Date.now();
    expect(
      shouldSkipProcessedTransition({
        status: "retrying",
        nextRetryAt: now + 10_000,
        now,
      }),
    ).toBe(true);
    expect(
      shouldSkipProcessedTransition({
        status: "retrying",
        nextRetryAt: now - 1,
        now,
      }),
    ).toBe(false);
  });

  it("allows received events to transition to processed but keeps failed visible", () => {
    const now = Date.now();
    expect(
      shouldSkipProcessedTransition({
        status: "received",
        now,
      }),
    ).toBe(false);
    expect(
      shouldSkipProcessedTransition({
        status: "failed",
        now,
      }),
    ).toBe(true);
  });
});
