// A person's library count has its own row, so library saves never rewrite the user row that
// every mutation of theirs reads (#383).
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { personalWorkspaceOf } from "../workspaces/personal";

const seedUser = (t: ReturnType<typeof convexTest>, clerkId: string) =>
  t.run((ctx) => ctx.db.insert("users", { clerkId, email: `${clerkId}@test.local`, state: "active", createdAt: 1, updatedAt: 1 }));

describe("library counts", () => {
  it("counts in their own row, which saves start when missing, and leave the user row alone", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "alice");
    const before = await t.run((ctx) => ctx.db.get("users", userId));
    const alice = t.withIdentity({ subject: "alice" });

    await alice.mutation(api.library.mutations.saveToLibrary, { openalexId: "https://openalex.org/W1", title: "One" });
    await alice.mutation(api.library.mutations.saveToLibrary, { openalexId: "https://openalex.org/W2", rating: 4, title: "Two" });
    expect(await alice.query(api.library.queries.getLibraryCount, {})).toBe(2);
    await alice.mutation(api.library.mutations.removeFromLibrary, { openalexId: "https://openalex.org/W1" });
    expect(await alice.query(api.library.queries.getLibraryCount, {})).toBe(1);

    const { user, rows } = await t.run(async (ctx) => ({ user: await ctx.db.get("users", userId), rows: await ctx.db.query("libraryCounts").collect() }));
    expect(user).toEqual(before);
    expect(rows.map(({ workspaceId, count }) => ({ workspaceId, count }))).toEqual([{ workspaceId: await t.run((ctx) => personalWorkspaceOf(ctx, userId)), count: 1 }]);
  });

});

describe("a person's count row", () => {
  it("starts at zero with a new account, and goes when the account is removed", async () => {
    const t = convexTest(schema);
    const userId = await t.withIdentity({ subject: "fresh", email: "fresh@test.local" }).mutation(api.users.mutations.ensureUser, {});
    const workspaceId = await t.run((ctx) => personalWorkspaceOf(ctx, userId));
    const rowsOf = () => t.run((ctx) => ctx.db.query("libraryCounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect());
    expect((await rowsOf()).map((row) => row.count)).toEqual([0]);

    // Past the retention period, cleanup removes a deleted account and what it held.
    await t.run((ctx) => ctx.db.patch("users", userId, { state: "deleted", updatedAt: 1 }));
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    expect(await t.run((ctx) => ctx.db.get("users", userId))).toBeNull();
    expect(await rowsOf()).toEqual([]);
  });
});
