import { query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { paginationOptsValidator, paginationResultValidator, type Cursor, type PaginationOptions } from "convex/server";
import { v } from "convex/values";
import { stream } from "convex-helpers/server/stream";
import schema from "../schema";
import { requireAuth } from "../lib/auth";
import { MAX_COLLECTION_MEMBERS } from "../lib/queryBounds";
import { libraryCount } from "./counter";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { LIBRARY_SEARCH_RESULTS_MAX as SEARCH_RESULTS_MAX } from "../../lib/library/limits";
import { libraryFilterFields, librarySortOrderValidator, librarySortValidator, type LibraryView } from "./validators";

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

export const libraryPageValidator = paginationResultValidator(schema.tables.libraryItems.validator.extend({ _id: v.id("libraryItems"), _creationTime: v.number() }));

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

  if (args.minRating !== undefined || args.maxRating !== undefined) {
    // A rating filter only matches rated papers.
    if (item.rating === undefined) return false;
    if (args.minRating !== undefined && item.rating < args.minRating) return false;
    if (args.maxRating !== undefined && item.rating > args.maxRating) return false;
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

export type LibraryPage = { page: LibraryItem[]; isDone: boolean; continueCursor: Cursor };

const emptyPage: LibraryPage = { page: [], isDone: true, continueCursor: "" as Cursor };

/**
 * One page of someone's library view. A search reads its every match, the search engine's
 * limit, and pages them in memory; a browse reads through the sort's index, and a filtered
 * one stops after FILTERED_PAGE_ROWS papers with a cursor to carry on from.
 */
export async function readLibraryPage(ctx: QueryCtx, userId: Id<"users">, view: LibraryView, paginationOpts: PaginationOptions): Promise<LibraryPage> {
  const collectionItemIds = await loadCollectionItemIds(ctx, userId, view.collectionId);
  if (view.collectionId && (collectionItemIds === null || collectionItemIds.size === 0)) return emptyPage;

  if (view.searchText !== undefined) {
    const searchText = view.searchText.trim();
    if (!searchText) return emptyPage;
    const items = await searchLibraryItems(ctx, userId, searchText);
    return paginateLibraryItems(
      sortLibraryItems(items.filter((item) => matchesLibraryFilters(item, view, collectionItemIds)), view.sortBy, view.sortOrder),
      // Every match is read anyway, so a caller may take them all in one page.
      { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, SEARCH_RESULTS_MAX) },
    );
  }

  const page = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, LIBRARY_PAGE_MAX) };
  if (!collectionItemIds && !hasNonCollectionLibraryFilters(view)) {
    return await ctx.db
      .query("libraryItems")
      .withIndex(SORT_INDEX_MAP[view.sortBy], (q) => q.eq("userId", userId))
      .order(view.sortOrder)
      .paginate(page);
  }
  return await filteredItems(ctx, userId, view.sortBy, view.sortOrder, view, collectionItemIds)
    .paginate({ ...page, maximumRowsRead: FILTERED_PAGE_ROWS, maximumBytesRead: FILTERED_BYTES });
}

export const browseLibrary = query({
  args: {
    sortBy: librarySortValidator,
    sortOrder: librarySortOrderValidator,
    ...libraryFilterFields,
    paginationOpts: paginationOptsValidator,
  },
  returns: libraryPageValidator,
  handler: async (ctx, { paginationOpts, ...view }) => {
    const user = await requireAuth(ctx);
    return await readLibraryPage(ctx, user._id, view, paginationOpts);
  },
});

export const searchLibrary = query({
  args: {
    searchText: v.string(),
    sortBy: v.optional(librarySortValidator),
    sortOrder: v.optional(librarySortOrderValidator),
    ...libraryFilterFields,
    paginationOpts: paginationOptsValidator,
  },
  returns: libraryPageValidator,
  handler: async (ctx, { paginationOpts, sortBy = "savedAt", sortOrder = "desc", ...view }) => {
    const user = await requireAuth(ctx);
    return await readLibraryPage(ctx, user._id, { ...view, sortBy, sortOrder }, paginationOpts);
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
    ...libraryFilterFields,
    searchText: v.optional(v.string()),
  },
  returns: v.object({ count: v.number(), capped: v.boolean() }),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const searchText = args.searchText?.trim();
    const hasFilters = Boolean(searchText) || hasNonCollectionLibraryFilters(args);

    if (!args.collectionId && !hasFilters) {
      return { count: await libraryCount(ctx, user), capped: false };
    }
    if (args.collectionId && !hasFilters) {
      const collection = await ctx.db.get("collections", args.collectionId);
      if (collection?.userId !== user._id) return { count: 0, capped: false };
      // A collection saved before counts were kept is counted until migrations/backfillLibraryCounters runs.
      return { count: collection.itemCount ?? (await loadCollectionItemIds(ctx, user._id, args.collectionId))!.size, capped: false };
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
    return await libraryCount(ctx, user);
  },
});

export const savedPaperAction = defineUserQuery({
  path: "library/queries:savedPaper",
  description: "Whether a paper is in the person's library, and whether it's in any of their collections.",
  args: { openalexId: v.string() },
  returns: v.union(v.object({ libraryItemId: v.id("libraryItems"), inCollection: v.boolean() }), v.null()),
  run: async (ctx, userId, args) => {
    const item = await ctx.db
      .query("libraryItems")
      .withIndex("by_user_openalexId", (q) => q.eq("userId", userId).eq("openalexId", args.openalexId))
      .unique();
    if (!item) return null;
    const membership = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_item", (q) => q.eq("libraryItemId", item._id))
      .first();
    return { libraryItemId: item._id, inCollection: membership !== null };
  },
});
export const savedPaper = userQuery(savedPaperAction);
export const savedPaperForAssistant = assistantQuery(savedPaperAction);
