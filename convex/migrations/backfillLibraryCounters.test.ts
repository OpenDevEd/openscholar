// The library counter migration leaves every user and collection with an exact count,
// and `verify` says so (#353).
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

describe("backfillLibraryCounters", () => {
  it("counts users and collections saved before counts were kept, and corrects wrong collection counts", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const { userId, missing, wrong } = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { clerkId: "counted", email: "c@test", state: "active", createdAt: 1, updatedAt: 1 });
        const items = [];
        for (let i = 0; i < 3; i++) items.push(await ctx.db.insert("libraryItems", { userId, openalexId: `W${i}`, rating: 3, title: `P${i}`, searchableText: "p", savedAt: i, updatedAt: i }));
        const missing = await ctx.db.insert("collections", { userId, name: "No count", createdAt: 1, updatedAt: 1 });
        const wrong = await ctx.db.insert("collections", { userId, name: "Wrong count", itemCount: 5, createdAt: 1, updatedAt: 1 });
        for (const libraryItemId of items.slice(0, 2)) await ctx.db.insert("libraryItemCollections", { userId, collectionId: missing, libraryItemId, assignedAt: 1 });
        await ctx.db.insert("libraryItemCollections", { userId, collectionId: wrong, libraryItemId: items[2], assignedAt: 1 });
        return { userId, missing, wrong };
      });
      const before = await t.action(internal.migrations.backfillLibraryCounters.verify, {});
      expect(before.usersWithoutCount).toBeGreaterThanOrEqual(1);
      expect(before.wrongCollections).toHaveLength(2);

      expect(await t.action(internal.migrations.backfillLibraryCounters.backfillUsers, { dryRun: true })).toMatchObject({ set: 0 });
      await t.action(internal.migrations.backfillLibraryCounters.backfillUsers, {});
      await t.mutation(internal.migrations.backfillLibraryCounters.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(await t.action(internal.migrations.backfillLibraryCounters.verify, {})).toEqual({ usersWithoutCount: 0, wrongCollections: [] });
      const [user, first, second] = await t.run((ctx) => Promise.all([ctx.db.get("users", userId), ctx.db.get("collections", missing), ctx.db.get("collections", wrong)]));
      expect([user?.libraryItemCount, first?.itemCount, second?.itemCount]).toEqual([3, 2, 1]);
    } finally {
      vi.useRealTimers();
    }
  });
});
