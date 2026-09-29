import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { MAX_LIBRARY_BROWSE } from "../lib/queryBounds";
import { resolveLibraryCount } from "./counter";
import { removeCollectionMembership } from "./collectionMembership";

export const backfillLibraryCount = internalMutation({
  args: { userId: v.id("users"), count: v.number() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user || user.libraryItemCount !== undefined) return;
    await ctx.db.patch("users", args.userId, { libraryItemCount: args.count });
  },
});

export const backfillAllLibraryCounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Cardinality: small user base, safe to collect
    const users = await ctx.db.query("users").collect();
    let backfilled = 0;

    for (const user of users) {
      if (user.libraryItemCount !== undefined) continue;

      const items = await ctx.db
        .query("libraryItems")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(MAX_LIBRARY_BROWSE);

      await ctx.db.patch("users", user._id, { libraryItemCount: items.length });
      backfilled++;
    }

    console.log(`Backfilled libraryItemCount for ${backfilled} users`);
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
    workType: v.optional(v.string()),
    isOpenAccess: v.optional(v.boolean()),
    oaStatus: v.optional(v.string()),
    paperData: v.optional(v.string()),
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
      // Re-rate: update rating, paperData, and timestamps; preserve original metadata and savedAt
      await ctx.db.patch("libraryItems", existing._id, {
        rating: args.rating,
        searchableText,
        ...(args.paperData !== undefined && { paperData: args.paperData }),
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    const currentCount = await resolveLibraryCount(
      ctx,
      user._id,
      user.libraryItemCount,
    );

    // New save: insert full document
    const id = await ctx.db.insert("libraryItems", {
      userId: user._id,
      ...args,
      searchableText,
      savedAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Increment denormalized counter
    await ctx.db.patch("users", user._id, { libraryItemCount: currentCount + 1 });

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
      const currentCount = await resolveLibraryCount(
        ctx,
        user._id,
        user.libraryItemCount,
      );

      // Unbounded: cascade delete of single item's collection memberships (safe: bounded by collections per user, ~50 max)
      const memberships = await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_item", (q) => q.eq("libraryItemId", item._id))
        .collect();
      for (const m of memberships) await removeCollectionMembership(ctx, m);
      await ctx.db.delete("libraryItems", item._id);

      // Decrement denormalized counter
      await ctx.db.patch("users", user._id, {
        libraryItemCount: Math.max(0, currentCount - 1),
      });
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
    const item = await ctx.db.get("libraryItems", args.itemId);

    if (!item) {
      throw createError("NOT_FOUND", "Library item not found");
    }
    if (item.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your library item");
    }

    const currentCount = await resolveLibraryCount(
      ctx,
      user._id,
      user.libraryItemCount,
    );

    // Unbounded: cascade delete of single item's collection memberships (safe: bounded by collections per user, ~50 max)
    const memberships = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_item", (q) => q.eq("libraryItemId", args.itemId))
      .collect();
    for (const m of memberships) await removeCollectionMembership(ctx, m);

    await ctx.db.delete("libraryItems", args.itemId);

    // Decrement denormalized counter
    await ctx.db.patch("users", user._id, {
      libraryItemCount: Math.max(0, currentCount - 1),
    });

    return null;
  },
});
