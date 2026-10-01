import { query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { paginationOptsValidator, paginationResultValidator, type Cursor } from "convex/server";
import { v } from "convex/values";
import { stream } from "convex-helpers/server/stream";
import schema from "../schema";
import { requireAuth } from "../lib/auth";
import { MAX_COLLECTION_MEMBERS } from "../lib/queryBounds";

/**
 * Papers one page of a filtered view reads at most. A sparse filter gets a short page
 * and a cursor to carry on from; the library page waits for a full page before it shows
 * one (#353).
 */
const FILTERED_PAGE_ROWS = 2_000;
/** Most papers one page returns, whatever the caller asks for. */
const LIBRARY_PAGE_MAX = 500;
/** A filtered count stops at this many matches, shown as "1,000+". */
const FILTERED_COUNT_CAP = 1_000;
/** Papers a filtered count reads at most. */
const FILTERED_COUNT_ROWS = 4_000;
/**
 * Bytes one filtered page or count reads at most, whatever its papers' size: half a
 * query's 16 MiB, leaving room for a collection's memberships (about 1.5 MB at 10,000).
 */
const FILTERED_BYTES = 8 * 1024 * 1024;

const libraryPageValidator = paginationResultValidator(schema.tables.libraryItems.validator.extend({ _id: v.id("libraryItems"), _creationTime: v.number() }));

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

type LibrarySortBy = keyof typeof SORT_INDEX_MAP;

/** The bounds a filter puts on each sort field that has a range filter. */
function filterRange(field: LibrarySortBy, args: SharedLibraryFilterArgs): [number | undefined, number | undefined] {
  if (field === "rating") return [args.minRating, args.maxRating];
  if (field === "publicationYear") return [args.yearFrom, args.yearTo];
  if (field === "savedAt") return [args.savedAfter, args.savedBefore];
  return [undefined, undefined];
}

/**
 * The user's papers in `field`'s index order, narrowed to the filter's range on that
 * field, with every other filter applied as they're read.
 */
function filteredItems(
  ctx: QueryCtx,
  userId: Id<"users">,
  field: LibrarySortBy,
  order: "asc" | "desc",
  args: SharedLibraryFilterArgs,
  collectionItemIds: Set<string> | null,
) {
  const [lower, upper] = filterRange(field, args);
  return stream(ctx.db, schema)
    .query("libraryItems")
    .withIndex(SORT_INDEX_MAP[field], (q) => {
      // One builder for five indexes whose second field is `field`.
      const range = q.eq("userId", userId) as unknown as { gte(f: string, v: number): typeof range; lte(f: string, v: number): typeof range };
      const from = lower === undefined ? range : range.gte(field, lower);
      return (upper === undefined ? from : from.lte(field, upper)) as never;
    })
    .order(order)
    .filterWith(async (item) => matchesLibraryFilters(item, args, collectionItemIds));
}

/** The most results a text search returns: the search engine's own limit. */
const SEARCH_RESULTS_MAX = 1_024;

/** The user's papers matching a text search, most relevant first. */
async function searchLibraryItems(ctx: QueryCtx, userId: Id<"users">, searchText: string): Promise<LibraryItem[]> {
  return await ctx.db
    .query("libraryItems")
    .withSearchIndex("search_library", (q) => q.search("searchableText", searchText).eq("userId", userId))
    .take(SEARCH_RESULTS_MAX);
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
  returns: libraryPageValidator,
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

    const paginationOpts = { ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, LIBRARY_PAGE_MAX) };
    if (!collectionItemIds && !hasNonCollectionLibraryFilters(args)) {
      return await ctx.db
        .query("libraryItems")
        .withIndex(SORT_INDEX_MAP[args.sortBy], (q) => q.eq("userId", user._id))
        .order(args.sortOrder)
        .paginate(paginationOpts);
    }

    return await filteredItems(ctx, user._id, args.sortBy, args.sortOrder, args, collectionItemIds)
      .paginate({ ...paginationOpts, maximumRowsRead: FILTERED_PAGE_ROWS, maximumBytesRead: FILTERED_BYTES });
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
  returns: libraryPageValidator,
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
    const searchText = args.searchText.trim();
    if (!searchText) return { page: [], isDone: true, continueCursor: "" as Cursor };
    const items = await searchLibraryItems(ctx, user._id, searchText);

    return paginateLibraryItems(
      sortLibraryItems(
        items.filter((item) =>
          matchesLibraryFilters(item, args, collectionItemIds),
        ),
        sortBy,
        sortOrder,
      ),
      { ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, LIBRARY_PAGE_MAX) },
    );
  },
});

/**
 * How many papers a view shows. Exact from a counter for the whole library or a
 * collection; otherwise counted as read, stopping at FILTERED_COUNT_CAP matches or
 * FILTERED_COUNT_ROWS papers, when `capped` says there may be more (#353).
 */
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
  returns: v.object({ count: v.number(), capped: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const searchText = args.searchText?.trim();
    const hasFilters = Boolean(searchText) || hasNonCollectionLibraryFilters(args);

    if (!args.collectionId && !hasFilters) {
      return { count: user.libraryItemCount, capped: false };
    }
    if (args.collectionId && !hasFilters) {
      const collection = await ctx.db.get("collections", args.collectionId);
      return { count: collection?.userId === user._id ? collection.itemCount : 0, capped: false };
    }

    const collectionItemIds = await loadCollectionItemIds(ctx, user._id, args.collectionId);
    if (args.collectionId && !collectionItemIds?.size) return { count: 0, capped: false };

    if (searchText) {
      const found = await searchLibraryItems(ctx, user._id, searchText);
      const count = found.filter((item) => matchesLibraryFilters(item, args, collectionItemIds)).length;
      return { count, capped: found.length === SEARCH_RESULTS_MAX };
    }

    // Read along the index of a filtered field, so single-field filters only read matches.
    const field = (["rating", "publicationYear", "savedAt"] as const).find((name) => filterRange(name, args).some((bound) => bound !== undefined)) ?? "savedAt";
    const counted = await filteredItems(ctx, user._id, field, "asc", args, collectionItemIds)
      .paginate({ cursor: null, numItems: FILTERED_COUNT_CAP, maximumRowsRead: FILTERED_COUNT_ROWS, maximumBytesRead: FILTERED_BYTES });
    return { count: counted.page.length, capped: !counted.isDone };
  },
});

export const getLibraryCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    return user.libraryItemCount;
  },
});
