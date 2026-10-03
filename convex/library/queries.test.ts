import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { readEveryLibraryPage } from "../../lib/library/export";

// Helper: create a user directly in the mock DB, return user doc
async function seedUser(
  t: ReturnType<typeof convexTest>,
  clerkId: string,
  email: string,
  overrides: Partial<{
    libraryItemCount: number;
  }> = {},
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId,
      email,
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLoginAt: Date.now(),
      libraryItemCount:
        "libraryItemCount" in overrides ? overrides.libraryItemCount : 0,
    });
    return await ctx.db.get("users", userId);
  });
}

// Helper: seed a library item for a given userId
async function seedLibraryItem(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  overrides: Partial<{
    openalexId: string;
    rating: number;
    title: string;
    authors: string;
    doi: string;
    abstract: string;
    publicationYear: number;
    journal: string;
    citedByCount: number;
    isOpenAccess: boolean;
    oaStatus: string;
    searchableText: string;
    savedAt: number;
    updatedAt: number;
  }> = {}
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const title = overrides.title ?? "Default Title";
    const authors = overrides.authors ?? "Author A";
    const abstract = overrides.abstract ?? "Default abstract text";
    const searchableText =
      overrides.searchableText ?? [title, abstract, authors].join(" ");

    const id = await ctx.db.insert("libraryItems", {
      userId,
      openalexId: overrides.openalexId ?? `https://openalex.org/W${now}`,
      rating: overrides.rating ?? 3,
      title,
      authors,
      doi: overrides.doi,
      abstract,
      publicationYear: overrides.publicationYear,
      journal: overrides.journal,
      citedByCount: overrides.citedByCount,
      isOpenAccess: overrides.isOpenAccess,
      oaStatus: overrides.oaStatus,
      searchableText,
      savedAt: overrides.savedAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
    });
    return await ctx.db.get("libraryItems", id);
  });
}

describe("browseLibrary", () => {
  it("returns paginated results for authenticated user sorted by savedAt desc (default)", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    // Seed items with different savedAt values
    await seedLibraryItem(t, user!._id, {
      title: "Paper A",
      savedAt: 1000,
      openalexId: "https://openalex.org/WA",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Paper C",
      savedAt: 3000,
      openalexId: "https://openalex.org/WC",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Paper B",
      savedAt: 2000,
      openalexId: "https://openalex.org/WB",
    });

    const result = await asUser.query(api.library.queries.browseLibrary, {
      sortBy: "savedAt",
      sortOrder: "desc",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(3);
    expect(result.page[0].title).toBe("Paper C");
    expect(result.page[1].title).toBe("Paper B");
    expect(result.page[2].title).toBe("Paper A");
    expect(result.isDone).toBe(true);
  });

  it('sorts by rating asc when sortBy="rating", sortOrder="asc"', async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "High rated",
      rating: 5,
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Low rated",
      rating: 1,
      openalexId: "https://openalex.org/W2",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Mid rated",
      rating: 3,
      openalexId: "https://openalex.org/W3",
    });

    const result = await asUser.query(api.library.queries.browseLibrary, {
      sortBy: "rating",
      sortOrder: "asc",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(3);
    expect(result.page[0].title).toBe("Low rated");
    expect(result.page[1].title).toBe("Mid rated");
    expect(result.page[2].title).toBe("High rated");
  });

  it('sorts by publicationYear desc when sortBy="publicationYear", sortOrder="desc"', async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "Old paper",
      publicationYear: 2010,
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      title: "New paper",
      publicationYear: 2024,
      openalexId: "https://openalex.org/W2",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Mid paper",
      publicationYear: 2018,
      openalexId: "https://openalex.org/W3",
    });

    const result = await asUser.query(api.library.queries.browseLibrary, {
      sortBy: "publicationYear",
      sortOrder: "desc",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(3);
    expect(result.page[0].title).toBe("New paper");
    expect(result.page[1].title).toBe("Mid paper");
    expect(result.page[2].title).toBe("Old paper");
  });

  it('sorts by citedByCount desc when sortBy="citedByCount", sortOrder="desc"', async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "Low cited",
      citedByCount: 4,
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      title: "High cited",
      citedByCount: 18,
      openalexId: "https://openalex.org/W2",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Mid cited",
      citedByCount: 9,
      openalexId: "https://openalex.org/W3",
    });

    const result = await asUser.query(api.library.queries.browseLibrary, {
      sortBy: "citedByCount",
      sortOrder: "desc",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(3);
    expect(result.page[0].title).toBe("High cited");
    expect(result.page[1].title).toBe("Mid cited");
    expect(result.page[2].title).toBe("Low cited");
  });

  it("filters to items with rating >= minRating when minRating is provided", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "1 star",
      rating: 1,
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      title: "3 star",
      rating: 3,
      openalexId: "https://openalex.org/W2",
    });
    await seedLibraryItem(t, user!._id, {
      title: "5 star",
      rating: 5,
      openalexId: "https://openalex.org/W3",
    });

    const result = await asUser.query(api.library.queries.browseLibrary, {
      sortBy: "savedAt",
      sortOrder: "desc",
      minRating: 3,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(2);
    expect(result.page.every((item: { rating?: number; title: string }) => item.rating! >= 3)).toBe(true);
  });

  it("applies maxRating and savedBefore together when they are provided", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "Older 2 star",
      rating: 2,
      savedAt: 1000,
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Older 5 star",
      rating: 5,
      savedAt: 1500,
      openalexId: "https://openalex.org/W2",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Recent 2 star",
      rating: 2,
      savedAt: 4000,
      openalexId: "https://openalex.org/W3",
    });

    const result = await asUser.query(api.library.queries.browseLibrary, {
      sortBy: "savedAt",
      sortOrder: "desc",
      maxRating: 2,
      savedBefore: 2000,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].title).toBe("Older 2 star");
  });

  it("returns empty page when user has no library items", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const result = await asUser.query(api.library.queries.browseLibrary, {
      sortBy: "savedAt",
      sortOrder: "desc",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(0);
    expect(result.isDone).toBe(true);
  });

  it("does NOT return items belonging to other users", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_user1", "user1@test.com");
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user1!._id, {
      title: "User1 paper",
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user2!._id, {
      title: "User2 paper",
      openalexId: "https://openalex.org/W2",
    });

    const result = await asUser1.query(api.library.queries.browseLibrary, {
      sortBy: "savedAt",
      sortOrder: "desc",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].title).toBe("User1 paper");
  });
});

describe("searchLibrary", () => {
  it("sorts searched items using the requested sort order across pages", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "Gamma machine paper",
      searchableText: "machine gamma paper",
      savedAt: 3000,
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Alpha machine paper",
      searchableText: "machine alpha paper",
      savedAt: 1000,
      openalexId: "https://openalex.org/W2",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Beta machine paper",
      searchableText: "machine beta paper",
      savedAt: 2000,
      openalexId: "https://openalex.org/W3",
    });

    const firstPage = await asUser.query(api.library.queries.searchLibrary, {
      searchText: "machine",
      sortBy: "title",
      sortOrder: "asc",
      paginationOpts: { numItems: 2, cursor: null },
    });

    expect(firstPage.page.map((item) => item.title)).toEqual([
      "Alpha machine paper",
      "Beta machine paper",
    ]);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await asUser.query(api.library.queries.searchLibrary, {
      searchText: "machine",
      sortBy: "title",
      sortOrder: "asc",
      paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
    });

    expect(secondPage.page.map((item) => item.title)).toEqual([
      "Gamma machine paper",
    ]);
    expect(secondPage.isDone).toBe(true);
  });

  it("returns results matching search text against searchableText field", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "Machine Learning for Climate",
      searchableText: "Machine Learning for Climate some abstract Author A",
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Quantum Computing Algorithms",
      searchableText: "Quantum Computing Algorithms quantum theory Author B",
      openalexId: "https://openalex.org/W2",
    });

    const result = await asUser.query(api.library.queries.searchLibrary, {
      searchText: "Machine Learning",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page.length).toBeGreaterThanOrEqual(1);
    expect(result.page.some((item: { rating?: number; title: string }) => item.title.includes("Machine"))).toBe(
      true
    );
  });

  it("filters by minRating when provided (rating >= N)", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "ML Paper Low",
      rating: 1,
      searchableText: "machine learning low rated paper",
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      title: "ML Paper High",
      rating: 5,
      searchableText: "machine learning high rated paper",
      openalexId: "https://openalex.org/W2",
    });

    const result = await asUser.query(api.library.queries.searchLibrary, {
      searchText: "machine learning",
      minRating: 4,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page.every((item: { rating?: number; title: string }) => item.rating! >= 4)).toBe(true);
  });

  it("returns empty page when search text matches nothing", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "Machine Learning Paper",
      searchableText: "Machine Learning Paper abstract Author A",
      openalexId: "https://openalex.org/W1",
    });

    const result = await asUser.query(api.library.queries.searchLibrary, {
      searchText: "xyznonexistentquerythatmatchesnothing",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(0);
  });

  it("does NOT return items belonging to other users", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_user1", "user1@test.com");
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user1!._id, {
      title: "User1 ML Paper",
      searchableText: "machine learning user1 paper",
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user2!._id, {
      title: "User2 ML Paper",
      searchableText: "machine learning user2 paper",
      openalexId: "https://openalex.org/W2",
    });

    const result = await asUser1.query(api.library.queries.searchLibrary, {
      searchText: "machine learning",
      paginationOpts: { numItems: 10, cursor: null },
    });

    // Should only contain user1's paper
    expect(
      result.page.every((item: { rating?: number; title: string }) => item.title.includes("User1"))
    ).toBe(true);
  });
});

describe("a filtered library view, read page by page", () => {
  it("keeps each page's place when a paper before it is removed", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });
    const items: Array<Awaited<ReturnType<typeof seedLibraryItem>>> = [];
    for (let i = 1; i <= 4; i++) items.push(await seedLibraryItem(t, user!._id, { title: `Paper ${i}`, rating: 4, savedAt: 1_000 - i, openalexId: `https://openalex.org/W${i}` }));
    const view = { sortBy: "savedAt" as const, sortOrder: "desc" as const, minRating: 3 };
    const read = (cursor: string | null, endCursor?: string) => asUser.query(api.library.queries.browseLibrary, { ...view, paginationOpts: { cursor, numItems: 2, ...(endCursor ? { endCursor } : {}) } });
    const first = await read(null);
    const second = await read(first.continueCursor);

    await t.run((ctx) => ctx.db.delete("libraryItems", items[0]!._id));
    // The page hook asks again for each page between the cursors it already has.
    const again = [...(await read(null, first.continueCursor)).page, ...(await read(first.continueCursor, second.continueCursor)).page];
    expect(again.map((item) => item.title)).toEqual(["Paper 2", "Paper 3", "Paper 4"]);
  });

  it("returns every match once, in the view's order, as an export reads it", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });
    const collectionId = await asUser.mutation(api.library.collections.createCollection, { name: "Picked" });
    for (let i = 0; i < 24; i++) {
      const item = await seedLibraryItem(t, user!._id, { title: `Paper ${i}`, rating: (i % 5) + 1, publicationYear: 2010 + (i % 12), savedAt: 1_000 + i, openalexId: `https://openalex.org/W${i}` });
      if (i % 3 !== 0) await asUser.mutation(api.library.collections.addToCollection, { collectionId, libraryItemId: item!._id });
    }
    const view = { sortBy: "savedAt" as const, sortOrder: "desc" as const, minRating: 2, maxRating: 4, yearFrom: 2012, collectionId };
    const exported = await readEveryLibraryPage((cursor) => asUser.query(api.library.queries.browseLibrary, { ...view, paginationOpts: { cursor, numItems: 2 } }));

    const expected = Array.from({ length: 24 }, (_, i) => i)
      .filter((i) => i % 3 !== 0 && (i % 5) + 1 >= 2 && (i % 5) + 1 <= 4 && 2010 + (i % 12) >= 2012)
      .reverse()
      .map((i) => `Paper ${i}`);
    expect(expected.length).toBeGreaterThan(4);
    expect(exported.map((item) => item.title)).toEqual(expected);
    expect(await asUser.query(api.library.queries.getLibraryFilteredCount, view)).toEqual({ count: expected.length, capped: false });
  });
});

describe("getLibraryCount", () => {
  it("returns 0 for user with no items", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});

    expect(count).toBe(0);
  });

  it("returns the stored counter for user with multiple items", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com", {
      libraryItemCount: 3,
    });
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W2",
    });
    await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W3",
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});

    expect(count).toBe(3);
  });

  it("returns the live item count when the stored counter is missing", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com", {
      libraryItemCount: undefined,
    });
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W2",
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});

    expect(count).toBe(2);
  });

  it("returns the repaired count after the counter migration runs", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com", {
      libraryItemCount: undefined,
    });
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W2",
    });
    await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W3",
    });

    await t.action(internal.migrations.backfillLibraryCounters.backfillUsers, {});

    const count = await asUser.query(api.library.queries.getLibraryCount, {});

    expect(count).toBe(3);
  });
  it("does NOT count items belonging to other users", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_user1", "user1@test.com", {
      libraryItemCount: 2,
    });
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com", {
      libraryItemCount: 1,
    });
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user1!._id, {
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user1!._id, {
      openalexId: "https://openalex.org/W2",
    });
    await seedLibraryItem(t, user2!._id, {
      openalexId: "https://openalex.org/W3",
    });

    const count = await asUser1.query(api.library.queries.getLibraryCount, {});

    expect(count).toBe(2);
  });

});

describe("getLibraryFilteredCount", () => {
  it("returns the collection item count when only collection filtering is active", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com", {
      libraryItemCount: 3,
    });
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collectionId = await asUser.mutation(
      api.library.collections.createCollection,
      { name: "Focus set" },
    );
    const otherCollectionId = await asUser.mutation(
      api.library.collections.createCollection,
      { name: "Other set" },
    );

    const item1 = await seedLibraryItem(t, user!._id, {
      title: "Paper 1",
      openalexId: "https://openalex.org/W1",
    });
    const item2 = await seedLibraryItem(t, user!._id, {
      title: "Paper 2",
      openalexId: "https://openalex.org/W2",
    });
    const item3 = await seedLibraryItem(t, user!._id, {
      title: "Paper 3",
      openalexId: "https://openalex.org/W3",
    });

    await asUser.mutation(api.library.collections.addToCollection, {
      collectionId,
      libraryItemId: item1!._id,
    });
    await asUser.mutation(api.library.collections.addToCollection, {
      collectionId,
      libraryItemId: item2!._id,
    });
    await asUser.mutation(api.library.collections.addToCollection, {
      collectionId: otherCollectionId,
      libraryItemId: item3!._id,
    });

    const count = await asUser.query(api.library.queries.getLibraryFilteredCount, {
      sortBy: "savedAt",
      sortOrder: "desc",
      collectionId,
    });

    expect(count).toEqual({ count: 2, capped: false });
  });

  it("returns the exact filtered count for search and numeric filters", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com", {
      libraryItemCount: 4,
    });
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "Keep Alpha",
      abstract: "machine learning methods",
      rating: 4,
      publicationYear: 2022,
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Keep Beta",
      abstract: "machine learning benchmark",
      rating: 5,
      publicationYear: 2021,
      openalexId: "https://openalex.org/W2",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Wrong year",
      abstract: "machine learning archive",
      rating: 5,
      publicationYear: 2018,
      openalexId: "https://openalex.org/W3",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Wrong topic",
      abstract: "biology only",
      rating: 5,
      publicationYear: 2022,
      openalexId: "https://openalex.org/W4",
    });

    const count = await asUser.query(api.library.queries.getLibraryFilteredCount, {
      sortBy: "savedAt",
      sortOrder: "desc",
      searchText: "machine",
      minRating: 4,
      yearFrom: 2020,
    });

    expect(count).toEqual({ count: 2, capped: false });
  });

  it("returns the live item count when no filters are active and the stored counter is missing", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com", {
      libraryItemCount: undefined,
    });
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "Paper 1",
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Paper 2",
      openalexId: "https://openalex.org/W2",
    });

    const count = await asUser.query(api.library.queries.getLibraryFilteredCount, {
      sortBy: "savedAt",
      sortOrder: "desc",
    });

    expect(count).toEqual({ count: 2, capped: false });
  });
});

describe("library counter", () => {
  it("ensureUser initializes libraryItemCount for fresh users", async () => {
    const t = convexTest(schema);
    // ensureUser → createCreditsForUser → recordTransactionCounters writes
    // the initial monthly free grant to the balance sharded counters, so the
    // counters must be registered on this handle.
    const asUser = t.withIdentity({
      subject: "clerk_user1",
      email: "user1@test.com",
      givenName: "Test",
      familyName: "User",
    });

    const userId = await asUser.mutation(api.users.mutations.ensureUser, {});
    const user = await t.run(async (ctx) => await ctx.db.get("users", userId));

    expect(user?.libraryItemCount).toBe(0);
  });

  it("saveToLibrary increments counter for new items", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await asUser.mutation(api.library.mutations.saveToLibrary, {
      openalexId: "https://openalex.org/W1",
      rating: 3,
      title: "Paper 1",
    });
    await asUser.mutation(api.library.mutations.saveToLibrary, {
      openalexId: "https://openalex.org/W2",
      rating: 4,
      title: "Paper 2",
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});
    expect(count).toBe(2);
  });

  it("saveToLibrary re-rate does not double-count", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await asUser.mutation(api.library.mutations.saveToLibrary, {
      openalexId: "https://openalex.org/W1",
      rating: 3,
      title: "Paper 1",
    });
    // Re-rate same paper
    await asUser.mutation(api.library.mutations.saveToLibrary, {
      openalexId: "https://openalex.org/W1",
      rating: 5,
      title: "Paper 1",
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});
    expect(count).toBe(1);
  });

  it("removeFromLibrary decrements counter", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await asUser.mutation(api.library.mutations.saveToLibrary, {
      openalexId: "https://openalex.org/W1",
      rating: 3,
      title: "Paper 1",
    });
    await asUser.mutation(api.library.mutations.saveToLibrary, {
      openalexId: "https://openalex.org/W2",
      rating: 4,
      title: "Paper 2",
    });

    await asUser.mutation(api.library.mutations.removeFromLibrary, {
      openalexId: "https://openalex.org/W1",
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});
    expect(count).toBe(1);
  });

  it("removeFromLibrary with non-existent item does not change counter", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await asUser.mutation(api.library.mutations.saveToLibrary, {
      openalexId: "https://openalex.org/W1",
      rating: 3,
      title: "Paper 1",
    });

    await asUser.mutation(api.library.mutations.removeFromLibrary, {
      openalexId: "https://openalex.org/W999",
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});
    expect(count).toBe(1);
  });

  it("counter does not go below zero", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    // Save and remove to get counter to 0
    await asUser.mutation(api.library.mutations.saveToLibrary, {
      openalexId: "https://openalex.org/W1",
      rating: 3,
      title: "Paper 1",
    });
    await asUser.mutation(api.library.mutations.removeFromLibrary, {
      openalexId: "https://openalex.org/W1",
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});
    expect(count).toBe(0);

    // Try removing a non-existent item -- counter should stay at 0
    await asUser.mutation(api.library.mutations.removeFromLibrary, {
      openalexId: "https://openalex.org/W999",
    });

    const countAfter = await asUser.query(api.library.queries.getLibraryCount, {});
    expect(countAfter).toBe(0);
  });

  it("save-remove-save sequence maintains correct count", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    // Save A
    await asUser.mutation(api.library.mutations.saveToLibrary, {
      openalexId: "https://openalex.org/WA",
      rating: 3,
      title: "Paper A",
    });
    // Save B
    await asUser.mutation(api.library.mutations.saveToLibrary, {
      openalexId: "https://openalex.org/WB",
      rating: 4,
      title: "Paper B",
    });
    // Remove A
    await asUser.mutation(api.library.mutations.removeFromLibrary, {
      openalexId: "https://openalex.org/WA",
    });
    // Save C
    await asUser.mutation(api.library.mutations.saveToLibrary, {
      openalexId: "https://openalex.org/WC",
      rating: 5,
      title: "Paper C",
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});
    expect(count).toBe(2);
  });

  it("saveToLibrary repairs a missing counter before incrementing", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com", {
      libraryItemCount: undefined,
    });
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W-existing",
      title: "Existing paper",
    });

    await asUser.mutation(api.library.mutations.saveToLibrary, {
      openalexId: "https://openalex.org/W-new",
      rating: 4,
      title: "New paper",
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});
    expect(count).toBe(2);
  });

  it("removeFromLibrary repairs a missing counter before decrementing", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com", {
      libraryItemCount: undefined,
    });
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W-remove",
      title: "Remove me",
    });
    await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W-keep",
      title: "Keep me",
    });

    await asUser.mutation(api.library.mutations.removeFromLibrary, {
      openalexId: "https://openalex.org/W-remove",
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});
    expect(count).toBe(1);
  });
});

describe("removeFromLibrary", () => {
  it("removes the person's paper and returns it so Undo can put it back", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const item = await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W1",
      rating: 4,
    });

    const removed = await asUser.mutation(api.library.mutations.removeFromLibrary, {
      openalexId: "https://openalex.org/W1",
    });

    expect(removed).toMatchObject({ openalexId: "https://openalex.org/W1", rating: 4, savedAt: item!.savedAt, collectionIds: [] });
    const deleted = await t.run(async (ctx) => await ctx.db.get("libraryItems", item!._id));
    expect(deleted).toBeNull();
  });

  it("leaves another person's copy of the paper alone", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });

    const otherItem = await seedLibraryItem(t, user2!._id, {
      openalexId: "https://openalex.org/W1",
    });

    const removed = await asUser1.mutation(api.library.mutations.removeFromLibrary, {
      openalexId: "https://openalex.org/W1",
    });

    expect(removed).toBeNull();
    const kept = await t.run(async (ctx) => await ctx.db.get("libraryItems", otherItem!._id));
    expect(kept).not.toBeNull();
  });
});

describe("saving without a rating", () => {
  const paper = { openalexId: "https://openalex.org/W1", title: "Paper 1" };

  it("saves an unrated paper and keeps a saved rating when saved again without one", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const itemId = await asUser.mutation(api.library.mutations.saveToLibrary, paper);
    expect((await t.run(async (ctx) => await ctx.db.get("libraryItems", itemId)))?.rating).toBeUndefined();

    await asUser.mutation(api.library.mutations.saveToLibrary, { ...paper, rating: 4 });
    await asUser.mutation(api.library.mutations.saveToLibrary, paper);

    expect((await t.run(async (ctx) => await ctx.db.get("libraryItems", itemId)))?.rating).toBe(4);
    expect(await asUser.query(api.library.queries.getLibraryCount, {})).toBe(1);
  });

  it("clears a rating without removing the paper", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const itemId = await asUser.mutation(api.library.mutations.saveToLibrary, { ...paper, rating: 2 });
    await asUser.mutation(api.library.mutations.clearLibraryRating, { openalexId: paper.openalexId });

    const item = await t.run(async (ctx) => await ctx.db.get("libraryItems", itemId));
    expect(item).not.toBeNull();
    expect(item?.rating).toBeUndefined();
    expect(await asUser.query(api.library.queries.getLibraryCount, {})).toBe(1);
  });

  it("leaves unrated papers out of a rating filter", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await asUser.mutation(api.library.mutations.saveToLibrary, paper);
    await asUser.mutation(api.library.mutations.saveToLibrary, { openalexId: "https://openalex.org/W2", title: "Paper 2", rating: 1 });

    for (const sortBy of ["savedAt", "rating"] as const) {
      const result = await asUser.query(api.library.queries.browseLibrary, {
        sortBy,
        sortOrder: "desc",
        maxRating: 3,
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(result.page.map((item) => item.title)).toEqual(["Paper 2"]);
    }
  });

  it("puts a removed paper back with its rating, saved date and collections", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collectionId = await asUser.mutation(api.library.collections.createCollection, { name: "Reading" });
    const itemId = await asUser.mutation(api.library.mutations.saveToLibrary, { ...paper, rating: 5 });
    await asUser.mutation(api.library.collections.addToCollection, { collectionId, libraryItemId: itemId });
    const savedAt = (await t.run(async (ctx) => await ctx.db.get("libraryItems", itemId)))!.savedAt;

    const removed = await asUser.mutation(api.library.mutations.removeFromLibrary, { openalexId: paper.openalexId });
    expect(await asUser.query(api.library.queries.getLibraryCount, {})).toBe(0);

    const restoredId = await asUser.mutation(api.library.mutations.restoreLibraryItem, { paper: removed! });

    const restored = await t.run(async (ctx) => await ctx.db.get("libraryItems", restoredId));
    expect(restored).toMatchObject({ openalexId: paper.openalexId, rating: 5, savedAt });
    const holding = await asUser.query(api.library.collections.listCollections, { paginationOpts: { cursor: null, numItems: 10 }, openalexId: paper.openalexId });
    expect(holding.page.filter((c) => c.containsItem).map((c) => c._id)).toEqual([collectionId]);
    const collection = await t.run(async (ctx) => await ctx.db.get("collections", collectionId));
    expect(collection?.itemCount).toBe(1);
    expect(await asUser.query(api.library.queries.getLibraryCount, {})).toBe(1);
  });

  it("keeps the research rating search cards show in step with the library", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });
    const researchRating = async () =>
      await t.run(async (ctx) =>
        (await ctx.db
          .query("paperRatings")
          .withIndex("by_user_and_paperId", (q) => q.eq("userId", user!._id).eq("data.paperId", paper.openalexId))
          .unique())?.data.rating ?? null,
      );

    await asUser.mutation(api.library.mutations.saveToLibrary, { ...paper, rating: 3 });
    expect(await researchRating()).toBe(3);

    await asUser.mutation(api.library.mutations.clearLibraryRating, { openalexId: paper.openalexId });
    expect(await researchRating()).toBeNull();

    await asUser.mutation(api.library.mutations.saveToLibrary, { ...paper, rating: 5 });
    const removed = await asUser.mutation(api.library.mutations.removeFromLibrary, { openalexId: paper.openalexId });
    expect(await researchRating()).toBeNull();

    await asUser.mutation(api.library.mutations.restoreLibraryItem, { paper: removed! });
    expect(await researchRating()).toBe(5);
  });

  it("adds an unsaved paper to a collection by saving it once, and takes it out without unsaving it", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collectionId = await asUser.mutation(api.library.collections.createCollection, { name: "Reading" });
    await asUser.mutation(api.library.mutations.setPaperInCollection, { paper, collectionId, inCollection: true });
    await asUser.mutation(api.library.mutations.setPaperInCollection, { paper, collectionId, inCollection: true });

    const saved = await asUser.query(api.library.queries.savedPaper, { openalexId: paper.openalexId });
    expect(saved?.inCollection).toBe(true);
    expect(await asUser.query(api.library.queries.getLibraryCount, {})).toBe(1);
    expect((await t.run(async (ctx) => await ctx.db.get("collections", collectionId)))?.itemCount).toBe(1);

    await asUser.mutation(api.library.mutations.setPaperInCollection, { paper, collectionId, inCollection: false });

    expect(await asUser.query(api.library.queries.savedPaper, { openalexId: paper.openalexId })).toEqual({
      libraryItemId: saved!.libraryItemId,
      inCollection: false,
    });
    expect((await t.run(async (ctx) => await ctx.db.get("collections", collectionId)))?.itemCount).toBe(0);
  });

  it("won't put a paper in another person's collection", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    await seedUser(t, "clerk_user2", "user2@test.com");
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });
    const asUser2 = t.withIdentity({ subject: "clerk_user2" });

    const collectionId = await asUser2.mutation(api.library.collections.createCollection, { name: "Theirs" });

    await expect(
      asUser1.mutation(api.library.mutations.setPaperInCollection, { paper, collectionId, inCollection: true }),
    ).rejects.toThrow();
    expect(await asUser1.query(api.library.queries.getLibraryCount, {})).toBe(0);
  });
});
