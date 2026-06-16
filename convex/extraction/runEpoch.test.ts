import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

async function seedUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("users", {
      clerkId: "clerk_run_epoch",
      email: "run-epoch@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("runEpoch defaults", () => {
  it("createJobDirect initializes new extraction jobs at epoch 0", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    const jobId = await t.mutation(
      internal.extraction.mutations.internal.lifecycle.createJobDirect,
      {
        userId,
        name: "Epoch Default Job",
        sourceType: "history",
        bucketItems: [
          {
            bucketKey: "history:epoch-default",
            source: "history",
            sourceRefId: "epoch-default",
            title: "Epoch Default",
            authors: [],
          },
        ],
      },
    );

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.runEpoch).toBe(0);
  });
});
