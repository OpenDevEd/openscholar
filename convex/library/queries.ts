import { query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { paginationOptsValidator, type Cursor } from "convex/server";
import { v } from "convex/values";
import { filter } from "convex-helpers/server/filter";
import { requireAuth } from "../lib/auth";
import { MAX_COLLECTION_MEMBERS, MAX_LIBRARY_BROWSE } from "../lib/queryBounds";

const librarySortValidator = v.union(
  v.literal("savedAt"),
  v.literal("rating"),
  v.literal("publicationYear"),
  v.literal("citedByCount"),
  v.literal("title"),
);
const librarySortOrderValidator = v.union(v.literal("asc"), v.literal("desc"));

type LibraryItem = Doc<"libraryItems">;

const SORT_INDEX_MAP = {
  savedAt: "by_user_savedAt",
  rating: "by_user_rating",
  publicationYear: "by_user_year",
  citedByCount: "by_user_citedByCount",
  title: "by_user_title",
} as const;

type SharedLibraryFilterArgs = {
  minRating?: number;
  maxRating?: number;
  savedAfter?: number;
  savedBefore?: number;
  yearFrom?: number;
  yearTo?: number;
};

type SharedLibraryListArgs = SharedLibraryFilterArgs & {
  collectionId?: Id<"collections">;
};

async function loadCollectionItemIds(
  ctx: QueryCtx,
  userId: Id<"users">,
  collectionId: Id<"collections"> | undefined,
): Promise<Set<string> | null> {
  if (!collectionId) return null;

  const collection = await ctx.db.get("collections", collectionId);
  if (!collection || collection.userId !== userId) {
    return null;
  }

  const memberships = await ctx.db
    .query("libraryItemCollections")
    .withIndex("by_collection", (q) => q.eq("collectionId", collectionId))
    .take(MAX_COLLECTION_MEMBERS);

  return new Set(memberships.map((membership) => membership.libraryItemId as string));
}

function matchesLibraryFilters(
  item: LibraryItem,
  args: SharedLibraryFilterArgs,
  collectionItemIds: Set<string> | null,
): boolean {
  if (collectionItemIds && !collectionItemIds.has(item._id as string)) {
    return false;
  }

  if (args.minRating !== undefined && item.rating < args.minRating) {
    return false;
  }

  if (args.maxRating !== undefined && item.rating > args.maxRating) {
    return false;
  }

  if (args.savedAfter !== undefined && item.savedAt < args.savedAfter) {
    return false;
  }

  if (args.savedBefore !== undefined && item.savedAt > args.savedBefore) {
    return false;
  }

  if (
    args.yearFrom !== undefined &&
    (item.publicationYear == null || item.publicationYear < args.yearFrom)
  ) {
    return false;
  }

  if (
    args.yearTo !== undefined &&
    (item.publicationYear == null || item.publicationYear > args.yearTo)
  ) {
    return false;
  }

  return true;
}

function compareNullableNumbers(
  left: number | undefined,
  right: number | undefined,
  sortOrder: "asc" | "desc",
): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;

  return sortOrder === "asc" ? left - right : right - left;
}

function compareStrings(
  left: string,
  right: string,
  sortOrder: "asc" | "desc",
): number {
  const comparison = left.localeCompare(right, undefined, {
    sensitivity: "base",
    numeric: true,
  });
  return sortOrder === "asc" ? comparison : -comparison;
}

function sortLibraryItems(
  items: LibraryItem[],
  sortBy: "savedAt" | "rating" | "publicationYear" | "citedByCount" | "title",
  sortOrder: "asc" | "desc",
): LibraryItem[] {
  return [...items].sort((left, right) => {
    switch (sortBy) {
      case "savedAt":
        return compareNullableNumbers(left.savedAt, right.savedAt, sortOrder);
      case "rating":
        return compareNullableNumbers(left.rating, right.rating, sortOrder);
      case "publicationYear":
        return compareNullableNumbers(
          left.publicationYear ?? undefined,
          right.publicationYear ?? undefined,
          sortOrder,
        );
      case "citedByCount":
        return compareNullableNumbers(
          left.citedByCount ?? undefined,
          right.citedByCount ?? undefined,
          sortOrder,
        );
      case "title":
        return compareStrings(left.title, right.title, sortOrder);
      default:
        return 0;
    }
  });
}

function hasActiveLibraryFilters(
  args: SharedLibraryListArgs,
  collectionItemIds: Set<string> | null,
): boolean {
  return (
    args.minRating !== undefined ||
    args.maxRating !== undefined ||
    args.savedAfter !== undefined ||
    args.savedBefore !== undefined ||
    args.yearFrom !== undefined ||
    args.yearTo !== undefined ||
    collectionItemIds !== null
  );
}

async function collectLibraryItems(
  ctx: QueryCtx,
  userId: Id<"users">,
  sortBy: "savedAt" | "rating" | "publicationYear" | "citedByCount" | "title",
  sortOrder: "asc" | "desc",
  searchText: string | undefined,
): Promise<LibraryItem[]> {
  const normalizedSearch = searchText?.trim();

  if (normalizedSearch) {
    // Cardinality: bounded by Convex search engine (max ~256 results)
    return await ctx.db
      .query("libraryItems")
      .withSearchIndex("search_library", (q) =>
        q.search("searchableText", normalizedSearch).eq("userId", userId),
      )
      .collect();
  }

  return await ctx.db
    .query("libraryItems")
    .withIndex(SORT_INDEX_MAP[sortBy], (q) => q.eq("userId", userId))
    .order(sortOrder)
    .take(MAX_LIBRARY_BROWSE);
}

export const browseLibrary = query({
  args: {
    sortBy: librarySortValidator,
    sortOrder: librarySortOrderValidator,
    minRating: v.optional(v.number()),
    maxRating: v.optional(v.number()),
    savedAfter: v.optional(v.number()),
    savedBefore: v.optional(v.number()),
    yearFrom: v.optional(v.number()),
    yearTo: v.optional(v.number()),
    collectionId: v.optional(v.id("collections")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const collectionItemIds = await loadCollectionItemIds(
      ctx,
      user._id,
      args.collectionId,
    );

    if (args.collectionId && collectionItemIds === null) {
      return { page: [], isDone: true, continueCursor: "" as Cursor };
    }

    if (collectionItemIds?.size === 0) {
      return { page: [], isDone: true, continueCursor: "" as Cursor };
    }

    const orderedQuery = ctx.db
      .query("libraryItems")
      .withIndex(SORT_INDEX_MAP[args.sortBy], (q) => q.eq("userId", user._id))
      .order(args.sortOrder);

    if (!hasActiveLibraryFilters(args, collectionItemIds)) {
      return await orderedQuery.paginate(args.paginationOpts);
    }

    return await filter(orderedQuery, (item) =>
      matchesLibraryFilters(item, args, collectionItemIds),
    ).paginate(args.paginationOpts);
  },
});

export const searchLibrary = query({
  args: {
    searchText: v.string(),
    minRating: v.optional(v.number()),
    maxRating: v.optional(v.number()),
    savedAfter: v.optional(v.number()),
    savedBefore: v.optional(v.number()),
    yearFrom: v.optional(v.number()),
    yearTo: v.optional(v.number()),
    collectionId: v.optional(v.id("collections")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const collectionItemIds = await loadCollectionItemIds(
      ctx,
      user._id,
      args.collectionId,
    );

    if (args.collectionId && collectionItemIds === null) {
      return { page: [], isDone: true, continueCursor: "" as Cursor };
    }

    if (collectionItemIds?.size === 0) {
      return { page: [], isDone: true, continueCursor: "" as Cursor };
    }

    const searchQuery = ctx.db
      .query("libraryItems")
      .withSearchIndex("search_library", (q) =>
        q.search("searchableText", args.searchText.trim()).eq("userId", user._id),
      );

    if (!hasActiveLibraryFilters(args, collectionItemIds)) {
      return await searchQuery.paginate(args.paginationOpts);
    }

    return await filter(searchQuery, (item) =>
      matchesLibraryFilters(item, args, collectionItemIds),
    ).paginate(args.paginationOpts);
  },
});

export const listLibrary = query({
  args: {
    sortBy: librarySortValidator,
    sortOrder: librarySortOrderValidator,
    minRating: v.optional(v.number()),
    maxRating: v.optional(v.number()),
    savedAfter: v.optional(v.number()),
    savedBefore: v.optional(v.number()),
    yearFrom: v.optional(v.number()),
    yearTo: v.optional(v.number()),
    collectionId: v.optional(v.id("collections")),
    searchText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const collectionItemIds = await loadCollectionItemIds(
      ctx,
      user._id,
      args.collectionId,
    );

    if (args.collectionId && collectionItemIds === null) {
      return [];
    }

    if (collectionItemIds?.size === 0) {
      return [];
    }

    const items = await collectLibraryItems(
      ctx,
      user._id,
      args.sortBy,
      args.sortOrder,
      args.searchText,
    );

    return sortLibraryItems(
      items.filter((item) => matchesLibraryFilters(item, args, collectionItemIds)),
      args.sortBy,
      args.sortOrder,
    );
  },
});

export const getLibraryCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);

    // O(1) path: read denormalized counter directly
    if (user.libraryItemCount !== undefined) {
      return user.libraryItemCount;
    }

    // Lazy backfill path: scan items for users who don't have the counter yet.
    // The counter will be initialized on the next save/remove mutation.
    // Note: ctx.scheduler is not available in query context, so we cannot
    // schedule a backfill from here. The counter gets set on the first
    // mutation (save or remove) for this user.
    const items = await ctx.db
      .query("libraryItems")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_LIBRARY_BROWSE);
    return items.length;
  },
});
