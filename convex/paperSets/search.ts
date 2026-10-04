/**
 * A saved search's papers for Screen all, read on the server (#341). The request is the one
 * its results page makes (`paramsToBucketSearchFilters`): the same keyword expansion,
 * filters and sort, read through ./openalex.ts; the rating filter is the results page's too.
 */
import { v, type Infer } from "convex/values";
import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import { internalMutation, internalQuery, type ActionCtx, type QueryCtx } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { spendOpenAlexRequests } from "../lib/rateLimit";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { screeningPaperInputValidator } from "../screening/validators";
import { currentSearch, restoreSearch, type SavedSearch } from "../../lib/research/records";
import { DEFAULT_SEARCH_PARAMS } from "../../lib/search-params/parsers";
import { searchResultToParams } from "../../lib/search-params/converters";
import { paramsToBucketSearchFilters } from "../../lib/chat/params-to-bucket-filters";
import { isRatingFilterActive } from "../../lib/utils";
import { expandShortcuts, shortcutNames } from "../../lib/query-shortcuts";
import { ratingsAmong, shortcutExpansions } from "../research/records";
import { readSearchWorks, searchRequestValidator, type SearchSnapshot } from "./openalex";

/** The fields a screening paper keeps. */
export const SCREENING_FIELDS = "id,display_name,title,doi,publication_year,abstract_inverted_index,authorships,cited_by_count,primary_location";
/** The fields the assistant reads of a paper: those, and what kind of work it is and whether it's free to read. */
export const ASSISTANT_FIELDS = `${SCREENING_FIELDS},type,open_access,language`;

export type SearchPaper = Infer<typeof screeningPaperInputValidator>;

export const savedSearchValidator = v.object({
  clerkId: v.string(),
  request: v.union(searchRequestValidator, v.null()),
  ratingRange: v.union(v.array(v.number()), v.null()),
  /** The revision the search was at when this was read. */
  revision: v.number(),
});
export type SavedSearchRequest = Infer<typeof savedSearchValidator>;

/** The request a search's results page makes for it, and its rating filter: a saved search's, or one that's only being tried. */
export async function requestOf(ctx: QueryCtx, userId: Id<"users">, saved: SavedSearch, revision: number): Promise<SavedSearchRequest> {
  const user = await ctx.db.get("users", userId);
  if (!user) throw createError("UNAUTHENTICATED", "Authentication required");
  const params = { ...DEFAULT_SEARCH_PARAMS, ...searchResultToParams(restoreSearch({ ...saved, screeningResponses: [] })), q: saved.query };
  // The account's shortcuts this query uses, as the results page expands them.
  const expansions = await shortcutExpansions(ctx, userId, shortcutNames(saved.query));
  const request = paramsToBucketSearchFilters(params, { expand: (query) => expandShortcuts(query, expansions) })?.openAlexQuery ?? null;
  const ratingRange: [number, number] = [params.rmin, params.rmax];
  return { clerkId: user.clerkId, request, ratingRange: isRatingFilterActive(ratingRange, params.rated) ? ratingRange : null, revision };
}

/** The request a saved search's results page makes, and its rating filter. */
export const readSearch = internalQuery({
  args: { userId: v.id("users"), searchId: v.string() },
  returns: savedSearchValidator,
  handler: async (ctx, { userId, searchId }) => {
    const row = await ctx.db.query("searches").withIndex("by_user_and_localId", (q) => q.eq("userId", userId).eq("localId", searchId)).unique();
    if (!row) throw createError("NOT_FOUND", "Search not found");
    return await requestOf(ctx, userId, currentSearch(row.data), row.revision);
  },
});

/** The person's ratings of these papers. */
export const ratingsOf = internalQuery({
  args: { userId: v.id("users"), paperIds: v.array(v.string()) },
  returns: v.array(v.object({ paperId: v.string(), rating: v.number() })),
  handler: async (ctx, { userId, paperIds }) => {
    if (paperIds.length > MAX_SCREENING_PAPERS_PER_JOB) throw new Error(`Rated papers are read ${MAX_SCREENING_PAPERS_PER_JOB} at a time`);
    return await ratingsAmong(ctx, userId, paperIds);
  },
});

/** Counts requests against the account's OpenAlex allowance, the one its searches spend too. */
export const spendRequests = internalMutation({
  args: { clerkId: v.string(), count: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { clerkId, count }) => spendOpenAlexRequests(ctx, clerkId, count),
});

export type Work = {
  id: string;
  display_name?: string | null;
  title?: string | null;
  doi?: string | null;
  publication_year?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: Array<{ author?: { id?: string | null; display_name?: string | null } | null; institutions?: Array<{ display_name?: string | null; country_code?: string | null }> | null }> | null;
  cited_by_count?: number | null;
  primary_location?: { source?: { display_name?: string | null } | null } | null;
  type?: string | null;
  language?: string | null;
  open_access?: { is_oa?: boolean | null; oa_url?: string | null } | null;
};

export function toPaper(work: Work): SearchPaper {
  const authors = (work.authorships ?? []).flatMap((a) => (a.author?.display_name ? [a.author.display_name] : []));
  return {
    openalexId: work.id,
    title: work.title ?? work.display_name ?? "",
    ...(work.abstract_inverted_index ? { abstract: convertAbstractArrayToString(work.abstract_inverted_index) } : {}),
    ...(authors.length ? { authors } : {}),
    ...(typeof work.publication_year === "number" ? { publicationYear: work.publication_year } : {}),
    ...(work.doi ? { doi: work.doi } : {}),
    ...(work.primary_location?.source?.display_name ? { venue: work.primary_location.source.display_name } : {}),
    ...(typeof work.cited_by_count === "number" ? { citedByCount: work.cited_by_count } : {}),
  };
}

/** Refuses a range that isn't papers `first` to `last` from 1 up, or holds more than one job screens. */
export function checkRange(first: number, last: number) {
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first) {
    throw createError("VALIDATION_ERROR", "Pick papers from 1 up, with the first before the last");
  }
  if (last - first + 1 > MAX_SCREENING_PAPERS_PER_JOB) {
    throw createError("VALIDATION_ERROR", `Cannot screen more than ${MAX_SCREENING_PAPERS_PER_JOB} papers per job`);
  }
}

/**
 * Papers `first` to `last` (counting from 1) of the person's saved search, in its results
 * page's order, kept to its rating filter. Spends one OpenAlex request per page read.
 * `ended`: the search has no results past these. Given `snapshot`, the papers of the search
 * as it was then, whatever has been edited since: a request's later jobs read the same
 * search its first job did.
 */
export async function searchPapers(
  ctx: ActionCtx,
  userId: Id<"users">,
  { searchId, first, last }: { searchId: string; first: number; last: number },
  snapshot?: SearchSnapshot,
): Promise<{ papers: SearchPaper[]; ended: boolean; snapshot: SearchSnapshot }> {
  checkRange(first, last);
  // Typed here: the generated API's types depend on this module, so inference would loop.
  const found: SavedSearchRequest = await ctx.runQuery(internal.paperSets.search.readSearch, { userId, searchId });
  const request = snapshot ? snapshot.request : found.request;
  if (!request) throw createError("VALIDATION_ERROR", "This search's query isn't valid. Fix it on the results page first.");
  const rating = snapshot ? snapshot.rating : found.ratingRange ? { min: found.ratingRange[0], max: found.ratingRange[1] } : undefined;
  const taken: SearchSnapshot = { request, ...(rating ? { rating } : {}) };

  const works = await readSearchWorks<Work>(request, { first, last, select: SCREENING_FIELDS }, (count) =>
    ctx.runMutation(internal.paperSets.search.spendRequests, { clerkId: found.clerkId, count }),
  );
  return { papers: await keptByRating(ctx, userId, works.map(toPaper), rating), ended: works.length < last - first + 1, snapshot: taken };
}

/** The papers a search's rating filter keeps, as its results page does: those the person rated within it. Every paper, when it has none. */
export async function keptByRating(ctx: ActionCtx, userId: Id<"users">, papers: SearchPaper[], rating: { min: number; max: number } | undefined): Promise<SearchPaper[]> {
  if (!rating || !papers.length) return papers;
  const rated: Array<{ paperId: string; rating: number }> = await ctx.runQuery(internal.paperSets.search.ratingsOf, { userId, paperIds: papers.map((paper) => paper.openalexId) });
  const ratings = new Map(rated.map((row) => [row.paperId, row.rating]));
  return papers.filter((paper) => {
    const value = ratings.get(paper.openalexId);
    return value !== undefined && value >= rating.min && value <= rating.max;
  });
}
