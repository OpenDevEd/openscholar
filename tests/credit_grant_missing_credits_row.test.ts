import { describe, expect, it } from "vitest";
import { buildInitialCreditsRecord } from "../convex/credits/internal";
import type { Id } from "../convex/_generated/dataModel";

describe("credit grant missing credits row remediation", () => {
  it("builds a zeroed credits record for auto-heal creation", () => {
    const row = buildInitialCreditsRecord({
      userId: "user_123" as unknown as Id<"users">,
      now: 1_700_000_000_000,
    });

    expect(row).toEqual({
      userId: "user_123",
      freeBalance: 0,
      paidBalance: 0,
      lifetimeUsed: 0,
      lastUpdatedAt: 1_700_000_000_000,
    });
  });
});
