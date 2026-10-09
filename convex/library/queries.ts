import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { searchTerms } from "../lib/searchText";
import { paginationOptsValidator, paginationResultValidator, type Cursor, type PaginationOptions } from "convex/server";
import { v, type ObjectType } from "convex/values";
import { stream, type QueryStream } from "convex-helpers/server/stream";
import schema from "../schema";
import { createError } from "../lib/errors";
import { findItem } from "./find";
import { collectionRaters, collectionRatingRow, personalRatingRow } from "../ratings";
import type { InWorkspace } from "../workspaces/actor";
import { authorDisplay } from "../../lib/library/paper-metadata";
import { libraryCount } from "./counter";
import { livePlaces } from "./collectionMembership";
import { JoinStream } from "../lib/joinStream";
import { countInRange, type CountedField, type Range } from "./facets";
import { assistantQuery, defineUserQuery, userQuery, workspaceQuery } from "../lib/userActions";
import { LIBRARY_SEARCH_RESULTS_MAX as SEARCH_RESULTS_MAX } from "../../lib/library/limits";
import { libraryFilterFields, libraryPapersValidator, librarySortOrderValidator, librarySortValidator, PAPERS_PAGE, type LibraryView } from "./validators";

/**
 * Rows one page of a filtered view reads at most. A sparse filter gets a short page and a
 * cursor to carry on from; the library page waits for a full page before it shows one (#353).
 */
const FILTERED_PAGE_ROWS = 2_000;
/** Most papers one page returns, whatever the caller asks for. */
const LIBRARY_PAGE_MAX = 500;
/**
 * Rows a count of several filters reads along the narrowest: half of the 32,000 documents a
 * query may scan. Past them it says how many it found, and that there may be more.
 */
const FILTERED_COUNT_ROWS = 16_000;
/** Bytes one filtered page or count reads at most: half a query's 16 MiB. */
const FILTERED_BYTES = 8 * 1024 * 1024;

/** People named beside a paper's ratings in an organization's collection; the rest open from them. */
const RATERS_SHOWN = 3;
const raterValidator = v.object({ name: v.string(), imageUrl: v.optional(v.string()), you: v.boolean(), rating: v.number() });

/**
 * A page of the library view, each paper with `myRating`: the person's own rating of it, where `rating` is its people's average (#655).
 * In an organization's collection, `collection` is how its members rated it there: the person's own, and the first few who did.
 */
export const libraryPageValidator = paginationResultValidator(schema.tables.libraryItems.validator.extend({
  _id: v.id("libraryItems"),
  _creationTime: v.number(),
  myRating: v.optional(v.number()),
  collection: v.optional(v.object({ mine: v.optional(v.number()), raters: v.array(raterValidator), more: v.boolean() })),
}));

type LibraryItem = Doc<"libraryItems">;

const SORT_INDEX_MAP = {
  savedAt: "by_workspace_savedAt",
  rating: "by_workspace_rating",
  publicationYear: "by_workspace_year",
  citedByCount: "by_workspace_citedByCount",
  title: "by_workspace_title",
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

type ManualPaginationOptions = {
  numItems: number;
  cursor: string | null;
};

/** What a filter reads of a paper, or of a membership, which copies it (./facets.ts). */
type Filtered = { rating?: number; savedAt?: number; publicationYear?: number };

function matchesLibraryFilters(item: Filtered, args: SharedLibraryFilterArgs): boolean {
  if (args.unrated && item.rating !== undefined) return false;

  if (args.minRating !== undefined || args.maxRating !== undefined) {
    // A rating filter only matches rated papers.
    if (item.rating === undefined) return false;
    if (args.minRating !== undefined && item.rating < args.minRating) return false;
    if (args.maxRating !== undefined && item.rating > args.maxRating) return false;
  }

  if (args.savedAfter !== undefined && (item.savedAt === undefined || item.savedAt < args.savedAfter)) return false;
  if (args.savedBefore !== undefined && (item.savedAt === undefined || item.savedAt > args.savedBefore)) return false;

  if (args.yearFrom !== undefined && (item.publicationYear == null || item.publicationYear < args.yearFrom)) return false;
  if (args.yearTo !== undefined && (item.publicationYear == null || item.publicationYear > args.yearTo)) return false;

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

/** The same sorts over one collection's memberships. */
const COLLECTION_SORT_INDEX = {
  savedAt: "by_collection_savedAt",
  rating: "by_collection_rating",
  publicationYear: "by_collection_year",
  citedByCount: "by_collection_citedByCount",
  title: "by_collection_title",
} as const;

/** A whole library, or one collection of it. */
type Scope = { workspaceId: Id<"workspaces"> } | { collectionId: Id<"collections"> };

/**
 * A library's papers, or a collection's memberships, in `field`'s index order, narrowed to
 * the filter's range on that field, with every other filter applied as they're read.
 */
function along(ctx: QueryCtx, scope: Scope, field: LibrarySortBy, order: "asc" | "desc", args: SharedLibraryFilterArgs) {
  const [lower, upper] = filterRange(field, args);
  // One builder for every index whose second field is `field`.
  type Range = { eq(f: string, v: unknown): Range; gt(f: string, v: number): Range; gte(f: string, v: number): Range; lte(f: string, v: number): Range };
  const narrow = (range: Range) => {
    if (field === "rating" && args.unrated) return range.eq("rating", undefined);
    // An upper bound alone starts past the unset values, which sort first and never match it.
    const from = lower !== undefined ? range.gte(field, lower) : upper !== undefined ? range.gt(field, null as never) : range;
    return upper === undefined ? from : from.lte(field, upper);
  };
  const rows = "collectionId" in scope
    ? stream(ctx.db, schema).query("libraryItemCollections").withIndex(COLLECTION_SORT_INDEX[field], (q) => narrow(q.eq("collectionId", scope.collectionId) as unknown as Range) as never)
    : stream(ctx.db, schema).query("libraryItems").withIndex(SORT_INDEX_MAP[field], (q) => narrow(q.eq("workspaceId", scope.workspaceId) as unknown as Range) as never);
  return (rows as typeof rows & { order(o: "asc" | "desc"): typeof rows }).order(order).filterWith(async (row: Filtered) => matchesLibraryFilters(row, args));
}

/** The workspace's collection, or null when it's gone or in another. */
async function ownCollection(ctx: QueryCtx, workspaceId: Id<"workspaces">, collectionId: Id<"collections"> | undefined) {
  const collection = collectionId ? await ctx.db.get("collections", collectionId) : null;
  return collection?.workspaceId === workspaceId ? collection : null;
}

/** Which of these papers are in the collection: one point read each. */
async function inThatCollection(ctx: QueryCtx, collectionId: Id<"collections">, items: LibraryItem[]) {
  const kept = await Promise.all(items.map((item) => ctx.db.query("libraryItemCollections").withIndex("by_collection_item", (q) => q.eq("collectionId", collectionId).eq("libraryItemId", item._id)).unique()));
  return items.flatMap((item, at) => (kept[at] ? [inPlace(item, kept[at])] : []));
}

/** A paper as a collection lists it: with the rating it has there, which in an organization is the collection's own (../ratings.ts). */
const inPlace = (item: LibraryItem, place: Doc<"libraryItemCollections">): LibraryItem => ({ ...item, rating: place.rating });

/** The workspace's papers matching a text search, most relevant first. */
async function searchLibraryItems(ctx: QueryCtx, workspaceId: Id<"workspaces">, searchText: string): Promise<LibraryItem[]> {
  return await ctx.db
    .query("libraryItems")
    .withSearchIndex("search_library", (q) => q.search("searchableText", searchTerms(searchText) ?? "").eq("workspaceId", workspaceId))
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
 * One page of a workspace's library view. A search reads its every match, the search engine's
 * limit, and pages them in memory; a browse reads through the sort's index (a collection's
 * own, over its memberships), and a filtered one stops after FILTERED_PAGE_ROWS rows with a
 * cursor to carry on from.
 */
export async function readLibraryPage(ctx: QueryCtx, workspaceId: Id<"workspaces">, view: LibraryView & { unrated?: boolean }, paginationOpts: PaginationOptions): Promise<LibraryPage> {
  const collection = await ownCollection(ctx, workspaceId, view.collectionId);
  if (view.collectionId && !collection) return emptyPage;

  if (view.searchText !== undefined) {
    const searchText = view.searchText.trim();
    if (!searchText) return emptyPage;
    const found = await searchLibraryItems(ctx, workspaceId, searchText);
    const items = (collection ? await inThatCollection(ctx, collection._id, found) : found).filter((item) => matchesLibraryFilters(item, view));
    return paginateLibraryItems(
      sortLibraryItems(items, view.sortBy, view.sortOrder),
      // Every match is read anyway, so a caller may take them all in one page.
      { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, SEARCH_RESULTS_MAX) },
    );
  }

  const page = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, LIBRARY_PAGE_MAX) };
  if (collection) {
    // Each membership joined to its paper, whose bytes count toward the page's.
    const memberships = along(ctx, { collectionId: collection._id }, view.sortBy, view.sortOrder, view) as unknown as QueryStream<Doc<"libraryItemCollections">>;
    return (await new JoinStream(memberships, async (membership) => {
      const item = await ctx.db.get("libraryItems", membership.libraryItemId);
      return item && inPlace(item, membership);
    })
      .paginate({ ...page, maximumRowsRead: FILTERED_PAGE_ROWS, maximumBytesRead: FILTERED_BYTES })) as LibraryPage;
  }
  if (!hasNonCollectionLibraryFilters(view)) {
    return await ctx.db
      .query("libraryItems")
      .withIndex(SORT_INDEX_MAP[view.sortBy], (q) => q.eq("workspaceId", workspaceId))
      .order(view.sortOrder)
      .paginate(page);
  }
  return (await along(ctx, { workspaceId }, view.sortBy, view.sortOrder, view)
    .paginate({ ...page, maximumRowsRead: FILTERED_PAGE_ROWS, maximumBytesRead: FILTERED_BYTES })) as LibraryPage;
}

/**
 * Gives each paper on a page the person's own rating of it, which in their own workspace is the
 * paper's, and in an organization's collection how its members rated it there.
 */
async function withOwnRatings(ctx: QueryCtx, { userId, workspaceId }: InWorkspace, read: LibraryPage, collectionId?: Id<"collections">) {
  const own = (await ctx.db.get("workspaces", workspaceId))?.kind === "personal";
  const ratings = await Promise.all(read.page.map(async (item) => (own ? item.rating : (await personalRatingRow(ctx, userId, item.openalexId))?.rating)));
  const inCollection = !own && collectionId ? await Promise.all(read.page.map(async (item) => {
    const { raters, more } = await collectionRaters(ctx, collectionId, item.openalexId, userId, RATERS_SHOWN);
    const mine = (await collectionRatingRow(ctx, userId, collectionId, item.openalexId))?.rating;
    return { ...(mine === undefined ? {} : { mine }), raters: raters.map(({ userId: _id, ...rater }) => rater), more };
  })) : null;
  return { ...read, page: read.page.map((item, at) => ({ ...item, ...(ratings[at] === undefined ? {} : { myRating: ratings[at] }), ...(inCollection ? { collection: inCollection[at] } : {}) })) };
}

export const browseLibrary = workspaceQuery({
  args: {
    sortBy: librarySortValidator,
    sortOrder: librarySortOrderValidator,
    ...libraryFilterFields,
    paginationOpts: paginationOptsValidator,
  },
  returns: libraryPageValidator,
  handler: async (ctx, actor, { paginationOpts, ...view }) => withOwnRatings(ctx, actor, await readLibraryPage(ctx, actor.workspaceId, view, paginationOpts), view.collectionId),
});

export const searchLibrary = workspaceQuery({
  args: {
    searchText: v.string(),
    sortBy: v.optional(librarySortValidator),
    sortOrder: v.optional(librarySortOrderValidator),
    ...libraryFilterFields,
    paginationOpts: paginationOptsValidator,
  },
  returns: libraryPageValidator,
  handler: async (ctx, actor, { paginationOpts, sortBy = "savedAt", sortOrder = "desc", ...view }) => withOwnRatings(ctx, actor, await readLibraryPage(ctx, actor.workspaceId, { ...view, sortBy, sortOrder }, paginationOpts), view.collectionId),
});

/**
 * How many papers a view shows, exact from counters for the whole library, a collection, or
 * either filtered by one field (./facets.ts). A text search counts its matches, at most the
 * search engine's limit, and several filters are counted by reading along the narrowest;
 * `capped` says when either stopped short (#353).
 */
export const getLibraryFilteredCount = workspaceQuery({
  args: {
    sortBy: librarySortValidator,
    sortOrder: librarySortOrderValidator,
    ...libraryFilterFields,
    searchText: v.optional(v.string()),
  },
  returns: v.object({ count: v.number(), capped: v.boolean() }),
  handler: (ctx, { workspaceId }, args) => countLibraryView(ctx, workspaceId, args),
});

/** Each filter on a counted field: its range, or null for unrated papers. */
function filtersOf(args: SharedLibraryFilterArgs): { field: CountedField; range: Range | null }[] {
  const range = (lower: number | undefined, upper: number | undefined) => (lower === undefined && upper === undefined ? [] : [{ lower, upper }]);
  return [
    ...(args.unrated ? [{ field: "rating" as const, range: null }] : range(args.minRating, args.maxRating).map((r) => ({ field: "rating" as const, range: r }))),
    ...range(args.yearFrom, args.yearTo).map((r) => ({ field: "publicationYear" as const, range: r })),
    ...range(args.savedAfter, args.savedBefore).map((r) => ({ field: "savedAt" as const, range: r })),
  ];
}

/** How many papers a view of someone's library shows, and whether the count stopped short (see getLibraryFilteredCount). */
async function countLibraryView(ctx: QueryCtx, workspaceId: Id<"workspaces">, args: Omit<LibraryView, "sortBy" | "sortOrder"> & { unrated?: boolean }) {
  const collection = await ownCollection(ctx, workspaceId, args.collectionId);
  if (args.collectionId && !collection) return { count: 0, capped: false };

  const searchText = args.searchText?.trim();
  if (searchText) {
    const found = await searchLibraryItems(ctx, workspaceId, searchText);
    const count = (collection ? await inThatCollection(ctx, collection._id, found) : found).filter((item) => matchesLibraryFilters(item, args)).length;
    return { count, capped: found.length === SEARCH_RESULTS_MAX };
  }

  const filters = filtersOf(args);
  if (filters.length === 0) return { count: collection ? collection.itemCount : await libraryCount(ctx, workspaceId), capped: false };
  const scope: Scope = collection ? { collectionId: collection._id } : { workspaceId };
  const counts = await Promise.all(filters.map(({ field, range }) => countInRange(ctx, collection?._id ?? workspaceId, field, range)));
  if (filters.length === 1) return { count: counts[0], capped: false };
  // Several filters: read the papers the narrowest one matches, applying the rest, to the end
  // or the read budget. The counts only choose the index; they may be a moment behind.
  const narrowest = filters[counts.indexOf(Math.min(...counts))].field;
  const counted = await along(ctx, scope, narrowest, "asc", args)
    .paginate({ cursor: null, numItems: FILTERED_COUNT_ROWS, maximumRowsRead: FILTERED_COUNT_ROWS, maximumBytesRead: FILTERED_BYTES });
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
  if (given.rated === false && (view.minRating !== undefined || view.maxRating !== undefined)) throw createError("VALIDATION_ERROR", "A paper without a rating has none to filter by: give `rated` false or a rating range, not both.");
  return view;
}

/** Whether each of these saved papers is in a collection that still exists. */
async function inCollection(ctx: QueryCtx, libraryItemIds: Id<"libraryItems">[]) {
  return await Promise.all(libraryItemIds.map(async (libraryItemId) => (await livePlaces(ctx, libraryItemId).first()) !== null));
}

export const papersAction = defineUserQuery({
  path: "library/queries:papers",
  description:
    `Lists the papers saved in the person's library, ${PAPERS_PAGE} a page: each one's title, authors, year, journal, its rating (in their own library theirs, in an organization's its members' average), whether it's in any of their collections, the day they saved it, its paper ID and its library item ID. ` +
    "`total` is how many papers the whole library or one collection has; a narrowed list has none, and library/queries:countPapers counts it. " +
    "With nothing else given it lists the whole library, newest saved first. To narrow it: `search` is words to find in titles, abstracts and authors; `collectionId` is one of their collections (from library/collections:listCollections); " +
    "`rated` is true for only the papers with a rating and false for only those without; `minRating` and `maxRating` are 0 to 5. Both go by the rating listed, which in an organization's library is its members' average. `yearFrom` and `yearTo` are years published. " +
    "`sort` is saved, rating, year, citations or title, and `ascending` turns its order round. `cursor` is `next` from the page before.",
  args: {
    ...narrowing,
    sort: optional(v.union(...Object.keys(SORTS).map((name) => v.literal(name as keyof typeof SORTS)))),
    ascending: optional(v.boolean()),
    cursor: optional(v.string()),
  },
  returns: libraryPapersValidator,
  run: async (ctx, { userId, workspaceId }, given) => {
    const user = await ctx.db.get("users", userId);
    if (!user) throw createError("UNAUTHENTICATED", "Authentication required");
    const view = viewOf(given);
    const read = await readLibraryPage(ctx, workspaceId, { ...view, sortBy: SORTS[given.sort ?? "saved"], sortOrder: given.ascending ? "asc" : "desc" }, { cursor: given.cursor || null, numItems: PAPERS_PAGE });
    // A narrowed view is counted by reading it, which a page of it leaves no room for in one read: its count is its own action.
    const kept = view.searchText === undefined && !hasNonCollectionLibraryFilters(view);
    // Asked paper by paper, finding the ones in no collection took a library of sixty a hundred reads.
    const collected = await inCollection(ctx, read.page.map((item) => item._id));
    return {
      ...(kept ? { total: (await countLibraryView(ctx, workspaceId, view)).count } : {}),
      papers: read.page.map((item, at) => ({
        libraryItemId: item._id,
        id: item.openalexId,
        title: short(item.title, PAPER_SHOWN.title),
        ...(authorDisplay(item) ? { authors: short(authorDisplay(item), PAPER_SHOWN.authors) } : {}),
        ...(item.publicationYear == null ? {} : { year: item.publicationYear }),
        ...(item.journal ? { journal: short(item.journal, PAPER_SHOWN.journal) } : {}),
        ...(item.rating === undefined ? {} : { rating: item.rating }),
        inCollection: collected[at],
        savedOn: new Date(item.savedAt).toISOString().slice(0, 10),
        ...(item.pdfUrl ? { pdf: true as const } : {}),
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
  run: async (ctx, { userId, workspaceId }, given) => {
    const user = await ctx.db.get("users", userId);
    if (!user) throw createError("UNAUTHENTICATED", "Authentication required");
    const counted = await countLibraryView(ctx, workspaceId, viewOf(given));
    return { count: counted.count, ...(counted.capped ? { atLeast: true as const } : {}) };
  },
});
export const countPapers = userQuery(countPapersAction);
export const countPapersForAssistant = assistantQuery(countPapersAction);

export const getLibraryCount = workspaceQuery({
  args: {},
  returns: v.number(),
  handler: (ctx, { workspaceId }) => libraryCount(ctx, workspaceId),
});

export const savedPaperAction = defineUserQuery({
  path: "library/queries:savedPaper",
  description: "Whether a paper is in the person's library, and whether it's in any of their collections.",
  args: { openalexId: v.string() },
  returns: v.union(v.object({ libraryItemId: v.id("libraryItems"), inCollection: v.boolean() }), v.null()),
  run: async (ctx, { workspaceId }, args) => {
    const item = await findItem(ctx, workspaceId, args.openalexId);
    if (!item) return null;
    return { libraryItemId: item._id, inCollection: (await inCollection(ctx, [item._id]))[0] };
  },
});
export const savedPaper = userQuery(savedPaperAction);
export const savedPaperForAssistant = assistantQuery(savedPaperAction);
