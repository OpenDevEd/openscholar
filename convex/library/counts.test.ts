// A person's library count has its own row, so library saves never rewrite the user row that
// every mutation of theirs reads (#383).
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const seedUser = (t: ReturnType<typeof convexTest>, clerkId: string, libraryItemCount?: number) =>
  t.run((ctx) => ctx.db.insert("users", { clerkId, email: `${clerkId}@test.local`, state: "active", createdAt: 1, updatedAt: 1, ...(libraryItemCount === undefined ? {} : { libraryItemCount }) }));

describe("library counts", () => {
  it("counts in their own row, started from the count on the user row, which saves leave alone", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "alice", 5);
    const before = await t.run((ctx) => ctx.db.get("users", userId));
    const alice = t.withIdentity({ subject: "alice" });

    await alice.mutation(api.library.mutations.saveToLibrary, { openalexId: "https://openalex.org/W1", title: "One" });
    await alice.mutation(api.library.mutations.saveToLibrary, { openalexId: "https://openalex.org/W2", rating: 4, title: "Two" });
    expect(await alice.query(api.library.queries.getLibraryCount, {})).toBe(7);
    await alice.mutation(api.library.mutations.removeFromLibrary, { openalexId: "https://openalex.org/W1" });
    expect(await alice.query(api.library.queries.getLibraryCount, {})).toBe(6);

    const { user, rows } = await t.run(async (ctx) => ({ user: await ctx.db.get("users", userId), rows: await ctx.db.query("libraryCounts").collect() }));
    expect(user).toEqual(before);
    expect(rows.map(({ userId: owner, count }) => ({ owner, count }))).toEqual([{ owner: userId, count: 6 }]);
  });

  it("migrates every count to a row once, keeping a newer row, and verify lists anyone left", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const counted = await seedUser(t, "counted", 3);
      const saver = await seedUser(t, "saver", 2);
      await seedUser(t, "uncounted");
      // Saving since the deploy gave this person a newer row than their user row says.
      await t.withIdentity({ subject: "saver" }).mutation(api.library.mutations.saveToLibrary, { openalexId: "https://openalex.org/W9", title: "Nine" });

      await t.mutation(internal.migrations.moveLibraryCounts.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const rows = await t.run((ctx) => ctx.db.query("libraryCounts").collect());
      expect(Object.fromEntries(rows.map((row) => [row.userId, row.count]))).toEqual({ [counted]: 3, [saver]: 3 });
      // Someone without a count is left for backfillUsers, then a run from the start.
      expect(await t.action(internal.migrations.moveLibraryCounts.verify, {})).toEqual({ missing: 1, sample: [expect.stringContaining("no library count row")] });
      await t.action(internal.migrations.backfillLibraryCounters.backfillUsers, {});
      await t.mutation(internal.migrations.moveLibraryCounts.run, { reset: true });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await t.action(internal.migrations.moveLibraryCounts.verify, {})).toEqual({ missing: 0, sample: [] });
      expect((await t.run((ctx) => ctx.db.query("libraryCounts").collect())).map((row) => row.count).sort()).toEqual([0, 3, 3]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a person's count row", () => {
  it("starts at zero with a new account, and goes when the account is removed", async () => {
    const t = convexTest(schema);
    const userId = await t.withIdentity({ subject: "fresh", email: "fresh@test.local" }).mutation(api.users.mutations.ensureUser, {});
    const rowsOf = () => t.run((ctx) => ctx.db.query("libraryCounts").withIndex("by_user", (q) => q.eq("userId", userId)).collect());
    expect((await rowsOf()).map((row) => row.count)).toEqual([0]);

    // Past the retention period, cleanup removes a deleted account and what it held.
    await t.run((ctx) => ctx.db.patch("users", userId, { state: "deleted", updatedAt: 1 }));
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    expect(await t.run((ctx) => ctx.db.get("users", userId))).toBeNull();
    expect(await rowsOf()).toEqual([]);
  });
});
