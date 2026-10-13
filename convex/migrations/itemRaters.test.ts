// Who rated each paper in an organization's library, for papers rated before they kept it (#801).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { madeBy } from "../workspaces/actor.test-support";
import { paperKeyOf } from "../../lib/papers/paper-ref";
import { ensureWorkspace } from "../workspaces/create";

it("gives an organization's rated papers who rated them, and leaves a person's own and unrated ones alone", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const { ada, bob } = await t.run(async (ctx) => {
      const [ada, bob] = await Promise.all(["ada", "bob"].map((clerkId) => ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, state: "active", createdAt: 1, updatedAt: 1 })));
      const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Lab", slug: "org_lab", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1, state: "active" });
      for (const clerkUserId of ["ada", "bob"]) await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `orgmem_${clerkUserId}`, clerkUserId, role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
      const lab = await ensureWorkspace(ctx, { kind: "organization", organizationId });
      const saved = (where: { workspaceId: typeof lab; createdBy: typeof ada }, paper: string, rating?: number) =>
        ctx.db.insert("libraryItems", { ...where, openalexId: `https://openalex.org/${paper}`, title: paper, searchableText: paper, savedAt: 1, updatedAt: 1, ...(rating === undefined ? {} : { rating }) });
      // The lab's W1 holds the two members' average from before papers kept who gave it.
      await ctx.db.insert("ratings", { userId: ada, paperId: "https://openalex.org/W1", rating: 4 });
      await ctx.db.insert("ratings", { userId: bob, paperId: "https://openalex.org/W1", rating: 2 });
      await saved({ workspaceId: lab, createdBy: ada }, "W1", 3);
      await saved({ workspaceId: lab, createdBy: ada }, "W2");
      // Ada's own copy keeps her rating, and nobody else's.
      await saved(await madeBy(ctx, ada), "W1", 4);
      return { ada, bob };
    });
    const kept = () =>
      t.run(async (ctx) => (await ctx.db.query("libraryItems").collect()).map(({ paperKey, openalexId, rating, ratingCount, ratedBy }) => [paperKeyOf({ paperKey, openalexId }).slice(-2), rating ?? null, ratingCount ?? null, (ratedBy ?? []).map((one) => [one.userId === ada ? "ada" : one.userId === bob ? "bob" : "?", one.rating])]));
    expect(await t.action(internal.migrations.itemRaters.verify, {})).toBe(1);
    await t.mutation(internal.migrations.itemRaters.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await kept()).toEqual([
      ["W1", 3, 2, [["ada", 4], ["bob", 2]]],
      ["W2", null, null, []],
      ["W1", 4, null, []],
    ]);
    expect(await t.action(internal.migrations.itemRaters.verify, {})).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
