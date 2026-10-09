// Copying ratings from before the ratings table (#655).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

it("copies each rating as its person's own, keeps a newer copy in step, and changes nothing run again", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const ada = await t.run(async (ctx) => ctx.db.insert("users", { clerkId: "ada", email: "ada@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
    await t.run(async (ctx) => {
      await ctx.db.insert("paperRatings", { userId: ada, data: { paperId: "https://openalex.org/W1", rating: 4 } });
      await ctx.db.insert("paperRatings", { userId: ada, data: { paperId: "https://openalex.org/W2", rating: 2 } });
      // A copy that drifted: the rating it was copied from is what counts.
      await ctx.db.insert("ratings", { userId: ada, paperId: "https://openalex.org/W2", rating: 5 });
    });
    expect(await t.action(internal.migrations.copyRatings.verify, {})).toBe(2);
    const rows = () => t.run(async (ctx) => (await ctx.db.query("ratings").collect()).map(({ userId, paperId, collectionId, rating }) => ({ userId, paperId, collectionId, rating })));
    await t.mutation(internal.migrations.copyRatings.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const once = await rows();
    expect(once).toEqual(expect.arrayContaining([
      { userId: ada, paperId: "https://openalex.org/W1", collectionId: undefined, rating: 4 },
      { userId: ada, paperId: "https://openalex.org/W2", collectionId: undefined, rating: 2 },
    ]));
    expect(once).toHaveLength(2);
    await t.mutation(internal.migrations.copyRatings.run, { reset: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await rows()).toEqual(once);
    expect(await t.action(internal.migrations.copyRatings.verify, {})).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
