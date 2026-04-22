import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import schema from "../schema";

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
      libraryItemCount: overrides.libraryItemCount,
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
    expect(result.page.every((item: { rating: number; title: string }) => item.rating >= 3)).toBe(true);
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
    expect(result.page.some((item: { rating: number; title: string }) => item.title.includes("Machine"))).toBe(
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

    expect(result.page.every((item: { rating: number; title: string }) => item.rating >= 4)).toBe(true);
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
      result.page.every((item: { rating: number; title: string }) => item.title.includes("User1"))
    ).toBe(true);
  });
});

describe("listLibrary", () => {
  it("sorts searched items using the requested sort order instead of search relevance", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "Gamma machine paper",
      searchableText: "machine gamma paper",
      citedByCount: 10,
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Alpha machine paper",
      searchableText: "machine alpha paper",
      citedByCount: 3,
      openalexId: "https://openalex.org/W2",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Beta machine paper",
      searchableText: "machine beta paper",
      citedByCount: 30,
      openalexId: "https://openalex.org/W3",
    });

    const result = await asUser.query(api.library.queries.listLibrary, {
      searchText: "machine",
      sortBy: "title",
      sortOrder: "asc",
    });

    expect(result.map((item) => item.title)).toEqual([
      "Alpha machine paper",
      "Beta machine paper",
      "Gamma machine paper",
    ]);
  });

  it("returns the full filtered set for export-style library views", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "Keep me",
      rating: 4,
      publicationYear: 2021,
      savedAt: 1200,
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Too old",
      rating: 4,
      publicationYear: 2010,
      savedAt: 1000,
      openalexId: "https://openalex.org/W2",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Too low rated",
      rating: 1,
      publicationYear: 2022,
      savedAt: 1400,
      openalexId: "https://openalex.org/W3",
    });

    const result = await asUser.query(api.library.queries.listLibrary, {
      sortBy: "savedAt",
      sortOrder: "desc",
      minRating: 3,
      maxRating: 4,
      savedAfter: 1100,
      yearFrom: 2020,
    });

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Keep me");
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

  it("returns the live item count when the stored counter is missing", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
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

  it("returns the repaired count after an explicit backfill runs", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
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

    await t.mutation(internal.library.mutations.backfillAllLibraryCounts, {});

    const count = await asUser.query(api.library.queries.getLibraryCount, {});

    expect(count).toBe(3);
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

    expect(count).toBe(2);
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

    expect(count).toBe(2);
  });

  it("returns the live item count when no filters are active and the stored counter is missing", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
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

    expect(count).toBe(2);
  });
});

describe("library counter", () => {
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

    const itemId1 = await asUser.mutation(api.library.mutations.saveToLibrary, {
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
      itemId: itemId1,
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});
    expect(count).toBe(1);
  });

  it("removeFromLibraryByOpenalexId decrements counter", async () => {
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

    await asUser.mutation(api.library.mutations.removeFromLibraryByOpenalexId, {
      openalexId: "https://openalex.org/W1",
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});
    expect(count).toBe(1);
  });

  it("removeFromLibraryByOpenalexId with non-existent item does not change counter", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await asUser.mutation(api.library.mutations.saveToLibrary, {
      openalexId: "https://openalex.org/W1",
      rating: 3,
      title: "Paper 1",
    });

    await asUser.mutation(api.library.mutations.removeFromLibraryByOpenalexId, {
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
    const itemId = await asUser.mutation(api.library.mutations.saveToLibrary, {
      openalexId: "https://openalex.org/W1",
      rating: 3,
      title: "Paper 1",
    });
    await asUser.mutation(api.library.mutations.removeFromLibrary, {
      itemId,
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});
    expect(count).toBe(0);

    // Try removing a non-existent item -- counter should stay at 0
    await asUser.mutation(api.library.mutations.removeFromLibraryByOpenalexId, {
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
    const itemA = await asUser.mutation(api.library.mutations.saveToLibrary, {
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
      itemId: itemA,
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
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
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
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const itemId = await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W-remove",
      title: "Remove me",
    });
    await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W-keep",
      title: "Keep me",
    });

    await asUser.mutation(api.library.mutations.removeFromLibrary, {
      itemId: itemId!._id,
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});
    expect(count).toBe(1);
  });

  it("removeFromLibraryByOpenalexId repairs a missing counter before decrementing", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W-remove",
      title: "Remove me",
    });
    await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W-keep",
      title: "Keep me",
    });

    await asUser.mutation(api.library.mutations.removeFromLibraryByOpenalexId, {
      openalexId: "https://openalex.org/W-remove",
    });

    const count = await asUser.query(api.library.queries.getLibraryCount, {});
    expect(count).toBe(1);
  });
});

describe("removeFromLibrary", () => {
  it("deletes item owned by authenticated user, returns null", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const item = await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W1",
    });

    const result = await asUser.mutation(
      api.library.mutations.removeFromLibrary,
      { itemId: item!._id }
    );

    expect(result).toBeNull();

    // Verify item is actually deleted
    const deleted = await t.run(async (ctx) => {
      return await ctx.db.get("libraryItems", item!._id);
    });
    expect(deleted).toBeNull();
  });

  it("throws NOT_FOUND for non-existent item ID", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    // Create and delete an item to get a valid-format but non-existent ID
    const item = await seedLibraryItem(t, (await seedUser(t, "clerk_temp", "temp@test.com"))!._id, {
      openalexId: "https://openalex.org/Wtemp",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("libraryItems", item!._id);
    });

    await expect(
      asUser.mutation(api.library.mutations.removeFromLibrary, {
        itemId: item!._id,
      })
    ).rejects.toThrow();
  });

  it("throws FORBIDDEN when trying to delete another user's item", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });

    const otherItem = await seedLibraryItem(t, user2!._id, {
      openalexId: "https://openalex.org/W1",
    });

    await expect(
      asUser1.mutation(api.library.mutations.removeFromLibrary, {
        itemId: otherItem!._id,
      })
    ).rejects.toThrow();
  });
});
