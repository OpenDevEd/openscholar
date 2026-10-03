import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "../_generated/api";
import schema from "../schema";
import { MAX_COLLECTIONS_PER_USER } from "../lib/queryBounds";
import { collectionSortName } from "./collections";
import type { Doc, Id } from "../_generated/dataModel";

// Helper: create a user directly in the mock DB, return user doc
async function seedUser(
  t: ReturnType<typeof convexTest>,
  clerkId: string,
  email: string
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId,
      email,
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLoginAt: Date.now(),
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

// Helper: seed a collection directly in the mock DB
async function seedCollection(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  name: string
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("collections", {
      userId,
      itemCount: 0,
      name,
      sortName: collectionSortName(name),
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.get("collections", id);
  });
}

// Helper: seed a junction row directly in the mock DB
async function seedJunctionRow(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  collectionId: Id<"collections">,
  libraryItemId: Id<"libraryItems">
) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("libraryItemCollections", {
      userId,
      collectionId,
      libraryItemId,
      assignedAt: Date.now(),
    });
    // Increment denormalized counter
    const collection = await ctx.db.get("collections", collectionId);
    if (collection) {
      await ctx.db.patch("collections", collectionId, {
        itemCount: collection.itemCount + 1,
      });
    }
    return await ctx.db.get("libraryItemCollections", id);
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
      return await ctx.db.get("collections", collectionId);
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

  it("refuses a collection past the per-user cap, so a user's collection lists stay small", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_COLLECTIONS_PER_USER; i++) await ctx.db.insert("collections", { userId: user!._id, name: `c${i}`, itemCount: 0, createdAt: 1, updatedAt: 1 });
    });
    await expect(asUser.mutation(api.library.collections.createCollection, { name: "One more" })).rejects.toThrow(/VALIDATION_ERROR/);
    expect(await t.run(async (ctx) => (await ctx.db.query("collections").take(MAX_COLLECTIONS_PER_USER + 1)).length)).toBe(MAX_COLLECTIONS_PER_USER);
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
      return await ctx.db.get("collections", collection!._id) as Doc<"collections"> | null;
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
      await ctx.db.delete("collections", collection!._id);
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
      return await ctx.db.get("collections", collection!._id);
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
      return await ctx.db.get("libraryItems", item!._id) as Doc<"libraryItems"> | null;
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

const firstPage = (numItems: number) => ({ paginationOpts: { cursor: null, numItems } });

describe("listCollections", () => {
  it("pages the person's collections by name, ignoring case and accents", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });
    for (const name of ["zebra", "Alpha", "Éclair", "middle"]) await asUser.mutation(api.library.collections.createCollection, { name });

    const first = await asUser.query(api.library.collections.listCollections, firstPage(2));
    expect(first.page.map((c) => c.name)).toEqual(["Alpha", "Éclair"]);
    expect(first.isDone).toBe(false);
    const second = await asUser.query(api.library.collections.listCollections, { paginationOpts: { cursor: first.continueCursor, numItems: 2 } });
    expect(second.page.map((c) => c.name)).toEqual(["middle", "zebra"]);
  });

  it("keeps a renamed collection in name order", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });
    const first = await asUser.mutation(api.library.collections.createCollection, { name: "Alpha" });
    await asUser.mutation(api.library.collections.createCollection, { name: "Beta" });
    await asUser.mutation(api.library.collections.renameCollection, { collectionId: first, name: "gamma" });

    const page = await asUser.query(api.library.collections.listCollections, firstPage(10));
    expect(page.page.map((c) => c.name)).toEqual(["Beta", "gamma"]);
  });

  it("does not return collections belonging to other users", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_user1", "user1@test.com");
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });

    await seedCollection(t, user1!._id, "Shared Name");
    await seedCollection(t, user2!._id, "Shared Name");

    const listed = await asUser1.query(api.library.collections.listCollections, firstPage(10));
    expect(listed.page).toHaveLength(1);
    const searched = await asUser1.query(api.library.collections.listCollections, { ...firstPage(10), search: "shared" });
    expect(searched.page).toHaveLength(1);
  });

  it("searches the person's collections by name on the server", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });
    await seedCollection(t, user!._id, "Climate adaptation");
    await seedCollection(t, user!._id, "Tutoring");

    const page = await asUser.query(api.library.collections.listCollections, { ...firstPage(10), search: "clim" });
    expect(page.page.map((c) => c.name)).toEqual(["Climate adaptation"]);
  });

  it("says which collections hold a paper of the person's, and none for a paper they haven't saved", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_user1", "user1@test.com");
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });
    const holding = await seedCollection(t, user1!._id, "Holding");
    await seedCollection(t, user1!._id, "Other");
    const mine = await seedLibraryItem(t, user1!._id, { openalexId: "https://openalex.org/W1" });
    const theirs = await seedLibraryItem(t, user2!._id, { openalexId: "https://openalex.org/W2" });
    await seedJunctionRow(t, user1!._id, holding!._id, mine!._id);

    const flags = async (openalexId: string) =>
      (await asUser1.query(api.library.collections.listCollections, { ...firstPage(10), openalexId })).page.map((c) => [c.name, c.containsItem]);
    expect(await flags(mine!.openalexId)).toEqual([["Holding", true], ["Other", false]]);
    // Someone else's saved paper, and a paper nobody saved.
    expect(await flags(theirs!.openalexId)).toEqual([["Holding", false], ["Other", false]]);
    expect(await flags("https://openalex.org/W404")).toEqual([["Holding", false], ["Other", false]]);
  });

  it("shows each collection's item count", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });
    const collection = await seedCollection(t, user!._id, "Research");
    const item = await seedLibraryItem(t, user!._id, { openalexId: "https://openalex.org/W1" });
    await asUser.mutation(api.library.collections.addToCollection, { collectionId: collection!._id, libraryItemId: item!._id });

    const page = await asUser.query(api.library.collections.listCollections, firstPage(10));
    expect(page.page).toMatchObject([{ name: "Research", itemCount: 1 }]);
  });
});

describe("countCollections and getCollection", () => {
  it("count and read only the person's own collections", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_user1", "user1@test.com");
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });
    const mine = await asUser1.mutation(api.library.collections.createCollection, { name: "Mine" });
    const theirs = await seedCollection(t, user2!._id, "Theirs");

    expect(await asUser1.query(api.library.collections.countCollections, {})).toBe(1);
    expect(await asUser1.query(api.library.collections.getCollection, { collectionId: mine })).toMatchObject({ name: "Mine", itemCount: 0 });
    expect(await asUser1.query(api.library.collections.getCollection, { collectionId: theirs!._id })).toBeNull();
  });

  it("keeps the count as collections are made and deleted, starting exact for someone counted before", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });
    // Saved before counts existed: no count row.
    await seedCollection(t, user!._id, "Old one");
    await seedCollection(t, user!._id, "Old two");
    const made = await asUser.mutation(api.library.collections.createCollection, { name: "New" });
    expect(await asUser.query(api.library.collections.countCollections, {})).toBe(3);
    await asUser.mutation(api.library.collections.deleteCollection, { collectionId: made });
    expect(await asUser.query(api.library.collections.countCollections, {})).toBe(2);
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
      openalexId: "https://openalex.org/W1",
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
      openalexId: "https://openalex.org/W1",
    });

    // Collection should still exist
    const existingCollection = await t.run(async (ctx) => {
      return await ctx.db.get("collections", collection!._id) as Doc<"collections"> | null;
    });

    expect(existingCollection).not.toBeNull();
    expect(existingCollection!.name).toBe("My Collection");
  });
});

// ═══════════════════════════════════════════════════════════════
// Plan 02 Tests: Assignment mutations, count/membership queries,
// and collection-filtered browse/search
// ═══════════════════════════════════════════════════════════════

describe("addToCollection", () => {
  it("assigns a library item to a collection with correct junction row fields", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user!._id, "Favorites");
    const item = await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W1",
      title: "Paper A",
    });

    await asUser.mutation(api.library.collections.addToCollection, {
      collectionId: collection!._id,
      libraryItemId: item!._id,
    });

    const junctionRows = await t.run(async (ctx) => {
      return await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_collection_item", (q) =>
          q.eq("collectionId", collection!._id).eq("libraryItemId", item!._id)
        )
        .collect();
    });

    expect(junctionRows).toHaveLength(1);
    expect(junctionRows[0].userId).toBe(user!._id);
    expect(junctionRows[0].collectionId).toBe(collection!._id);
    expect(junctionRows[0].libraryItemId).toBe(item!._id);
    expect(junctionRows[0].assignedAt).toBeGreaterThan(0);
  });

  it("is idempotent - assigning same item twice creates no duplicate", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user!._id, "Reading List");
    const item = await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W1",
    });

    await asUser.mutation(api.library.collections.addToCollection, {
      collectionId: collection!._id,
      libraryItemId: item!._id,
    });
    await asUser.mutation(api.library.collections.addToCollection, {
      collectionId: collection!._id,
      libraryItemId: item!._id,
    });

    const junctionRows = await t.run(async (ctx) => {
      return await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_collection", (q) =>
          q.eq("collectionId", collection!._id)
        )
        .collect();
    });

    expect(junctionRows).toHaveLength(1);
  });

  it("rejects if collection belongs to another user (FORBIDDEN)", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_user1", "user1@test.com");
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });

    const otherCollection = await seedCollection(t, user2!._id, "Other");
    const item = await seedLibraryItem(t, user1!._id, {
      openalexId: "https://openalex.org/W1",
    });

    await expect(
      asUser1.mutation(api.library.collections.addToCollection, {
        collectionId: otherCollection!._id,
        libraryItemId: item!._id,
      })
    ).rejects.toThrow();
  });

  it("rejects if library item belongs to another user (FORBIDDEN)", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_user1", "user1@test.com");
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user1!._id, "My Collection");
    const otherItem = await seedLibraryItem(t, user2!._id, {
      openalexId: "https://openalex.org/W1",
    });

    await expect(
      asUser1.mutation(api.library.collections.addToCollection, {
        collectionId: collection!._id,
        libraryItemId: otherItem!._id,
      })
    ).rejects.toThrow();
  });

  it("assigns one item to multiple collections", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const col1 = await seedCollection(t, user!._id, "Collection A");
    const col2 = await seedCollection(t, user!._id, "Collection B");
    const item = await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W1",
    });

    await asUser.mutation(api.library.collections.addToCollection, {
      collectionId: col1!._id,
      libraryItemId: item!._id,
    });
    await asUser.mutation(api.library.collections.addToCollection, {
      collectionId: col2!._id,
      libraryItemId: item!._id,
    });

    const junctionRows = await t.run(async (ctx) => {
      return await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_item", (q) => q.eq("libraryItemId", item!._id))
        .collect();
    });

    expect(junctionRows).toHaveLength(2);
  });
});

describe("removeFromCollection", () => {
  it("removes a junction row, library item still exists", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user!._id, "To Remove");
    const item = await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W1",
    });
    await seedJunctionRow(t, user!._id, collection!._id, item!._id);

    await asUser.mutation(api.library.collections.removeFromCollection, {
      collectionId: collection!._id,
      libraryItemId: item!._id,
    });

    const junctionRows = await t.run(async (ctx) => {
      return await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_collection_item", (q) =>
          q.eq("collectionId", collection!._id).eq("libraryItemId", item!._id)
        )
        .collect();
    });
    expect(junctionRows).toHaveLength(0);

    const stillExists = await t.run(async (ctx) => {
      return await ctx.db.get("libraryItems", item!._id);
    });
    expect(stillExists).not.toBeNull();
  });

  it("rejects if collection belongs to another user (FORBIDDEN)", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_user1", "user1@test.com");
    const user2 = await seedUser(t, "clerk_user2", "user2@test.com");
    const asUser1 = t.withIdentity({ subject: "clerk_user1" });

    const otherCollection = await seedCollection(t, user2!._id, "Other");
    const item = await seedLibraryItem(t, user1!._id, {
      openalexId: "https://openalex.org/W1",
    });

    await expect(
      asUser1.mutation(api.library.collections.removeFromCollection, {
        collectionId: otherCollection!._id,
        libraryItemId: item!._id,
      })
    ).rejects.toThrow();
  });

  it("is a no-op if the item is not in the collection", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user!._id, "Empty");
    const item = await seedLibraryItem(t, user!._id, {
      openalexId: "https://openalex.org/W1",
    });

    const result = await asUser.mutation(
      api.library.collections.removeFromCollection,
      {
        collectionId: collection!._id,
        libraryItemId: item!._id,
      }
    );
    expect(result).toBeNull();
  });
});

describe("browseLibrary with collectionId filter", () => {
  it("when collectionId is provided, only items in that collection are returned", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user!._id, "Filtered");
    const itemIn = await seedLibraryItem(t, user!._id, {
      title: "In Collection",
      openalexId: "https://openalex.org/W1",
      savedAt: 2000,
    });
    await seedLibraryItem(t, user!._id, {
      title: "Not In Collection",
      openalexId: "https://openalex.org/W2",
      savedAt: 1000,
    });

    await seedJunctionRow(t, user!._id, collection!._id, itemIn!._id);

    const result = await asUser.query(api.library.queries.browseLibrary, {
      sortBy: "savedAt",
      sortOrder: "desc",
      collectionId: collection!._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].title).toBe("In Collection");
  });

  it("paginates across collection-scoped browse results on later pages", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user!._id, "Paged browse");
    const first = await seedLibraryItem(t, user!._id, {
      title: "First in collection",
      openalexId: "https://openalex.org/W1",
      savedAt: 3000,
    });
    const second = await seedLibraryItem(t, user!._id, {
      title: "Second in collection",
      openalexId: "https://openalex.org/W2",
      savedAt: 2000,
    });
    await seedLibraryItem(t, user!._id, {
      title: "Outside collection",
      openalexId: "https://openalex.org/W3",
      savedAt: 1000,
    });

    await seedJunctionRow(t, user!._id, collection!._id, first!._id);
    await seedJunctionRow(t, user!._id, collection!._id, second!._id);

    const view = { sortBy: "savedAt" as const, sortOrder: "desc" as const, collectionId: collection!._id };
    const pageOne = await asUser.query(api.library.queries.browseLibrary, { ...view, paginationOpts: { numItems: 1, cursor: null } });
    const pageTwo = await asUser.query(api.library.queries.browseLibrary, { ...view, paginationOpts: { numItems: 1, cursor: pageOne.continueCursor } });
    const walked = [...pageOne.page, ...pageTwo.page].map((item) => item.title);

    expect(walked).toEqual([
      "First in collection",
      "Second in collection",
    ]);
  });

  it("when collectionId is undefined, all items are returned (existing behavior)", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "Paper A",
      openalexId: "https://openalex.org/WA",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Paper B",
      openalexId: "https://openalex.org/WB",
    });

    const result = await asUser.query(api.library.queries.browseLibrary, {
      sortBy: "savedAt",
      sortOrder: "desc",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(2);
  });

  it("when collectionId references an empty collection, returns empty results", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const emptyCol = await seedCollection(t, user!._id, "Empty");
    await seedLibraryItem(t, user!._id, {
      title: "Paper A",
      openalexId: "https://openalex.org/WA",
    });

    const result = await asUser.query(api.library.queries.browseLibrary, {
      sortBy: "savedAt",
      sortOrder: "desc",
      collectionId: emptyCol!._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(0);
  });
});

describe("searchLibrary with collectionId filter", () => {
  it("when collectionId is provided, search results are filtered to collection members only", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user!._id, "ML Papers");
    const itemIn = await seedLibraryItem(t, user!._id, {
      title: "Machine Learning In Collection",
      searchableText: "machine learning in collection paper",
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      title: "Machine Learning Outside",
      searchableText: "machine learning outside collection paper",
      openalexId: "https://openalex.org/W2",
    });

    await seedJunctionRow(t, user!._id, collection!._id, itemIn!._id);

    const result = await asUser.query(api.library.queries.searchLibrary, {
      searchText: "machine learning",
      collectionId: collection!._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].title).toBe("Machine Learning In Collection");
  });

  it("paginates across collection-scoped search results on later pages", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    const collection = await seedCollection(t, user!._id, "Paged search");
    const alpha = await seedLibraryItem(t, user!._id, {
      title: "Alpha machine paper",
      searchableText: "machine alpha paper",
      openalexId: "https://openalex.org/W1",
      savedAt: 1000,
    });
    const beta = await seedLibraryItem(t, user!._id, {
      title: "Beta machine paper",
      searchableText: "machine beta paper",
      openalexId: "https://openalex.org/W2",
      savedAt: 2000,
    });
    await seedLibraryItem(t, user!._id, {
      title: "Outside machine paper",
      searchableText: "machine outside paper",
      openalexId: "https://openalex.org/W3",
      savedAt: 3000,
    });

    await seedJunctionRow(t, user!._id, collection!._id, alpha!._id);
    await seedJunctionRow(t, user!._id, collection!._id, beta!._id);

    const firstPage = await asUser.query(api.library.queries.searchLibrary, {
      searchText: "machine",
      sortBy: "title",
      sortOrder: "asc",
      collectionId: collection!._id,
      paginationOpts: { numItems: 1, cursor: null },
    });

    expect(firstPage.page.map((item) => item.title)).toEqual([
      "Alpha machine paper",
    ]);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await asUser.query(api.library.queries.searchLibrary, {
      searchText: "machine",
      sortBy: "title",
      sortOrder: "asc",
      collectionId: collection!._id,
      paginationOpts: { numItems: 1, cursor: firstPage.continueCursor },
    });

    expect(secondPage.page.map((item) => item.title)).toEqual([
      "Beta machine paper",
    ]);
    expect(secondPage.isDone).toBe(true);
  });

  it("when collectionId is undefined, all matching items are returned", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_user1", "user1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_user1" });

    await seedLibraryItem(t, user!._id, {
      title: "ML Paper One",
      searchableText: "machine learning paper one",
      openalexId: "https://openalex.org/W1",
    });
    await seedLibraryItem(t, user!._id, {
      title: "ML Paper Two",
      searchableText: "machine learning paper two",
      openalexId: "https://openalex.org/W2",
    });

    const result = await asUser.query(api.library.queries.searchLibrary, {
      searchText: "machine learning",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page.length).toBeGreaterThanOrEqual(2);
  });
});
