import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "../_generated/api";
import schema from "../schema";

// Helper: create a user directly in the mock DB, return user doc
async function seedUser(
  t: ReturnType<typeof convexTest>,
  clerkId: string,
  email: string
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
    });
    return await ctx.db.get(userId);
  });
}

// Helper: seed a library item for a given userId
async function seedLibraryItem(
  t: ReturnType<typeof convexTest>,
  userId: any,
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
    return await ctx.db.get(id);
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
    expect(result.page.every((item: any) => item.rating >= 3)).toBe(true);
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
    expect(result.page.some((item: any) => item.title.includes("Machine"))).toBe(
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

    expect(result.page.every((item: any) => item.rating >= 4)).toBe(true);
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
      result.page.every((item: any) => item.title.includes("User1"))
    ).toBe(true);
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

  it("returns correct count for user with multiple items", async () => {
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

    const count = await asUser.query(api.library.queries.getLibraryCount, {});

    expect(count).toBe(3);
  });

  it("does NOT count items belonging to other users", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_user1", "user1@test.com");
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
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
      return await ctx.db.get(item!._id);
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
      await ctx.db.delete(item!._id);
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
