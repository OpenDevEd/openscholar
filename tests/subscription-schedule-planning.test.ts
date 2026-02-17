import { describe, expect, it } from "vitest";
import {
  buildDowngradeSchedulePhases,
  determineChangeType,
  findPendingScheduleChange,
  isReleasableScheduleStatus,
  resolveCurrentPhaseBounds,
  shouldReleaseScheduleForChange,
} from "../convex/subscriptions/lib/schedulePlanning";

describe("subscription schedule planning", () => {
  it("builds downgrade phases from existing current phase bounds", () => {
    const phases = buildDowngradeSchedulePhases({
      currentPhaseStart: 1_700_000_000,
      currentPhaseEnd: 1_700_086_400,
      currentPriceId: "price_pro",
      currentQuantity: 1,
      targetPriceId: "price_go",
    });

    expect(phases[0]?.start_date).toBe(1_700_000_000);
    expect(phases[0]?.end_date).toBe(1_700_086_400);
    expect(phases[1]?.start_date).toBe(1_700_086_400);
    expect(phases[1]?.items[0]?.price).toBe("price_go");
  });

  it("detects a pending future phase with a different target price", () => {
    const pending = findPendingScheduleChange({
      currentPriceId: "price_pro",
      schedule: {
        status: "active",
        current_phase: {
          start_date: 1_700_000_000,
          end_date: 1_700_086_400,
        },
        phases: [
          {
            start_date: 1_700_000_000,
            end_date: 1_700_086_400,
            items: [{ price: "price_pro", quantity: 1 }],
          },
          {
            start_date: 1_700_086_400,
            items: [{ price: "price_go", quantity: 1 }],
          },
        ],
      },
    });

    expect(pending.hasPendingChange).toBe(true);
    expect(pending.targetPriceId).toBe("price_go");
    expect(pending.effectiveDate).toBe(1_700_086_400);
  });

  it("does not mark pending changes when future phases keep the same price", () => {
    const pending = findPendingScheduleChange({
      currentPriceId: "price_pro",
      schedule: {
        status: "active",
        current_phase: {
          start_date: 1_700_000_000,
          end_date: 1_700_086_400,
        },
        phases: [
          {
            start_date: 1_700_000_000,
            end_date: 1_700_086_400,
            items: [{ price: "price_pro", quantity: 1 }],
          },
          {
            start_date: 1_700_086_400,
            items: [{ price: "price_pro", quantity: 1 }],
          },
        ],
      },
    });

    expect(pending.hasPendingChange).toBe(false);
    expect(pending.targetPriceId).toBeUndefined();
  });

  it("classifies change outcomes deterministically", () => {
    expect(
      determineChangeType({
        currentTier: 20,
        targetTier: 30,
        hasPendingScheduledChange: false,
      }),
    ).toBe("upgraded_immediately");
    expect(
      determineChangeType({
        currentTier: 20,
        targetTier: 10,
        hasPendingScheduledChange: false,
      }),
    ).toBe("downgrade_scheduled");
    expect(
      determineChangeType({
        currentTier: 20,
        targetTier: 20,
        hasPendingScheduledChange: true,
      }),
    ).toBe("pending_change_cleared");
    expect(
      determineChangeType({
        currentTier: 20,
        targetTier: 20,
        hasPendingScheduledChange: false,
      }),
    ).toBe("no_change");
  });

  it("treats only active and not_started schedules as releasable", () => {
    expect(isReleasableScheduleStatus("active")).toBe(true);
    expect(isReleasableScheduleStatus("not_started")).toBe(true);
    expect(isReleasableScheduleStatus("released")).toBe(false);
    expect(isReleasableScheduleStatus("completed")).toBe(false);
  });

  it("releases schedules only for immediate upgrade or pending-change clear", () => {
    expect(
      shouldReleaseScheduleForChange({
        changeType: "upgraded_immediately",
        scheduleStatus: "active",
      }),
    ).toBe(true);
    expect(
      shouldReleaseScheduleForChange({
        changeType: "pending_change_cleared",
        scheduleStatus: "not_started",
      }),
    ).toBe(true);
    expect(
      shouldReleaseScheduleForChange({
        changeType: "downgrade_scheduled",
        scheduleStatus: "active",
      }),
    ).toBe(false);
    expect(
      shouldReleaseScheduleForChange({
        changeType: "upgraded_immediately",
        scheduleStatus: "completed",
      }),
    ).toBe(false);
  });

  it("resolves valid current phase bounds with fallback support", () => {
    expect(
      resolveCurrentPhaseBounds({
        schedule: null,
        fallbackStart: 10,
        fallbackEnd: 20,
      }),
    ).toEqual({ startDate: 10, endDate: 20 });

    expect(() =>
      resolveCurrentPhaseBounds({
        schedule: { current_phase: { start_date: 20, end_date: 10 } },
        fallbackStart: 10,
        fallbackEnd: 20,
      }),
    ).toThrow("Unable to determine valid schedule phase boundaries");
  });
});
