// A saved paper's rating as its people's average of their own (#655).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { madeBy } from "../workspaces/actor.test-support";

it("makes a rating kept only in the library the person's own, keeps one they have, and changes nothing run again", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const ada = await t.run(async (ctx) => ctx.db.insert("users", { clerkId: "ada", email: "ada@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
    await t.run(async (ctx) => {
      const saved = (openalexId: string, rating?: number) => madeBy(ctx, ada).then((made) => ctx.db.insert("libraryItems", { ...made, openalexId, title: openalexId, searchableText: openalexId, savedAt: 1, updatedAt: 1, ...(rating === undefined ? {} : { rating }) }));
      // Rated in the library alone, as screening and the library page could.
      await saved("https://openalex.org/W1", 4);
      // Rated differently on a search card: the card's rating is hers.
      await saved("https://openalex.org/W2", 5);
      await ctx.db.insert("ratings", { userId: ada, paperId: "https://openalex.org/W2", rating: 2 });
      await saved("https://openalex.org/W3");
    });
    expect(await t.action(internal.migrations.adoptLibraryRatings.verify, {})).toBe(2);
    const state = () =>
      t.run(async (ctx) => ({
        mine: (await ctx.db.query("ratings").collect()).map(({ paperId, rating }) => [paperId, rating]).sort(),
        saved: (await ctx.db.query("libraryItems").collect()).map(({ openalexId, rating }) => [openalexId, rating ?? null]).sort(),
      }));
    await t.mutation(internal.migrations.adoptLibraryRatings.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const once = await state();
    expect(once).toEqual({
      mine: [["https://openalex.org/W1", 4], ["https://openalex.org/W2", 2]],
      saved: [["https://openalex.org/W1", 4], ["https://openalex.org/W2", 2], ["https://openalex.org/W3", null]],
    });
    await t.mutation(internal.migrations.adoptLibraryRatings.run, { reset: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await state()).toEqual(once);
    expect(await t.action(internal.migrations.adoptLibraryRatings.verify, {})).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
