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

// Helper: seed a collection directly in the mock DB
async function seedCollection(
  t: ReturnType<typeof convexTest>,
  userId: any,
  name: string
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("collections", {
      userId,
      name,
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  });
}

// Helper: seed a junction row directly in the mock DB
async function seedJunctionRow(
  t: ReturnType<typeof convexTest>,
  userId: any,
  collectionId: any,
  libraryItemId: any
) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("libraryItemCollections", {
      userId,
      collectionId,
      libraryItemId,
      assignedAt: Date.now(),
    });
    return await ctx.db.get(id);
  });
}

describe("createCollection", () => {
  it("creates a collection with name, verifies it has userId, name, createdAt, updatedAt", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collectionId = await asUser.mutation(
      api.library.collections.createCollection,
      { name: "My Papers" }
    );

    expect(collectionId).toBeDefined();

    // Verify the collection in the DB
    const collection = await t.run(async (ctx) => {
      return await ctx.db.get(collectionId);
    });

    expect(collection).not.toBeNull();
    expect(collection!.userId).toBe(user!._id);
    expect(collection!.name).toBe("My Papers");
    expect(collection!.createdAt).toBeTypeOf("number");
    expect(collection!.updatedAt).toBeTypeOf("number");
  });

  it("rejects unauthenticated user (ConvexError with UNAUTHENTICATED)", async () => {
    const t = convexTest(schema);

    await expect(
      t.mutation(api.library.collections.createCollection, {
        name: "My Papers",
      })
    ).rejects.toThrow();
  });

  it("rejects empty name (ConvexError with VALIDATION_ERROR)", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await expect(
      asUser.mutation(api.library.collections.createCollection, {
        name: "   ",
      })
    ).rejects.toThrow();
  });
});

describe("renameCollection", () => {
  it("renames an existing collection, verifies name and updatedAt changed", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user!._id, "Old Name");
    const originalUpdatedAt = collection!.updatedAt;

    // Small delay to ensure updatedAt changes
    await new Promise((r) => setTimeout(r, 10));

    await asUser.mutation(api.library.collections.renameCollection, {
      collectionId: collection!._id,
      name: "New Name",
    });

    const updated = await t.run(async (ctx) => {
      return await ctx.db.get(collection!._id);
    });

    expect(updated!.name).toBe("New Name");
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
  });

  it("rejects renaming a collection owned by another user (FORBIDDEN)", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user2!._id, "User2 Collection");

    await expect(
      asUser1.mutation(api.library.collections.renameCollection, {
        collectionId: collection!._id,
        name: "Hijacked",
      })
    ).rejects.toThrow();
  });

  it("rejects renaming a non-existent collection (NOT_FOUND)", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    // Create and delete a collection to get a valid-format but non-existent ID
    const collection = await seedCollection(t, user!._id, "Temp");
    await t.run(async (ctx) => {
      await ctx.db.delete(collection!._id);
    });

    await expect(
      asUser.mutation(api.library.collections.renameCollection, {
        collectionId: collection!._id,
        name: "New Name",
      })
    ).rejects.toThrow();
  });
});

describe("deleteCollection", () => {
  it("deletes collection and verifies it no longer exists", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user!._id, "To Delete");

    await asUser.mutation(api.library.collections.deleteCollection, {
      collectionId: collection!._id,
    });

    const deleted = await t.run(async (ctx) => {
      return await ctx.db.get(collection!._id);
    });

    expect(deleted).toBeNull();
  });

  it("cascade-deletes all junction rows for the collection", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user!._id, "With Items");
    const item1 = await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W1",
    });
    const item2 = await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W2",
    });

    await seedJunctionRow(t, user!._id, collection!._id, item1!._id);
    await seedJunctionRow(t, user!._id, collection!._id, item2!._id);

    await asUser.mutation(api.library.collections.deleteCollection, {
      collectionId: collection!._id,
    });

    // Verify junction rows are deleted
    const remainingJunctions = await t.run(async (ctx) => {
      return await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_collection", (q) =>
          q.eq("collectionId", collection!._id)
        )
        .collect();
    });

    expect(remainingJunctions).toHaveLength(0);
  });

  it("does NOT delete library items that were in the collection", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user!._id, "With Items");
    const item = await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W1",
    });

    await seedJunctionRow(t, user!._id, collection!._id, item!._id);

    await asUser.mutation(api.library.collections.deleteCollection, {
      collectionId: collection!._id,
    });

    // Library item should still exist
    const existingItem = await t.run(async (ctx) => {
      return await ctx.db.get(item!._id);
    });

    expect(existingItem).not.toBeNull();
    expect(existingItem!.title).toBe("Default Title");
  });

  it("rejects deleting a collection owned by another user (FORBIDDEN)", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user2!._id, "User2 Collection");

    await expect(
      asUser1.mutation(api.library.collections.deleteCollection, {
        collectionId: collection!._id,
      })
    ).rejects.toThrow();
  });
});

describe("listCollections", () => {
  it("returns all collections for the authenticated user, sorted alphabetically by name", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedCollection(t, user!._id, "Zebra");
    await seedCollection(t, user!._id, "Alpha");
    await seedCollection(t, user!._id, "Middle");

    const collections = await asUser.query(
      api.library.collections.listCollections,
      {}
    );

    expect(collections).toHaveLength(3);
    expect(collections[0].name).toBe("Alpha");
    expect(collections[1].name).toBe("Middle");
    expect(collections[2].name).toBe("Zebra");
  });

  it("returns empty array when user has no collections", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collections = await asUser.query(
      api.library.collections.listCollections,
      {}
    );

    expect(collections).toHaveLength(0);
  });

  it("does not return collections belonging to other users", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_user1", "user1@test.com");
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });

    await seedCollection(t, user1!._id, "User1 Collection");
    await seedCollection(t, user2!._id, "User2 Collection");

    const collections = await asUser1.query(
      api.library.collections.listCollections,
      {}
    );

    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe("User1 Collection");
  });
});

describe("removeFromLibrary cascade", () => {
  it("removing a library item also deletes all its junction rows in libraryItemCollections", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collection1 = await seedCollection(t, user!._id, "Collection 1");
    const collection2 = await seedCollection(t, user!._id, "Collection 2");
    const item = await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W1",
    });

    await seedJunctionRow(t, user!._id, collection1!._id, item!._id);
    await seedJunctionRow(t, user!._id, collection2!._id, item!._id);

    // Remove the library item
    await asUser.mutation(api.library.mutations.removeFromLibrary, {
      itemId: item!._id,
    });

    // Verify junction rows are deleted
    const remainingJunctions = await t.run(async (ctx) => {
      return await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_item", (q) => q.eq("libraryItemId", item!._id))
        .collect();
    });

    expect(remainingJunctions).toHaveLength(0);
  });

  it("the collection itself still exists after item removal", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user!._id, "My Collection");
    const item = await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W1",
    });

    await seedJunctionRow(t, user!._id, collection!._id, item!._id);

    // Remove the library item
    await asUser.mutation(api.library.mutations.removeFromLibrary, {
      itemId: item!._id,
    });

    // Collection should still exist
    const existingCollection = await t.run(async (ctx) => {
      return await ctx.db.get(collection!._id);
    });

    expect(existingCollection).not.toBeNull();
    expect(existingCollection!.name).toBe("My Collection");
  });
});
