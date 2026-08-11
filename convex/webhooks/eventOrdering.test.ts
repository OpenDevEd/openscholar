import { describe, expect, it } from "vitest";
import { classifyClerkEvent } from "./eventOrdering";

describe("classifyClerkEvent", () => {
  it("applies the first event and any event newer than the latest application", () => {
    expect(
      classifyClerkEvent({ eventId: "msg_1", occurredAt: 100, existing: null }),
    ).toBe("applied");
    expect(
      classifyClerkEvent({
        eventId: "msg_2",
        occurredAt: 101,
        existing: null,
        latestApplied: { eventId: "msg_1", occurredAt: 100 },
      }),
    ).toBe("applied");
  });

  it("makes an exact message replay a duplicate", () => {
    expect(
      classifyClerkEvent({
        eventId: "msg_1",
        occurredAt: 100,
        existing: { eventId: "msg_1", occurredAt: 100 },
        latestApplied: { eventId: "msg_1", occurredAt: 100 },
      }),
    ).toBe("duplicate");
  });

  it("rejects events older than the latest applied occurrence", () => {
    expect(
      classifyClerkEvent({
        eventId: "msg_old",
        occurredAt: 99,
        existing: null,
        latestApplied: { eventId: "msg_new", occurredAt: 100 },
      }),
    ).toBe("stale");
  });

  it("does not let arrival order break an equal-timestamp tie", () => {
    expect(
      classifyClerkEvent({
        eventId: "msg_other",
        occurredAt: 100,
        existing: null,
        latestApplied: { eventId: "msg_first", occurredAt: 100 },
      }),
    ).toBe("timestamp_conflict");
  });
});
