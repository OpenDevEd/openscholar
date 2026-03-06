import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";

export const backfillLibraryCount = internalMutation({
  args: { userId: v.id("users"), count: v.number() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.libraryItemCount !== undefined) return;
    await ctx.db.patch(args.userId, { libraryItemCount: args.count });
  },
});

export const saveToLibrary = mutation({
  args: {
    openalexId: v.string(),
    rating: v.number(),
    title: v.string(),
    authors: v.optional(v.string()),
    doi: v.optional(v.string()),
    abstract: v.optional(v.string()),
    publicationYear: v.optional(v.number()),
    journal: v.optional(v.string()),
    citedByCount: v.optional(v.number()),
    isOpenAccess: v.optional(v.boolean()),
    oaStatus: v.optional(v.string()),
  },
  returns: v.id("libraryItems"),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const searchableText = [args.title, args.abstract, args.authors]
      .filter(Boolean)
      .join(" ");

    // Upsert: check if paper already in user's library
    const existing = await ctx.db
      .query("libraryItems")
      .withIndex("by_user_openalexId", (q) =>
        q.eq("userId", user._id).eq("openalexId", args.openalexId)
      )
      .unique();

    if (existing) {
      // Re-rate: only update rating and timestamps, preserve original metadata and savedAt
      await ctx.db.patch(existing._id, {
        rating: args.rating,
        searchableText,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    // New save: insert full document
    const id = await ctx.db.insert("libraryItems", {
      userId: user._id,
      ...args,
      searchableText,
      savedAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Increment denormalized counter
    const currentCount = user.libraryItemCount ?? 0;
    await ctx.db.patch(user._id, { libraryItemCount: currentCount + 1 });

    return id;
  },
});

export const removeFromLibraryByOpenalexId = mutation({
  args: {
    openalexId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const item = await ctx.db
      .query("libraryItems")
      .withIndex("by_user_openalexId", (q) =>
        q.eq("userId", user._id).eq("openalexId", args.openalexId)
      )
      .unique();

    if (item) {
      // Cascade-delete junction rows (collection memberships)
      const memberships = await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_item", (q) => q.eq("libraryItemId", item._id))
        .collect();
      for (const m of memberships) {
        await ctx.db.delete(m._id);
      }
      await ctx.db.delete(item._id);

      // Decrement denormalized counter
      const currentCount = user.libraryItemCount ?? 0;
      await ctx.db.patch(user._id, { libraryItemCount: Math.max(0, currentCount - 1) });
    }
    return null;
  },
});

export const removeFromLibrary = mutation({
  args: {
    itemId: v.id("libraryItems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const item = await ctx.db.get(args.itemId);

    if (!item) {
      throw createError("NOT_FOUND", "Library item not found");
    }
    if (item.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your library item");
    }

    // Cascade-delete junction rows (collection memberships)
    const memberships = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_item", (q) => q.eq("libraryItemId", args.itemId))
      .collect();
    for (const m of memberships) {
      await ctx.db.delete(m._id);
    }

    await ctx.db.delete(args.itemId);

    // Decrement denormalized counter
    const currentCount = user.libraryItemCount ?? 0;
    await ctx.db.patch(user._id, { libraryItemCount: Math.max(0, currentCount - 1) });

    return null;
  },
});
