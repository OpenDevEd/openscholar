import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";

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
    const collection = await ctx.db.get(args.collectionId);
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
    await ctx.db.patch(args.collectionId, {
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
    const collection = await ctx.db.get(args.collectionId);
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
      .collect();
    for (const m of memberships) {
      await ctx.db.delete(m._id);
    }
    await ctx.db.delete(args.collectionId);
    return null;
  },
});

export const listCollections = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
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
    const collection = await ctx.db.get(args.collectionId);
    if (!collection || collection.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your collection");
    }

    // Verify library item ownership
    const item = await ctx.db.get(args.libraryItemId);
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
    const collection = await ctx.db.get(args.collectionId);
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
      await ctx.db.delete(existing._id);
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

    // Fetch all user collections
    const collections = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Count junction rows per collection
    const result = await Promise.all(
      collections.map(async (collection) => {
        const memberships = await ctx.db
          .query("libraryItemCollections")
          .withIndex("by_collection", (q) =>
            q.eq("collectionId", collection._id)
          )
          .collect();
        return {
          ...collection,
          itemCount: memberships.length,
        };
      })
    );

    // Sort alphabetically by name (case-insensitive)
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getItemCollections = query({
  args: { libraryItemId: v.id("libraryItems") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const memberships = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_item", (q) => q.eq("libraryItemId", args.libraryItemId))
      .collect();

    return memberships.map((m) => m.collectionId);
  },
});
