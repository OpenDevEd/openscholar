import { mutation, query, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { MAX_COLLECTION_MEMBERS } from "../lib/queryBounds";

// ═══════════════════════════════════════════════════════════════
// COLLECTION CRUD (Plan 01 prerequisites)
// ═══════════════════════════════════════════════════════════════

export const createCollection = mutation({
  args: { name: v.string() },
  returns: v.id("collections"),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const trimmed = args.name.trim();
    if (!trimmed) {
      throw createError("VALIDATION_ERROR", "Collection name cannot be empty");
    }
    return await ctx.db.insert("collections", {
      userId: user._id,
      name: trimmed,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const renameCollection = mutation({
  args: { collectionId: v.id("collections"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const collection = await ctx.db.get("collections", args.collectionId);
    if (!collection) {
      throw createError("NOT_FOUND", "Collection not found");
    }
    if (collection.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your collection");
    }
    const trimmed = args.name.trim();
    if (!trimmed) {
      throw createError("VALIDATION_ERROR", "Collection name cannot be empty");
    }
    await ctx.db.patch("collections", args.collectionId, {
      name: trimmed,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const deleteCollection = mutation({
  args: { collectionId: v.id("collections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const collection = await ctx.db.get("collections", args.collectionId);
    if (!collection) {
      throw createError("NOT_FOUND", "Collection not found");
    }
    if (collection.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your collection");
    }
    // Cascade: delete all junction rows
    const memberships = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection", (q) => q.eq("collectionId", args.collectionId))
      .take(MAX_COLLECTION_MEMBERS);
    for (const m of memberships) {
      await ctx.db.delete("libraryItemCollections", m._id);
    }
    await ctx.db.delete("collections", args.collectionId);
    return null;
  },
});

export const backfillCollectionCounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Cardinality: small total collection count across all users
    const collections = await ctx.db.query("collections").collect();
    let backfilled = 0;

    for (const collection of collections) {
      if (collection.itemCount !== undefined) continue;

      const memberships = await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .collect();

      await ctx.db.patch("collections", collection._id, { itemCount: memberships.length });
      backfilled++;
    }

    console.log(`Backfilled itemCount for ${backfilled} collections`);
  },
});

export const listCollections = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    // Cardinality: ~1-50 collections per user (user-created)
    const collections = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return collections.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// ═══════════════════════════════════════════════════════════════
// COLLECTION ASSIGNMENT (Plan 02)
// ═══════════════════════════════════════════════════════════════

export const addToCollection = mutation({
  args: {
    collectionId: v.id("collections"),
    libraryItemId: v.id("libraryItems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify collection ownership
    const collection = await ctx.db.get("collections", args.collectionId);
    if (!collection || collection.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your collection");
    }

    // Verify library item ownership
    const item = await ctx.db.get("libraryItems", args.libraryItemId);
    if (!item || item.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your library item");
    }

    // Check for existing assignment (idempotent)
    const existing = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection_item", (q) =>
        q
          .eq("collectionId", args.collectionId)
          .eq("libraryItemId", args.libraryItemId)
      )
      .unique();

    if (existing) return null; // Already assigned, no-op

    await ctx.db.insert("libraryItemCollections", {
      userId: user._id,
      collectionId: args.collectionId,
      libraryItemId: args.libraryItemId,
      assignedAt: Date.now(),
    });

    // Increment denormalized collection counter
    const currentCount = collection.itemCount ?? 0;
    await ctx.db.patch("collections", args.collectionId, { itemCount: currentCount + 1 });

    return null;
  },
});

export const removeFromCollection = mutation({
  args: {
    collectionId: v.id("collections"),
    libraryItemId: v.id("libraryItems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify collection ownership
    const collection = await ctx.db.get("collections", args.collectionId);
    if (!collection || collection.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your collection");
    }

    // Find and delete junction row if it exists
    const existing = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection_item", (q) =>
        q
          .eq("collectionId", args.collectionId)
          .eq("libraryItemId", args.libraryItemId)
      )
      .unique();

    if (existing) {
      await ctx.db.delete("libraryItemCollections", existing._id);

      // Decrement denormalized collection counter
      const currentCount = collection.itemCount ?? 0;
      await ctx.db.patch("collections", args.collectionId, { itemCount: Math.max(0, currentCount - 1) });
    }
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════
// COLLECTION QUERIES (Plan 02)
// ═══════════════════════════════════════════════════════════════

export const getCollectionsWithCounts = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);

    // Cardinality: ~1-50 collections per user (user-created)
    const collections = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Read denormalized counter (fallback to 0 for unbackfilled)
    const result = collections.map((collection) => ({
      ...collection,
      itemCount: collection.itemCount ?? 0,
    }));

    // Sort alphabetically by name (case-insensitive)
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getItemCollections = query({
  args: { libraryItemId: v.id("libraryItems") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    // Cardinality: ~1-50 collections per library item (user-created)
    const memberships = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_item", (q) => q.eq("libraryItemId", args.libraryItemId))
      .collect();

    return memberships.map((m) => m.collectionId);
  },
});
