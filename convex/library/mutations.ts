import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";

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
    return await ctx.db.insert("libraryItems", {
      userId: user._id,
      ...args,
      searchableText,
      savedAt: Date.now(),
      updatedAt: Date.now(),
    });
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

    await ctx.db.delete(args.itemId);
    return null;
  },
});
