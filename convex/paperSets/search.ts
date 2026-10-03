/**
 * A saved search's papers for Screen all, read on the server (#341). The request is the one
 * its results page makes (`paramsToBucketSearchFilters`): the same keyword expansion,
 * filters and sort, read through ./openalex.ts; the rating filter is the results page's too.
 */
import { v, type Infer } from "convex/values";
import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import { internalMutation, internalQuery, type ActionCtx } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { spendOpenAlexRequests } from "../lib/rateLimit";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { screeningPaperInputValidator } from "../screening/validators";
import { currentSearch, restoreSearch } from "../../lib/research/records";
import { DEFAULT_SEARCH_PARAMS } from "../../lib/search-params/parsers";
import { searchResultToParams } from "../../lib/search-params/converters";
import { paramsToBucketSearchFilters } from "../../lib/chat/params-to-bucket-filters";
import { isRatingFilterActive } from "../../lib/utils";
import { expandShortcuts, shortcutNames } from "../../lib/query-shortcuts";
import { ratingsAmong, shortcutExpansions } from "../research/records";
import { readSearchWorks, searchRequestValidator } from "./openalex";

/** The fields a screening paper keeps. */
const SCREENING_FIELDS = "id,display_name,title,doi,publication_year,abstract_inverted_index,authorships";

export type SearchPaper = Infer<typeof screeningPaperInputValidator>;

const savedSearchValidator = v.object({
  clerkId: v.string(),
  request: v.union(searchRequestValidator, v.null()),
  ratingRange: v.union(v.array(v.number()), v.null()),
});
type SavedSearchRequest = Infer<typeof savedSearchValidator>;

/** The request a saved search's results page makes, and its rating filter. */
export const readSearch = internalQuery({
  args: { userId: v.id("users"), searchId: v.string() },
  returns: savedSearchValidator,
  handler: async (ctx, { userId, searchId }) => {
    const user = await ctx.db.get("users", userId);
    if (!user) throw createError("UNAUTHENTICATED", "Authentication required");
    const row = await ctx.db.query("searches").withIndex("by_user_and_localId", (q) => q.eq("userId", userId).eq("localId", searchId)).unique();
    if (!row) throw createError("NOT_FOUND", "Search not found");
    const saved = currentSearch(row.data);
    const params = { ...DEFAULT_SEARCH_PARAMS, ...searchResultToParams(restoreSearch({ ...saved, screeningResponses: [] })), q: saved.query };
    // The account's shortcuts this query uses, as the results page expands them.
    const expansions = await shortcutExpansions(ctx, userId, shortcutNames(saved.query));
    const request = paramsToBucketSearchFilters(params, { expand: (query) => expandShortcuts(query, expansions) })?.openAlexQuery ?? null;
    const ratingRange: [number, number] = [params.rmin, params.rmax];
    return { clerkId: user.clerkId, request, ratingRange: isRatingFilterActive(ratingRange, params.rated) ? ratingRange : null };
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

type Work = {
  id: string;
  display_name?: string | null;
  title?: string | null;
  doi?: string | null;
  publication_year?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: Array<{ author?: { display_name?: string | null } | null }> | null;
};

function toPaper(work: Work): SearchPaper {
  const authors = (work.authorships ?? []).flatMap((a) => (a.author?.display_name ? [a.author.display_name] : []));
  return {
    openalexId: work.id,
    title: work.title ?? work.display_name ?? "",
    ...(work.abstract_inverted_index ? { abstract: convertAbstractArrayToString(work.abstract_inverted_index) } : {}),
    ...(authors.length ? { authors } : {}),
    ...(typeof work.publication_year === "number" ? { publicationYear: work.publication_year } : {}),
    ...(work.doi ? { doi: work.doi } : {}),
  };
}

/**
 * Papers `first` to `last` (counting from 1) of the person's saved search, in its results
 * page's order, kept to its rating filter. Spends one OpenAlex request per page read.
 */
export async function searchPapers(
  ctx: ActionCtx,
  userId: Id<"users">,
  { searchId, first, last }: { searchId: string; first: number; last: number },
): Promise<SearchPaper[]> {
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first) {
    throw createError("VALIDATION_ERROR", "Pick papers from 1 up, with the first before the last");
  }
  if (last - first + 1 > MAX_SCREENING_PAPERS_PER_JOB) {
    throw createError("VALIDATION_ERROR", `Cannot screen more than ${MAX_SCREENING_PAPERS_PER_JOB} papers per job`);
  }
  // Typed here: the generated API's types depend on this module, so inference would loop.
  const found: SavedSearchRequest = await ctx.runQuery(internal.paperSets.search.readSearch, { userId, searchId });
  const { clerkId, request, ratingRange } = found;
  if (!request) throw createError("VALIDATION_ERROR", "This search's query isn't valid. Fix it on the results page first.");

  const works = await readSearchWorks<Work>(request, { first, last, select: SCREENING_FIELDS }, (count) =>
    ctx.runMutation(internal.paperSets.search.spendRequests, { clerkId, count }),
  );
  const papers = works.map(toPaper);
  if (!ratingRange) return papers;

  const rated: Array<{ paperId: string; rating: number }> = await ctx.runQuery(internal.paperSets.search.ratingsOf, { userId, paperIds: papers.map((paper) => paper.openalexId) });
  const ratings = new Map(rated.map(({ paperId, rating }) => [paperId, rating]));
  return papers.filter((paper) => {
    const rating = ratings.get(paper.openalexId);
    return rating !== undefined && rating >= ratingRange[0] && rating <= ratingRange[1];
  });
}
