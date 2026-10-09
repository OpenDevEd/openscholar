// Clearing the person library rows belonged to before workspaces (#650, slice 8).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { personalWorkspaceOf } from "../workspaces/personal";
import { countInRange } from "../library/facets";

it("clears the person a paper, collection, place, removal and count named, keeps who made them, gives an older removed paper its maker, and changes nothing run again", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const ada = await t.run(async (ctx) => ctx.db.insert("users", { clerkId: "ada", email: "ada@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
    const own = await t.run(async (ctx) => personalWorkspaceOf(ctx, ada));
    const paper = { workspaceId: own, createdBy: ada, openalexId: "https://openalex.org/W1", title: "Tutoring", searchableText: "Tutoring", savedAt: 1, updatedAt: 1 };
    await runUntriggered(t, async (ctx) => {
      const itemId = await ctx.db.insert("libraryItems", { userId: ada, ...paper });
      const collectionId = await ctx.db.insert("collections", { userId: ada, workspaceId: own, createdBy: ada, name: "Trials", sortName: "trials", itemCount: 1, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("libraryItemCollections", { userId: ada, collectionId, libraryItemId: itemId, assignedAt: 1 });
      const { workspaceId: _workspace, ...item } = paper;
      await ctx.db.insert("libraryRemovals", { userId: ada, workspaceId: own, item, itemId, expiresAt: 2 });
      // One from before makers were kept.
      const { createdBy: _maker, ...unmade } = item;
      await ctx.db.insert("libraryRemovals", { userId: ada, workspaceId: own, item: unmade, itemId, expiresAt: 2 });
      await ctx.db.insert("libraryCounts", { userId: ada, workspaceId: own, count: 1 });
      await ctx.db.insert("collectionCounts", { userId: ada, workspaceId: own, count: 1 });
    });
    // One counted as papers were before workspaces: under its person as well as its workspace.
    await t.run((ctx) => ctx.db.insert("libraryItems", { ...paper, userId: ada, openalexId: "https://openalex.org/W2", savedAt: 2 }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const counted = () => t.run(async (ctx) => [await countInRange(ctx, ada, "savedAt", {}), await countInRange(ctx, own, "savedAt", {})]);
    expect(await counted()).toEqual([1, 1]);
    expect(await t.action(internal.migrations.narrowLibrary.verify, {})).toBe(8);
    const rows = () => t.run(async (ctx) => ({
      papers: await ctx.db.query("libraryItems").collect(),
      collections: await ctx.db.query("collections").collect(),
      places: await ctx.db.query("libraryItemCollections").collect(),
      removals: await ctx.db.query("libraryRemovals").collect(),
      libraryCounts: await ctx.db.query("libraryCounts").collect(),
      collectionCounts: await ctx.db.query("collectionCounts").collect(),
    }));
    await t.mutation(internal.migrations.narrowLibrary.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const once = await rows();
    // Its count under its person went with the person.
    expect(await counted()).toEqual([0, 1]);
    expect(Object.values(once).flat().every((row) => !("userId" in row))).toBe(true);
    expect([...once.papers, ...once.collections, ...once.removals.map((removal) => removal.item)]).toMatchObject([{ createdBy: ada }, { createdBy: ada }, { createdBy: ada }, { createdBy: ada }, { createdBy: ada }]);
    await t.mutation(internal.migrations.narrowLibrary.run, { reset: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await rows()).toEqual(once);
    expect(await t.action(internal.migrations.narrowLibrary.verify, {})).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
