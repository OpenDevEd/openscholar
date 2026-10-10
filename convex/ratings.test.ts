// A saved paper's rating as its people's average of their own, and a collection's as its people's there (#655).
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { ensureWorkspace } from "./workspaces/create";

// An organization's averages move in transactions of their own, which these tests let finish.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Alice and Bob, members of a lab. */
async function lab() {
  const t = convexTest(schema);
  const seeded = await t.run(async (ctx) => {
    for (const clerkId of ["alice", "bob"]) await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, state: "active", createdAt: 1, updatedAt: 1 });
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Learning Lab", slug: "org_lab", evidenceLibrariesEnabled: false, authorsEnabled: false, extractionEnabled: false, clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    const member = (clerkUserId: string) => ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: `orgmem_${clerkUserId}`, clerkUserId, role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    await member("alice");
    return { bobMembership: await member("bob"), workspaceId: await ensureWorkspace(ctx, { kind: "organization", organizationId }) };
  });
  const [alice, bob] = ["alice", "bob"].map((subject) => t.withIdentity({ subject }));
  const settled = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  /** Bob leaves or comes back, and what it moves is re-rated. */
  const bobIs = async (state: "active" | "revoked") => {
    await t.run((ctx) => ctx.db.patch("organizationMemberships", seeded.bobMembership, { state }));
    await settled();
  };
  return { t, alice, bob, settled, bobIs, workspaceId: seeded.workspaceId };
}

it("rates an organization's paper with its members' average, and shows each member their own", async () => {
  const { alice, bob, settled, bobIs, workspaceId } = await lab();
  const shown = async (as: typeof alice) => {
    const { page } = await as.query(api.library.queries.browseLibrary, { workspaceId, sortBy: "rating", sortOrder: "desc", paginationOpts: { cursor: null, numItems: 10 } });
    return page.map(({ openalexId, rating, myRating }) => [openalexId, rating, myRating]);
  };

  // Alice saves two papers to the lab, rated. Bob rates one of them on a search card, which counts in the lab too.
  await alice.mutation(api.library.mutations.saveToLibrary, { workspaceId, openalexId: "https://openalex.org/W1", title: "One", rating: 4 });
  await alice.mutation(api.library.mutations.saveToLibrary, { workspaceId, openalexId: "https://openalex.org/W2", title: "Two", rating: 3 });
  await bob.mutation(api.research.records.change, { accountId: "bob", requestId: "rated", command: { kind: "rating", paperId: "https://openalex.org/W1", rating: 1 } });
  await settled();
  // The lab sorts by the average; each sees their own stars.
  expect(await shown(alice)).toEqual([["https://openalex.org/W2", 3, 3], ["https://openalex.org/W1", 2.5, 4]]);
  expect(await shown(bob)).toEqual([["https://openalex.org/W2", 3, undefined], ["https://openalex.org/W1", 2.5, 1]]);

  // Someone who leaves takes their ratings out of the lab's averages, and brings them back on rejoining.
  await bobIs("revoked");
  expect(await shown(alice)).toEqual([["https://openalex.org/W1", 4, 4], ["https://openalex.org/W2", 3, 3]]);
  await bobIs("active");
  expect(await shown(alice)).toEqual([["https://openalex.org/W2", 3, 3], ["https://openalex.org/W1", 2.5, 4]]);
});

it("rates a paper within an organization's collection apart from each member's own rating, and sorts the collection by their average there", async () => {
  const { t, alice, bob, bobIs, workspaceId } = await lab();
  const { id: one } = await alice.mutation(api.library.mutations.saveToLibrary, { workspaceId, openalexId: "https://openalex.org/W1", title: "One", rating: 5 });
  const { id: two } = await alice.mutation(api.library.mutations.saveToLibrary, { workspaceId, openalexId: "https://openalex.org/W2", title: "Two" });
  const { id: collectionId } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Reading" });
  for (const libraryItemId of [one, two]) await alice.mutation(api.library.collections.addToCollection, { workspaceId, collectionId, libraryItemId });
  const sorted = async () => {
    const { page } = await alice.query(api.library.queries.browseLibrary, { workspaceId, collectionId, sortBy: "rating", sortOrder: "desc", paginationOpts: { cursor: null, numItems: 10 } });
    const places = await t.run(async (ctx) => ctx.db.query("libraryItemCollections").collect());
    return page.map((item) => [item.title, places.find((place) => place.libraryItemId === item._id)?.rating ?? null]);
  };
  const rate = (as: typeof alice, libraryItemId: typeof one, rating: number | null) => as.mutation(api.library.collections.setCollectionRating, { workspaceId, collectionId, libraryItemId, rating });

  // Alice's own 5 isn't the collection's: nobody has rated it there yet.
  expect(await sorted()).toEqual([["Two", null], ["One", null]]);
  const { undo } = await rate(alice, one, 4);
  await rate(bob, one, 2);
  await rate(bob, two, 5);
  expect(await sorted()).toEqual([["Two", 5], ["One", 3]]);
  // A search in the collection, its count, and what the assistant reads of it go by the collection's ratings too.
  const searched = await alice.query(api.library.queries.searchLibrary, { workspaceId, collectionId, searchText: "One Two", minRating: 4, paginationOpts: { cursor: null, numItems: 10 } });
  expect(searched.page.map((item) => [item.title, item.rating])).toEqual([["Two", 5]]);
  expect(await alice.query(api.library.queries.getLibraryFilteredCount, { workspaceId, collectionId, searchText: "One Two", minRating: 4, sortBy: "savedAt", sortOrder: "desc" })).toEqual({ count: 1, capped: false });
  expect((await alice.query(api.library.queries.papers, { workspaceId, collectionId, sort: "rating" })).papers.map((paper) => [paper.title, paper.rating])).toEqual([["Two", 5], ["One", 3]]);
  // Her own rating stays as it was.
  expect((await alice.query(api.library.queries.browseLibrary, { workspaceId, sortBy: "rating", sortOrder: "desc", paginationOpts: { cursor: null, numItems: 10 } })).page.find((item) => item._id === one)?.myRating).toBe(5);

  // The undo takes back hers, and once she has rated again it's refused.
  await alice.mutation(api.library.collections.setCollectionRating, { workspaceId, ...undo!.args });
  expect(await sorted()).toEqual([["Two", 5], ["One", 2]]);
  await rate(alice, one, 1);
  await expect(alice.mutation(api.library.collections.setCollectionRating, { workspaceId, ...undo!.args })).rejects.toThrow(/changed since/);

  // Bob leaving takes his out of the collection's averages.
  await bobIs("revoked");
  expect(await sorted()).toEqual([["One", 1], ["Two", null]]);

  // A collection in someone's own workspace has no ratings of its own.
  const { id: own } = await alice.mutation(api.library.collections.createCollection, { name: "Mine" });
  const { id: mine } = await alice.mutation(api.library.mutations.saveToLibrary, { openalexId: "https://openalex.org/W3", title: "Three", collectionId: own });
  await expect(alice.mutation(api.library.collections.setCollectionRating, { collectionId: own, libraryItemId: mine, rating: 3 })).rejects.toMatchObject({ data: { code: "VALIDATION_ERROR" } });

  // Deleting the collection deletes its ratings.
  await alice.mutation(api.library.collections.deleteCollection, { workspaceId, collectionId });
  expect(await t.run(async (ctx) => (await ctx.db.query("ratings").collect()).filter((row) => row.collectionId !== undefined))).toEqual([]);
});

it("shows each paper in an organization's collection with its members' ratings there, the person's own first", async () => {
  const { alice, bob, bobIs, workspaceId } = await lab();
  const { id: one } = await alice.mutation(api.library.mutations.saveToLibrary, { workspaceId, openalexId: "https://openalex.org/W1", title: "One" });
  const { id: collectionId } = await alice.mutation(api.library.collections.createCollection, { workspaceId, name: "Reading" });
  await alice.mutation(api.library.collections.addToCollection, { workspaceId, collectionId, libraryItemId: one });
  await bob.mutation(api.library.collections.setCollectionRating, { workspaceId, collectionId, libraryItemId: one, rating: 2 });
  await alice.mutation(api.library.collections.setCollectionRating, { workspaceId, collectionId, libraryItemId: one, rating: 4 });
  const shown = async () => (await alice.query(api.library.queries.browseLibrary, { workspaceId, collectionId, sortBy: "savedAt", sortOrder: "desc", paginationOpts: { cursor: null, numItems: 10 } })).page[0]!;
  const card = await shown();
  expect(card.rating).toBe(3);
  expect(card.collection).toMatchObject({ mine: 4, count: 2, raters: [{ you: true, rating: 4 }, { you: false, rating: 2 }] });
  const listed = await alice.query(api.library.collections.raters, { workspaceId, collectionId, libraryItemId: one, paginationOpts: { cursor: null, numItems: 10 } });
  expect(listed.page.map((rater) => [rater.you, rater.rating]).sort()).toEqual([[false, 2], [true, 4]]);
  // Someone who left isn't one of them.
  await bobIs("revoked");
  expect((await shown()).collection).toMatchObject({ count: 1, raters: [{ rating: 4 }] });
  // Outside a collection, nothing.
  expect((await alice.query(api.library.queries.browseLibrary, { workspaceId, sortBy: "savedAt", sortOrder: "desc", paginationOpts: { cursor: null, numItems: 10 } })).page[0]!.collection).toBeUndefined();
});
