import { query } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { filter } from "convex-helpers/server/filter";

export const browseLibrary = query({
  args: {
    sortBy: v.union(
      v.literal("savedAt"),
      v.literal("rating"),
      v.literal("publicationYear")
    ),
    sortOrder: v.union(v.literal("asc"), v.literal("desc")),
    minRating: v.optional(v.number()),
    savedAfter: v.optional(v.number()),
    yearFrom: v.optional(v.number()),
    yearTo: v.optional(v.number()),
    collectionId: v.optional(v.id("collections")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Pre-fetch collection member IDs if filtering by collection
    let collectionItemIds: Set<string> | null = null;
    if (args.collectionId) {
      // Guard: verify collection exists and belongs to user
      const collection = await ctx.db.get(args.collectionId);
      if (!collection || collection.userId !== user._id) {
        return { page: [], isDone: true, continueCursor: "" as any };
      }
      const memberships = await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_collection", (q) =>
          q.eq("collectionId", args.collectionId!)
        )
        .collect();
      collectionItemIds = new Set(
        memberships.map((m) => m.libraryItemId as string)
      );
      // Empty collection = no results possible
      if (collectionItemIds.size === 0) {
        return { page: [], isDone: true, continueCursor: "" as any };
      }
    }

    const indexMap = {
      savedAt: "by_user_savedAt",
      rating: "by_user_rating",
      publicationYear: "by_user_year",
    } as const;

    const q = ctx.db
      .query("libraryItems")
      .withIndex(indexMap[args.sortBy], (q) => q.eq("userId", user._id))
      .order(args.sortOrder);

    const needsFilter =
      args.minRating !== undefined ||
      args.savedAfter !== undefined ||
      args.yearFrom !== undefined ||
      args.yearTo !== undefined ||
      collectionItemIds !== null;

    if (needsFilter) {
      return await filter(q, (item) => {
        if (
          collectionItemIds &&
          !collectionItemIds.has(item._id as string)
        )
          return false;
        if (args.minRating !== undefined && item.rating < args.minRating) return false;
        if (args.savedAfter !== undefined && item.savedAt < args.savedAfter) return false;
        if (args.yearFrom !== undefined && (item.publicationYear == null || item.publicationYear < args.yearFrom)) return false;
        if (args.yearTo !== undefined && (item.publicationYear == null || item.publicationYear > args.yearTo)) return false;
        return true;
      }).paginate(args.paginationOpts);
    }

    return await q.paginate(args.paginationOpts);
  },
});

export const searchLibrary = query({
  args: {
    searchText: v.string(),
    minRating: v.optional(v.number()),
    savedAfter: v.optional(v.number()),
    yearFrom: v.optional(v.number()),
    yearTo: v.optional(v.number()),
    collectionId: v.optional(v.id("collections")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Pre-fetch collection member IDs if filtering by collection
    let collectionItemIds: Set<string> | null = null;
    if (args.collectionId) {
      // Guard: verify collection exists and belongs to user
      const collection = await ctx.db.get(args.collectionId);
      if (!collection || collection.userId !== user._id) {
        return { page: [], isDone: true, continueCursor: "" as any };
      }
      const memberships = await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_collection", (q) =>
          q.eq("collectionId", args.collectionId!)
        )
        .collect();
      collectionItemIds = new Set(
        memberships.map((m) => m.libraryItemId as string)
      );
      // Empty collection = no results possible
      if (collectionItemIds.size === 0) {
        return { page: [], isDone: true, continueCursor: "" as any };
      }
    }

    const q = ctx.db
      .query("libraryItems")
      .withSearchIndex("search_library", (q) =>
        q.search("searchableText", args.searchText).eq("userId", user._id)
      );

    const needsFilter =
      args.minRating !== undefined ||
      args.savedAfter !== undefined ||
      args.yearFrom !== undefined ||
      args.yearTo !== undefined ||
      collectionItemIds !== null;

    if (needsFilter) {
      return await filter(q, (item) => {
        if (
          collectionItemIds &&
          !collectionItemIds.has(item._id as string)
        )
          return false;
        if (args.minRating !== undefined && item.rating < args.minRating) return false;
        if (args.savedAfter !== undefined && item.savedAt < args.savedAfter) return false;
        if (args.yearFrom !== undefined && (item.publicationYear == null || item.publicationYear < args.yearFrom)) return false;
        if (args.yearTo !== undefined && (item.publicationYear == null || item.publicationYear > args.yearTo)) return false;
        return true;
      }).paginate(args.paginationOpts);
    }

    return await q.paginate(args.paginationOpts);
  },
});

export const getLibraryCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const items = await ctx.db
      .query("libraryItems")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return items.length;
  },
});
