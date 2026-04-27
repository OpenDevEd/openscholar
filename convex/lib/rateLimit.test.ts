import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import schema from "../schema";

describe("rateLimit.consume — batch action buckets", () => {
  it("accepts the first batch-screening consume and the 15th in the same window", async () => {
    const t = convexTest(schema);
    const key = "user_batch_screen_a";

    // capacity is 15 — burn through the bucket up to the limit
    for (let i = 0; i < 15; i++) {
      await t.mutation(internal.lib.rateLimit.consume, {
        name: "batch-screening",
        key,
      });
    }
  });

  it("throws RateLimited on the 16th batch-screening consume in the same window", async () => {
    const t = convexTest(schema);
    const key = "user_batch_screen_b";

    for (let i = 0; i < 15; i++) {
      await t.mutation(internal.lib.rateLimit.consume, {
        name: "batch-screening",
        key,
      });
    }

    const err = await t
      .mutation(internal.lib.rateLimit.consume, {
        name: "batch-screening",
        key,
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConvexError);
    const data = JSON.parse(
      (err as ConvexError<string>).data,
    ) as { kind?: string; name?: string };
    expect(data.kind).toBe("RateLimited");
    expect(data.name).toBe("batch-screening");
  });

  it("throws RateLimited on the 16th batch-translation consume in the same window", async () => {
    const t = convexTest(schema);
    const key = "user_batch_trans_a";

    for (let i = 0; i < 15; i++) {
      await t.mutation(internal.lib.rateLimit.consume, {
        name: "batch-translation",
        key,
      });
    }

    const err = await t
      .mutation(internal.lib.rateLimit.consume, {
        name: "batch-translation",
        key,
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConvexError);
    const data = JSON.parse(
      (err as ConvexError<string>).data,
    ) as { kind?: string; name?: string };
    expect(data.kind).toBe("RateLimited");
    expect(data.name).toBe("batch-translation");
  });

  it("isolates buckets per key: a different user starts with a full bucket", async () => {
    const t = convexTest(schema);

    for (let i = 0; i < 15; i++) {
      await t.mutation(internal.lib.rateLimit.consume, {
        name: "batch-screening",
        key: "u_x",
      });
    }
    // Other user is unaffected.
    await t.mutation(internal.lib.rateLimit.consume, {
      name: "batch-screening",
      key: "u_y",
    });
  });
});
