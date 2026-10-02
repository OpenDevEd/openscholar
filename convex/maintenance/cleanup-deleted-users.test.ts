import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const STALE_MARGIN_MS = 60 * 60 * 1000;

async function insertDeletedUser(
  t: ReturnType<typeof convexTest>,
  args: {
    email: string;
    updatedAt: number;
  },
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      clerkId: `clerk_${args.email}`,
      email: args.email,
      state: "deleted" as const,
      createdAt: args.updatedAt,
      updatedAt: args.updatedAt,
    })
  );
}

async function insertExtractionJob(
  t: ReturnType<typeof convexTest>,
  userId: Awaited<ReturnType<typeof insertDeletedUser>>,
  index: number,
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("extractionJobs", {
      userId,
      sourceType: "manual" as const,
      status: "completed" as const,
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      name: `Cleanup blocked job ${index}`,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("cleanupDeletedUsers", () => {
  it("ignores deleted users that are still inside the retention period", async () => {
    const t = convexTest(schema);
    const now = Date.now();

    for (let index = 0; index < 50; index++) {
      await insertDeletedUser(t, {
        email: `retained-${index}@test.com`,
        updatedAt: now,
      });
    }

    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});

    vi.useFakeTimers();
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_state", (q) => q.eq("state", "deleted"))
        .collect()
    );
    expect(remaining).toHaveLength(50);
  });

  it("continues only after hard-deleting a full eligible batch", async () => {
    const t = convexTest(schema);
    const staleUpdatedAt = Date.now() - RETENTION_MS - STALE_MARGIN_MS;

    for (let index = 0; index < 51; index++) {
      await insertDeletedUser(t, {
        email: `stale-${index}@test.com`,
        updatedAt: staleUpdatedAt + index,
      });
    }

    vi.useFakeTimers();
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_state", (q) => q.eq("state", "deleted"))
        .collect()
    );
    expect(remaining).toHaveLength(0);
  });

  it("does not immediately reschedule cleanup when extraction cascades are still draining", async () => {
    const t = convexTest(schema);
    const staleUpdatedAt = Date.now() - RETENTION_MS - STALE_MARGIN_MS;

    const blockedUserId = await insertDeletedUser(t, {
      email: "blocked@test.com",
      updatedAt: staleUpdatedAt,
    });

    for (let index = 0; index < 50; index++) {
      await insertExtractionJob(t, blockedUserId, index);
    }

    for (let index = 0; index < 49; index++) {
      await insertDeletedUser(t, {
        email: `stale-clean-${index}@test.com`,
        updatedAt: staleUpdatedAt + index + 1,
      });
    }

    vi.useFakeTimers();
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    const { blockedUser, blockedJobs, deletedUsers } = await t.run(async (ctx) => ({
      blockedUser: await ctx.db.get(blockedUserId),
      blockedJobs: await ctx.db
        .query("extractionJobs")
        .withIndex("by_user", (q) => q.eq("userId", blockedUserId))
        .collect(),
      deletedUsers: await ctx.db
        .query("users")
        .withIndex("by_state", (q) => q.eq("state", "deleted"))
        .collect(),
    }));

    expect(blockedUser).not.toBeNull();
    expect(blockedJobs).toHaveLength(0);
    expect(deletedUsers).toHaveLength(1);
  });
});
