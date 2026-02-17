import { describe, expect, it } from "vitest";
import {
  selectLatestTrackedGrantEvent,
  TRACKED_GRANT_EVENT_TYPES,
} from "../convex/credits/queries";

describe("grant diagnostics event selection", () => {
  it("selects latest tracked grant-related event", () => {
    const latest = selectLatestTrackedGrantEvent([
      {
        eventType: "customer.subscription.updated",
        updatedAt: 10,
      },
      {
        eventType: TRACKED_GRANT_EVENT_TYPES[0],
        updatedAt: 20,
      },
      {
        eventType: TRACKED_GRANT_EVENT_TYPES[1],
        updatedAt: 30,
      },
    ]);

    expect(latest?.eventType).toBe(TRACKED_GRANT_EVENT_TYPES[1]);
    expect(latest?.updatedAt).toBe(30);
  });

  it("returns undefined when no tracked events are present", () => {
    const latest = selectLatestTrackedGrantEvent([
      {
        eventType: "checkout.session.completed",
        updatedAt: 10,
      },
    ]);

    expect(latest).toBeUndefined();
  });
});
