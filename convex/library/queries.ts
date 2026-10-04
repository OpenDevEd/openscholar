import { query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { paginationOptsValidator, paginationResultValidator, type Cursor, type PaginationOptions } from "convex/server";
import { v, type ObjectType } from "convex/values";
import { stream } from "convex-helpers/server/stream";
import schema from "../schema";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { findItem } from "./mutations";
import { MAX_COLLECTION_MEMBERS } from "../lib/queryBounds";
import { libraryCount } from "./counter";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { LIBRARY_SEARCH_RESULTS_MAX as SEARCH_RESULTS_MAX } from "../../lib/library/limits";
import { libraryFilterFields, libraryPapersValidator, librarySortOrderValidator, librarySortValidator, PAPERS_PAGE, type LibraryView } from "./validators";

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
  /** Only papers with no rating. The library page has no such filter; the assistant is asked for them. */
  unrated?: boolean;
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

  if (args.unrated && item.rating !== undefined) return false;

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
    args.unrated === true ||
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
export async function readLibraryPage(ctx: QueryCtx, userId: Id<"users">, view: LibraryView & { unrated?: boolean }, paginationOpts: PaginationOptions): Promise<LibraryPage> {
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
  handler: async (ctx, args) => countLibraryView(ctx, await requireAuth(ctx), args),
});

/** How many papers a view of someone's library shows, and whether the count stopped short (see getLibraryFilteredCount). */
async function countLibraryView(ctx: QueryCtx, user: Doc<"users">, args: Omit<LibraryView, "sortBy" | "sortOrder"> & { unrated?: boolean }) {
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
}

/** The characters of each text the assistant gets of a saved paper. */
const PAPER_SHOWN = { title: 160, authors: 120, journal: 60 };
const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const SORTS = { saved: "savedAt", rating: "rating", year: "publicationYear", citations: "citedByCount", title: "title" } as const;
const optional = <V extends Parameters<typeof v.union>[number]>(validator: V) => v.optional(v.union(validator, v.null()));

/** What narrows the library, as the assistant gives it. */
const narrowing = {
  search: optional(v.string()),
  collectionId: optional(v.id("collections")),
  rated: optional(v.boolean()),
  minRating: optional(v.number()),
  maxRating: optional(v.number()),
  yearFrom: optional(v.number()),
  yearTo: optional(v.number()),
};
/** The library's own filters from those. A model that fills in every argument sends null or nothing for what it doesn't mean: each reads as left out. */
function viewOf(given: ObjectType<typeof narrowing>) {
  const text = given.search?.trim();
  const view = {
    ...(text ? { searchText: text } : {}),
    ...(given.collectionId ? { collectionId: given.collectionId } : {}),
    ...(given.rated === false ? { unrated: true } : {}),
    // Only rated papers: every rating from 0 up, unless a bound says otherwise.
    ...(given.minRating != null || given.rated === true ? { minRating: given.minRating ?? 0 } : {}),
    ...(given.maxRating != null ? { maxRating: given.maxRating } : {}),
    ...(given.yearFrom != null ? { yearFrom: given.yearFrom } : {}),
    ...(given.yearTo != null ? { yearTo: given.yearTo } : {}),
  };
  if (given.rated === false && (view.minRating !== undefined || view.maxRating !== undefined)) throw createError("VALIDATION_ERROR", "A paper they haven't rated has no rating to filter by: give `rated` false or a rating range, not both.");
  return view;
}

export const papersAction = defineUserQuery({
  path: "library/queries:papers",
  description:
    `Lists the papers saved in the person's library, ${PAPERS_PAGE} a page: each one's title, authors, year, journal, the rating they gave it, the day they saved it, its paper ID and its library item ID. ` +
    "`total` is how many papers the whole library or one collection has; a narrowed list has none, and library/queries:countPapers counts it. " +
    "With nothing else given it lists the whole library, newest saved first. To narrow it: `search` is words to find in titles, abstracts and authors; `collectionId` is one of their collections (from library/collections:listCollections); " +
    "`rated` is true for only the papers they rated and false for only those they haven't; `minRating` and `maxRating` are 0 to 5; `yearFrom` and `yearTo` are years published. " +
    "`sort` is saved, rating, year, citations or title, and `ascending` turns its order round. `cursor` is `next` from the page before.",
  args: {
    ...narrowing,
    sort: optional(v.union(...Object.keys(SORTS).map((name) => v.literal(name as keyof typeof SORTS)))),
    ascending: optional(v.boolean()),
    cursor: optional(v.string()),
  },
  returns: libraryPapersValidator,
  run: async (ctx, userId, given) => {
    const user = await ctx.db.get("users", userId);
    if (!user) throw createError("UNAUTHENTICATED", "Authentication required");
    const view = viewOf(given);
    const read = await readLibraryPage(ctx, userId, { ...view, sortBy: SORTS[given.sort ?? "saved"], sortOrder: given.ascending ? "asc" : "desc" }, { cursor: given.cursor || null, numItems: PAPERS_PAGE });
    // A narrowed view is counted by reading it, which a page of it leaves no room for in one read: its count is its own action.
    const kept = view.searchText === undefined && !hasNonCollectionLibraryFilters(view);
    return {
      ...(kept ? { total: (await countLibraryView(ctx, user, view)).count } : {}),
      papers: read.page.map((item) => ({
        libraryItemId: item._id,
        id: item.openalexId,
        title: short(item.title, PAPER_SHOWN.title),
        ...(item.authors ? { authors: short(item.authors, PAPER_SHOWN.authors) } : {}),
        ...(item.publicationYear == null ? {} : { year: item.publicationYear }),
        ...(item.journal ? { journal: short(item.journal, PAPER_SHOWN.journal) } : {}),
        ...(item.rating === undefined ? {} : { rating: item.rating }),
        savedOn: new Date(item.savedAt).toISOString().slice(0, 10),
      })),
      ...(read.isDone || !read.continueCursor ? {} : { next: read.continueCursor }),
    };
  },
});
export const papers = userQuery(papersAction);
export const papersForAssistant = assistantQuery(papersAction);

export const countPapersAction = defineUserQuery({
  path: "library/queries:countPapers",
  description:
    "Counts the papers in the person's library that a narrowed list has, by the same `search`, `collectionId`, `rated`, `minRating`, `maxRating`, `yearFrom` and `yearTo` as library/queries:papers. " +
    "A count that stopped short of them all comes with `atLeast`.",
  args: narrowing,
  returns: v.object({ count: v.number(), atLeast: v.optional(v.literal(true)) }),
  run: async (ctx, userId, given) => {
    const user = await ctx.db.get("users", userId);
    if (!user) throw createError("UNAUTHENTICATED", "Authentication required");
    const counted = await countLibraryView(ctx, user, viewOf(given));
    return { count: counted.count, ...(counted.capped ? { atLeast: true as const } : {}) };
  },
});
export const countPapers = userQuery(countPapersAction);
export const countPapersForAssistant = assistantQuery(countPapersAction);

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
    const item = await findItem(ctx, userId, args.openalexId);
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
