// Library views at any size (#633): a collection's view reads its own memberships, which copy
// their paper's fields, and filtered counts come from kept counts, exact past any cap.
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { runUntriggered } from "../../tests/convex-test-with-limits";

type Test = ReturnType<typeof convexTest>;

async function setup(t: Test) {
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { clerkId: "reader", email: "reader@test.local", state: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("libraryCounts", { userId: id, count: 0 });
    return id;
  });
  return { userId, as: t.withIdentity({ subject: "reader" }) };
}

const paper = (i: number, fields: { rating?: number; publicationYear?: number } = {}) => ({
  openalexId: `https://openalex.org/W${i}`,
  title: `Paper ${i}`,
  ...fields,
});

describe("library facets", () => {
  it("a rating changed on a paper reaches its collection's view and counts", async () => {
    const t = convexTest(schema);
    const { as } = await setup(t);
    const collectionId = (await as.mutation(api.library.collections.createCollection, { name: "Trials" })).id;
    const ids: Id<"libraryItems">[] = [];
    for (let i = 0; i < 3; i++) {
      const { id } = await as.mutation(api.library.mutations.saveToLibrary, paper(i, { rating: 2 }));
      await as.mutation(api.library.collections.addToCollection, { collectionId, libraryItemId: id });
      ids.push(id);
    }
    await as.mutation(api.library.mutations.setLibraryRating, { openalexId: paper(1).openalexId, rating: 5 });
    await t.finishAllScheduledFunctions(() => {});

    const page = await as.query(api.library.queries.papers, { collectionId, sort: "rating" });
    expect(page.papers[0]).toMatchObject({ libraryItemId: ids[1], rating: 5 });
    expect(page.papers).toHaveLength(3);
    expect(await as.query(api.library.queries.countPapers, { collectionId, minRating: 5 })).toEqual({ count: 1 });
    expect(await as.query(api.library.queries.countPapers, { collectionId, maxRating: 2 })).toEqual({ count: 2 });
    expect(await as.query(api.library.queries.countPapers, { minRating: 5 })).toEqual({ count: 1 });
  });

  it("counts several filters exactly, and papers with no rating", async () => {
    const t = convexTest(schema);
    const { as } = await setup(t);
    const ratings = [undefined, 1, 4, 5, 5, 3, undefined, 4];
    for (const [i, rating] of ratings.entries()) await as.mutation(api.library.mutations.saveToLibrary, paper(i, { ...(rating === undefined ? {} : { rating }), publicationYear: 2016 + i }));
    await t.finishAllScheduledFunctions(() => {});

    const expected = (keep: (rating: number | undefined, year: number) => boolean) => ratings.filter((rating, i) => keep(rating, 2016 + i)).length;
    expect(await as.query(api.library.queries.countPapers, { rated: false })).toEqual({ count: 2 });
    expect(await as.query(api.library.queries.countPapers, { minRating: 4, yearFrom: 2020 })).toEqual({ count: expected((rating, year) => rating !== undefined && rating >= 4 && year >= 2020) });
    expect(await as.query(api.library.queries.countPapers, { rated: false, yearTo: 2018 })).toEqual({ count: 1 });
    expect(await as.query(api.library.queries.countPapers, { yearFrom: 2018, yearTo: 2021 })).toEqual({ count: 4 });
  });

  it("puts a paper back in every collection it was in, past one batch of places", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const { userId, as } = await setup(t);
      const { id } = await as.mutation(api.library.mutations.saveToLibrary, paper(1));
      // More than one batch of places (PLACES_BATCH).
      const places = 300;
      for (let start = 0; start < places; start += 350) {
        await t.run(async (ctx) => {
          for (let i = start; i < Math.min(places, start + 350); i++) {
            const collectionId = await ctx.db.insert("collections", { userId, name: `c${i}`, sortName: `c${i}`, itemCount: 1, createdAt: 1, updatedAt: 1 });
            await ctx.db.insert("libraryItemCollections", { userId, collectionId, libraryItemId: id, assignedAt: i });
          }
        });
      }

      // Runs the batches each scheduled, short of the removal's end a day later.
      const nextBatches = async () => {
        for (let i = 0; i < 10; i++) {
          vi.advanceTimersByTime(1);
          await t.finishInProgressScheduledFunctions();
        }
      };
      const removed = await as.mutation(api.library.mutations.removeFromLibrary, { openalexId: paper(1).openalexId });
      await nextBatches();
      const { id: restored } = await as.mutation(api.library.mutations.restoreLibraryItem, removed.undo!.args);
      await nextBatches();

      const back = await t.run(async (ctx) => (await ctx.db.query("libraryItemCollections").withIndex("by_item", (q) => q.eq("libraryItemId", restored)).take(places + 1)).map((row) => row.assignedAt));
      expect(back.sort((a, b) => a - b)).toEqual(Array.from({ length: places }, (_, i) => i));
      expect(await t.run((ctx) => ctx.db.query("removedPlaces").take(1))).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the backfill gives memberships their paper's fields and counts every row, once however often it runs", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const { userId, as } = await setup(t);
      // As rows saved before: written without the triggers that keep them.
      const collectionId = await runUntriggered(t, async (ctx) => {
        await ctx.db.patch("users", userId, { libraryItemCount: 3 });
        const id = await ctx.db.insert("collections", { userId, name: "Old", sortName: "old", itemCount: 3, createdAt: 1, updatedAt: 1 });
        for (const [i, rating] of [5, 5, 2].entries()) {
          const libraryItemId = await ctx.db.insert("libraryItems", { userId, ...paper(i), rating, searchableText: `Paper ${i}`, savedAt: i, updatedAt: 1 });
          await ctx.db.insert("libraryItemCollections", { userId, collectionId: id, libraryItemId, assignedAt: 1 });
        }
        return id;
      });
      expect(await t.action(internal.migrations.libraryFacets.verify, {})).toBeGreaterThan(0);

      for (let runs = 0; runs < 2; runs++) {
        await t.mutation(internal.migrations.libraryFacets.run, {});
        await t.finishAllScheduledFunctions(vi.runAllTimers);
      }

      expect(await t.action(internal.migrations.libraryFacets.verify, {})).toBe(0);
      expect(await as.query(api.library.queries.countPapers, { minRating: 5 })).toEqual({ count: 2 });
      expect(await as.query(api.library.queries.countPapers, { collectionId, minRating: 5 })).toEqual({ count: 2 });
      expect((await as.query(api.library.queries.papers, { collectionId, sort: "rating", ascending: true })).papers.map((row) => row.rating)).toEqual([2, 5, 5]);
    } finally {
      vi.useRealTimers();
    }
  });
});
