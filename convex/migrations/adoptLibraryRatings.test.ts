// A saved paper's rating as its people's average of their own (#655).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { madeBy } from "../workspaces/actor.test-support";
import { ensureWorkspace } from "../workspaces/create";

it("makes a rating kept only in the library its rater's own, keeps one they have, and changes nothing run again", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const { ada, bob } = await t.run(async (ctx) => {
      const [ada, bob] = await Promise.all(["ada", "bob"].map((clerkId) => ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, state: "active", createdAt: 1, updatedAt: 1 })));
      const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Lab", slug: "org_lab", clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
      for (const clerkUserId of ["ada", "bob"]) await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `orgmem_${clerkUserId}`, clerkUserId, role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
      const lab = await ensureWorkspace(ctx, { kind: "organization", organizationId });
      const saved = async (where: { workspaceId: Id<"workspaces">; createdBy: Id<"users"> }, paper: string, rating?: number) =>
        ctx.db.insert("libraryItems", { ...where, openalexId: `https://openalex.org/${paper}`, title: paper, searchableText: paper, savedAt: 1, updatedAt: 1, ...(rating === undefined ? {} : { rating }) });
      // Rated in Ada's library alone, as screening and the library page could.
      await saved(await madeBy(ctx, ada), "W1", 4);
      // Rated differently on a search card: the card's rating is hers.
      await saved(await madeBy(ctx, ada), "W2", 5);
      await ctx.db.insert("ratings", { userId: ada, paperId: "https://openalex.org/W2", rating: 2 });
      await saved(await madeBy(ctx, ada), "W3");
      // The lab's copy of W1, saved and rated by Bob: Ada's rating doesn't overwrite his before it's his.
      await saved({ workspaceId: lab, createdBy: bob }, "W1", 2);
      // Saved by Ada unrated, rated 4 by Bob alone: the lab's 4 is his, never hers.
      await saved({ workspaceId: lab, createdBy: ada }, "W4");
      await ctx.db.insert("ratings", { userId: bob, paperId: "https://openalex.org/W4", rating: 4 });
      return { ada, bob };
    });
    const state = () =>
      t.run(async (ctx) => ({
        own: (await ctx.db.query("ratings").collect()).map(({ userId, paperId, rating }) => [userId === ada ? "ada" : "bob", paperId.slice(-2), rating]).sort(),
        saved: (await ctx.db.query("libraryItems").collect()).map(({ createdBy, openalexId, rating }) => [createdBy === bob ? "bob" : "ada", openalexId.slice(-2), rating ?? null]).sort(),
      }));
    const run = async (reset: boolean) => {
      await t.mutation(internal.migrations.adoptLibraryRatings.run, reset ? { reset } : {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    };
    expect(await t.action(internal.migrations.adoptLibraryRatings.verify, {})).toBe(4);
    await run(false);
    const once = await state();
    expect(once).toEqual({
      own: [["ada", "W1", 4], ["ada", "W2", 2], ["bob", "W1", 2], ["bob", "W4", 4]],
      saved: [["ada", "W1", 4], ["ada", "W2", 2], ["ada", "W3", null], ["ada", "W4", 4], ["bob", "W1", 3]],
    });
    await run(true);
    expect(await state()).toEqual(once);
    expect(await t.action(internal.migrations.adoptLibraryRatings.verify, {})).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
