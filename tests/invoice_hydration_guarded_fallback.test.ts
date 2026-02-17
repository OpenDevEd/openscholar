import { describe, expect, it } from "vitest";
import { selectSingletonEntitledSubscriptionId } from "../convex/credits/actions";

describe("invoice hydration guarded fallback", () => {
  it("resolves when exactly one entitled subscription exists", () => {
    const selected = selectSingletonEntitledSubscriptionId([
      { id: "sub_1", status: "active" },
    ]);

    expect(selected).toBe("sub_1");
  });

  it("does not resolve when multiple entitled subscriptions exist", () => {
    const selected = selectSingletonEntitledSubscriptionId([
      { id: "sub_1", status: "active" },
      { id: "sub_2", status: "past_due" },
    ]);

    expect(selected).toBeUndefined();
  });

  it("ignores non-entitled statuses for fallback selection", () => {
    const selected = selectSingletonEntitledSubscriptionId([
      { id: "sub_canceled", status: "canceled" },
      { id: "sub_incomplete", status: "incomplete" },
    ]);

    expect(selected).toBeUndefined();
  });
});
