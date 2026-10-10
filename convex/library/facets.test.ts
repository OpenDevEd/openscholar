// Library views at any size (#633): a collection's view reads its own memberships, which copy
// their paper's fields, and filtered counts come from kept counts, exact past any cap.
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { restoreLibraryItemAction } from "./mutations";
import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
import { ownActor } from "../workspaces/actor.test-support";
import { personalWorkspaceOf } from "../workspaces/actor";
import { countInRange } from "./facets";
import { ensureWorkspace } from "../workspaces/create";
import { madeBy } from "../workspaces/actor.test-support";
import { organizationWorkspaceOf } from "../workspaces/personal";

type Test = ReturnType<typeof convexTest>;

async function setup(t: Test) {
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { clerkId: "reader", email: "reader@test.local", state: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("libraryCounts", { workspaceId: await personalWorkspaceOf(ctx, id), count: 0 });
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

  it("counts what each of Date saved's picks keeps, of the library and of a collection", async () => {
    const day = 24 * 60 * 60_000;
    const now = 1_800_000_000_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const t = convexTest(schema);
      const { as } = await setup(t);
      const collectionId = (await as.mutation(api.library.collections.createCollection, { name: "Trials" })).id;
      // Saved 2, 20, 200 and 730 days ago; the first and third also go in the collection.
      for (const [i, ago] of [2, 20, 200, 730].entries()) {
        vi.setSystemTime(now - ago * day);
        const { id } = await as.mutation(api.library.mutations.saveToLibrary, paper(i));
        if (i % 2 === 0) await as.mutation(api.library.collections.addToCollection, { collectionId, libraryItemId: id });
      }
      vi.setSystemTime(now);
      await t.finishAllScheduledFunctions(() => {});

      const since = { week: now - 7 * day, month: now - 30 * day, year: now - 365 * day };
      expect(await as.query(api.library.queries.getSavedSinceCounts, { since })).toEqual({ total: 4, kept: { week: 1, month: 2, year: 3 } });
      expect(await as.query(api.library.queries.getSavedSinceCounts, { collectionId, since })).toEqual({ total: 2, kept: { week: 1, month: 1, year: 2 } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts a paper back in every collection it was in, past one batch of places", { tags: ["size"] }, async () => {
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
            const collectionId = await ctx.db.insert("collections", { ...(await madeBy(ctx, userId)), name: `c${i}`, sortName: `c${i}`, itemCount: 1, createdAt: 1, updatedAt: 1 });
            await ctx.db.insert("libraryItemCollections", { collectionId, libraryItemId: id, assignedAt: i });
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
      // The removal's day ends while its places are still going back: it waits for them.
      await t.mutation(internal.library.mutations.forgetRemoval, removed.undo!.args);
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

  it("counts several filters past papers without the filtered value, and one match exactly", { tags: ["size"] }, async () => {
    const t = convexTest(schema);
    const { userId, as } = await setup(t);
    // Many rated papers with no year, which sort before every year; one rated and dated.
    await t.run(async (ctx) => {
      for (let i = 0; i < 300; i++) await ctx.db.insert("libraryItems", { ...(await madeBy(ctx, userId)), ...paper(i), rating: 5, searchableText: "x", savedAt: i, updatedAt: 1 });
      await ctx.db.insert("libraryItems", { ...(await madeBy(ctx, userId)), ...paper(1_000), rating: 5, publicationYear: 2010, searchableText: "x", savedAt: 1_000, updatedAt: 1 });
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
          const id = await ctx.db.insert("libraryItems", { ...(await madeBy(ctx, userId)), ...paper(i), abstract: "x".repeat(400_000), searchableText: "x", savedAt: i, updatedAt: 1 });
          await ctx.db.insert("libraryItemCollections", { collectionId, libraryItemId: id, assignedAt: i });
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

  it("a paper being put back in its collections can't be removed again until it's done, and asks first for a followed one still moving", { tags: ["size"] }, async () => {
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
            const collectionId = await ctx.db.insert("collections", { ...(await madeBy(ctx, userId)), name: `c${i}`, sortName: `c${i}`, itemCount: 1, createdAt: 1, updatedAt: 1 });
            await ctx.db.insert("libraryItemCollections", { collectionId, libraryItemId: id, assignedAt: i });
            collections.push(collectionId);
          }
        });
      }
      // A library follows a collection whose place is in the second batch.
      await t.run(async (ctx) => {
        const organizationId = await seedOrganizationFeatures(ctx, ["reader"], { evidenceLibraries: true });
        const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId: await organizationWorkspaceOf(ctx, organizationId), name: "Library", slug: "library", state: "active", createdByClerkUserId: "reader", updatedByClerkUserId: "reader", createdAt: 1, updatedAt: 1 });
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
      expect(await t.run(async (ctx) => restoreLibraryItemAction.asksFirst!(ctx, await ownActor(ctx, userId), removed.undo!.args))).toBe(true);
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

});

describe("the library in workspaces (#650)", () => {
  /** How many of the workspace's papers have each rating from 0 to 5, from the kept counts. */
  const ratingsIn = (t: Test, workspaceId: Id<"workspaces">) => t.run((ctx) => Promise.all([0, 1, 2, 3, 4, 5].map((rating) => countInRange(ctx, workspaceId, "rating", { lower: rating, upper: rating }))));

  it("keeps each new paper, collection, removal and count in the workspace it was made in, as its maker's, and counts papers there", async () => {
    const t = convexTest(schema);
    const userId = await t.run((ctx) => ctx.db.insert("users", { clerkId: "reader", email: "reader@test.local", state: "active", createdAt: 1, updatedAt: 1 }));
    const own = await t.run((ctx) => personalWorkspaceOf(ctx, userId));
    const as = t.withIdentity({ subject: "reader" });
    const { id: kept } = await as.mutation(api.library.mutations.saveToLibrary, paper(1, { rating: 4 }));
    await as.mutation(api.library.mutations.saveToLibrary, paper(2, { rating: 2 }));
    const { id: collectionId } = await as.mutation(api.library.collections.createCollection, { name: "Trials" });
    const removed = await as.mutation(api.library.mutations.removeFromLibrary, { openalexId: paper(2).openalexId });
    const { id: restored } = await as.mutation(api.library.mutations.restoreLibraryItem, removed.undo!.args);
    await t.finishAllScheduledFunctions(() => {});

    const mine = { workspaceId: own, createdBy: userId };
    const rows = await t.run(async (ctx) => ({
      papers: await Promise.all([kept, restored].map(async (id) => ctx.db.get("libraryItems", id))),
      collection: await ctx.db.get("collections", collectionId),
      removal: (await ctx.db.query("libraryRemovals").take(1))[0],
      libraryCount: (await ctx.db.query("libraryCounts").take(1))[0],
      collectionCount: (await ctx.db.query("collectionCounts").take(1))[0],
    }));
    expect(rows).toMatchObject({ papers: [mine, mine], collection: mine, removal: { workspaceId: own }, libraryCount: { workspaceId: own, count: 2 }, collectionCount: { workspaceId: own, count: 1 } });
    expect(await ratingsIn(t, own)).toEqual([0, 0, 1, 0, 1, 0]);
  });

  it("reads an organization's library for each member, apart from their own, and leaves what one made to them and its admins to take away", async () => {
    const t = convexTest(schema);
    const { lab, alice, bob, aliceId } = await t.run(async (ctx) => {
      const ids = await Promise.all(["alice", "bob"].map((clerkId) => ctx.db.insert("users", { clerkId, email: `${clerkId}@test.local`, state: "active", createdAt: 1, updatedAt: 1 })));
      const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Learning Lab", slug: "lab", clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
      for (const [clerkUserId, role] of [["alice", "org:member"], ["bob", "org:admin"]] as const) {
        await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `orgmem_${clerkUserId}`, clerkUserId, role, state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
      }
      return { lab: await ensureWorkspace(ctx, { kind: "organization", organizationId }), alice: "alice", bob: "bob", aliceId: ids[0] };
    });
    const [asAlice, asBob] = [alice, bob].map((subject) => t.withIdentity({ subject }));
    const inLab = { workspaceId: lab };
    const { id: alicePaper } = await asAlice.mutation(api.library.mutations.saveToLibrary, { ...inLab, ...paper(1, { rating: 5 }) });
    await asBob.mutation(api.library.mutations.saveToLibrary, { ...inLab, ...paper(2, { rating: 3 }) });
    const { id: bobCollection } = await asBob.mutation(api.library.collections.createCollection, { ...inLab, name: "Shared" });
    await asAlice.mutation(api.library.collections.addToCollection, { ...inLab, collectionId: bobCollection, libraryItemId: alicePaper });
    await asAlice.mutation(api.library.mutations.saveToLibrary, paper(9));
    await t.finishAllScheduledFunctions(() => {});

    // Every member reads the organization's library; each person's own is theirs alone.
    const titles = async (as: typeof asAlice, workspaceId?: Id<"workspaces">) => (await as.query(api.library.queries.papers, { ...(workspaceId ? { workspaceId } : {}), sort: "title", ascending: true })).papers.map((item) => item.title);
    expect(await titles(asBob, lab)).toEqual(["Paper 1", "Paper 2"]);
    expect(await titles(asAlice)).toEqual(["Paper 9"]);
    expect(await asBob.query(api.library.queries.getLibraryCount, inLab)).toBe(2);
    expect(await asBob.query(api.library.queries.countPapers, { ...inLab, minRating: 5 })).toEqual({ count: 1 });
    expect(await asAlice.query(api.library.collections.countCollections, inLab)).toBe(1);
    // A collection outside the workspace a call names isn't there, and no one reads a workspace they're not in.
    await expect(asAlice.mutation(api.library.collections.addToCollection, { collectionId: bobCollection, libraryItemId: alicePaper })).rejects.toThrow(/Not your collection/);
    const own = await t.run((ctx) => personalWorkspaceOf(ctx, aliceId));
    await expect(asBob.query(api.library.queries.getLibraryCount, { workspaceId: own })).rejects.toThrow(/Workspace not found/);

    // A member takes away only what they made; an admin takes away anyone's.
    await expect(asAlice.mutation(api.library.mutations.removeFromLibrary, { ...inLab, openalexId: paper(2).openalexId })).rejects.toThrow(/admin/);
    await expect(asAlice.mutation(api.library.collections.deleteCollection, { ...inLab, collectionId: bobCollection })).rejects.toThrow(/admin/);
    await asBob.mutation(api.library.mutations.removeFromLibrary, { ...inLab, openalexId: paper(1).openalexId });
    await t.finishAllScheduledFunctions(() => {});
    expect(await titles(asAlice, lab)).toEqual(["Paper 2"]);
  });

});
