import { query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { paginationOptsValidator, type Cursor } from "convex/server";
import { ConvexError, v } from "convex/values";
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

type ManualPaginationOptions = {
  numItems: number;
  cursor: string | null;
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

function hasNonCollectionLibraryFilters(args: SharedLibraryFilterArgs): boolean {
  return (
    args.minRating !== undefined ||
    args.maxRating !== undefined ||
    args.savedAfter !== undefined ||
    args.savedBefore !== undefined ||
    args.yearFrom !== undefined ||
    args.yearTo !== undefined
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

async function resolveLibraryCount(
  ctx: QueryCtx,
  userId: Id<"users">,
  storedCount: number | undefined,
): Promise<number> {
  if (storedCount !== undefined) {
    return storedCount;
  }

  const items = await ctx.db
    .query("libraryItems")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(MAX_LIBRARY_BROWSE + 1);

  if (items.length > MAX_LIBRARY_BROWSE) {
    throw new ConvexError({
      code: "LIBRARY_COUNT_REPAIR_REQUIRED",
      message: "Library counter missing for a user whose library exceeds the bounded recount window.",
    });
  }

  console.error("[library] Missing libraryItemCount; using bounded live recount", {
    userId,
    liveCount: items.length,
  });

  return items.length;
}

function paginateLibraryItems(
  items: LibraryItem[],
  paginationOpts: ManualPaginationOptions,
): { page: LibraryItem[]; isDone: boolean; continueCursor: Cursor } {
  const start =
    paginationOpts.cursor === null
      ? 0
      : Math.max(0, Number.parseInt(paginationOpts.cursor, 10) || 0);
  const page = items.slice(start, start + paginationOpts.numItems);
  const nextOffset = start + page.length;
  const isDone = nextOffset >= items.length;

  return {
    page,
    isDone,
    continueCursor: (isDone ? "" : String(nextOffset)) as Cursor,
  };
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

    const items = await collectLibraryItems(
      ctx,
      user._id,
      args.sortBy,
      args.sortOrder,
      undefined,
    );

    return paginateLibraryItems(
      items.filter((item) => matchesLibraryFilters(item, args, collectionItemIds)),
      args.paginationOpts,
    );
  },
});

export const searchLibrary = query({
  args: {
    searchText: v.string(),
    sortBy: v.optional(librarySortValidator),
    sortOrder: v.optional(librarySortOrderValidator),
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
    const sortBy = args.sortBy ?? "savedAt";
    const sortOrder = args.sortOrder ?? "desc";
    const items = await collectLibraryItems(
      ctx,
      user._id,
      sortBy,
      sortOrder,
      args.searchText,
    );

    return paginateLibraryItems(
      sortLibraryItems(
        items.filter((item) =>
          matchesLibraryFilters(item, args, collectionItemIds),
        ),
        sortBy,
        sortOrder,
      ),
      args.paginationOpts,
    );
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

export const getLibraryFilteredCount = query({
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
  returns: v.number(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const collectionItemIds = await loadCollectionItemIds(
      ctx,
      user._id,
      args.collectionId,
    );

    if (args.collectionId && collectionItemIds === null) {
      return 0;
    }

    if (collectionItemIds?.size === 0) {
      return 0;
    }

    const normalizedSearch = args.searchText?.trim();
    const hasSearch = Boolean(normalizedSearch);
    const hasExtraFilters = hasNonCollectionLibraryFilters(args);

    if (!hasSearch && !hasExtraFilters) {
      if (collectionItemIds) {
        return collectionItemIds.size;
      }
      return await resolveLibraryCount(ctx, user._id, user.libraryItemCount);
    }

    const items = await collectLibraryItems(
      ctx,
      user._id,
      args.sortBy,
      args.sortOrder,
      normalizedSearch,
    );

    return items.filter((item) =>
      matchesLibraryFilters(item, args, collectionItemIds),
    ).length;
  },
});

export const getLibraryCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    return await resolveLibraryCount(ctx, user._id, user.libraryItemCount);
  },
});
