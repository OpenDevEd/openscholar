// Library views at any size (#633): a collection's view reads its own memberships, which copy
// their paper's fields, and filtered counts come from kept counts, exact past any cap.
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { restoreLibraryItemAction } from "./mutations";
import { seedOrganizationFeatures } from "../organizationFeatures.test-support";

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

  it("one mutation may change many papers' fields, each in collections", async () => {
    const t = convexTest(schema);
    const { as } = await setup(t);
    const collectionId = (await as.mutation(api.library.collections.createCollection, { name: "Trials" })).id;
    const ids: Id<"libraryItems">[] = [];
    for (let i = 0; i < 3; i++) {
      const { id } = await as.mutation(api.library.mutations.saveToLibrary, paper(i));
      await as.mutation(api.library.collections.addToCollection, { collectionId, libraryItemId: id });
      ids.push(id);
    }
    await t.run(async (ctx) => {
      for (const id of ids) await ctx.db.patch("libraryItems", id, { publicationYear: 2001 });
    });
    const years = await t.run(async (ctx) => (await ctx.db.query("libraryItemCollections").withIndex("by_collection", (q) => q.eq("collectionId", collectionId)).take(10)).map((row) => row.publicationYear));
    expect(years).toEqual([2001, 2001, 2001]);
  });

  it("counts several filters past papers without the filtered value, and one match exactly", async () => {
    const t = convexTest(schema);
    const { userId, as } = await setup(t);
    // Many rated papers with no year, which sort before every year; one rated and dated.
    await t.run(async (ctx) => {
      for (let i = 0; i < 300; i++) await ctx.db.insert("libraryItems", { userId, ...paper(i), rating: 5, searchableText: "x", savedAt: i, updatedAt: 1 });
      await ctx.db.insert("libraryItems", { userId, ...paper(1_000), rating: 5, publicationYear: 2010, searchableText: "x", savedAt: 1_000, updatedAt: 1 });
    });
    await t.finishAllScheduledFunctions(() => {});
    expect(await as.query(api.library.queries.countPapers, { minRating: 4, yearTo: 2020 })).toEqual({ count: 1 });
    expect((await as.query(api.library.queries.papers, { minRating: 4, yearTo: 2020 })).papers).toHaveLength(1);
  });

  it("a collection page of large papers stops on their bytes, and carries on from there", async () => {
    const t = convexTest(schema);
    const { userId, as } = await setup(t);
    const collectionId = (await as.mutation(api.library.collections.createCollection, { name: "Long reads" })).id;
    // 60 papers of about 400 KB: a page of all of them would read 24 MB.
    for (let start = 0; start < 60; start += 10) {
      await t.run(async (ctx) => {
        const collection = (await ctx.db.get("collections", collectionId))!;
        for (let i = start; i < start + 10; i++) {
          const id = await ctx.db.insert("libraryItems", { userId, ...paper(i), abstract: "x".repeat(400_000), searchableText: "x", savedAt: i, updatedAt: 1 });
          await ctx.db.insert("libraryItemCollections", { userId, collectionId, libraryItemId: id, assignedAt: i });
          await ctx.db.patch("collections", collectionId, { itemCount: collection.itemCount + i - start + 1 });
        }
      });
    }
    const view = { sortBy: "savedAt" as const, sortOrder: "asc" as const, collectionId };
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const read: { page: Array<{ _id: string }>; isDone: boolean; continueCursor: string } = await as.query(api.library.queries.browseLibrary, { ...view, paginationOpts: { cursor, numItems: 100 } });
      for (const item of read.page) seen.add(item._id);
      cursor = read.isDone ? null : read.continueCursor;
      pages++;
    } while (cursor !== null && pages < 20);
    expect(seen.size).toBe(60);
    expect(pages).toBeGreaterThan(1);
  });

  it("a paper being put back in its collections can't be removed again until it's done, and asks first for a followed one still moving", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const { userId, as } = await setup(t);
      const { id } = await as.mutation(api.library.mutations.saveToLibrary, paper(1));
      const places = 300;
      const collections: Id<"collections">[] = [];
      for (let start = 0; start < places; start += 150) {
        await t.run(async (ctx) => {
          for (let i = start; i < start + 150; i++) {
            const collectionId = await ctx.db.insert("collections", { userId, name: `c${i}`, sortName: `c${i}`, itemCount: 1, createdAt: 1, updatedAt: 1 });
            await ctx.db.insert("libraryItemCollections", { userId, collectionId, libraryItemId: id, assignedAt: i });
            collections.push(collectionId);
          }
        });
      }
      // A library follows a collection whose place is in the second batch.
      await t.run(async (ctx) => {
        const organizationId = await seedOrganizationFeatures(ctx, ["reader"], { evidenceLibraries: true });
        const libraryId = await ctx.db.insert("evidenceLibraries", { organizationId: organizationId as never, name: "Library", slug: "library", state: "active", createdByClerkUserId: "reader", updatedByClerkUserId: "reader", createdAt: 1, updatedAt: 1 });
        const lastPlaced = (await ctx.db.query("libraryItemCollections").withIndex("by_item", (q) => q.eq("libraryItemId", id)).take(places)).at(-1)!;
        await ctx.db.insert("evidenceLibraryCollectionSources", { libraryId, collectionId: lastPlaced.collectionId, connectedByClerkUserId: "reader", connectedAt: 1 });
      });
      const nextBatches = async () => {
        for (let i = 0; i < 10; i++) {
          vi.advanceTimersByTime(1);
          await t.finishInProgressScheduledFunctions();
        }
      };

      const removed = await as.mutation(api.library.mutations.removeFromLibrary, { openalexId: paper(1).openalexId });
      // The followed place hasn't moved yet: putting the paper back would change the library, so the assistant asks.
      expect(await t.run((ctx) => restoreLibraryItemAction.asksFirst!(ctx, userId, removed.undo!.args))).toBe(true);
      const { id: restored } = await as.mutation(api.library.mutations.restoreLibraryItem, removed.undo!.args);
      await expect(as.mutation(api.library.mutations.removeFromLibrary, { openalexId: paper(1).openalexId })).rejects.toThrow(/still going back/);
      await nextBatches();

      const removedAgain = await as.mutation(api.library.mutations.removeFromLibrary, { openalexId: paper(1).openalexId });
      await nextBatches();
      const { id: back } = await as.mutation(api.library.mutations.restoreLibraryItem, removedAgain.undo!.args);
      await nextBatches();
      expect(back).not.toBe(restored);
      const placed = await t.run(async (ctx) => (await ctx.db.query("libraryItemCollections").withIndex("by_item", (q) => q.eq("libraryItemId", back)).take(places + 1)).length);
      expect(placed).toBe(places);
      expect(await t.run(async (ctx) => (await ctx.db.get("collections", collections[0]))!.itemCount)).toBe(1);
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
