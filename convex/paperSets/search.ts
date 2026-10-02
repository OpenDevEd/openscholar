/**
 * A saved search's papers, read on the server (#341). The request is the one its results
 * page makes (`paramsToBucketSearchFilters`): the same keyword expansion, filters and sort.
 * Only the fields a job keeps are asked for, and the pages are read in parallel, which
 * OpenAlex allows up to 10,000 results; the rating filter is the results page's too.
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
import { openAlexUrl } from "../../lib/openalex/request-url";
import { expandShortcuts, shortcutNames } from "../../lib/query-shortcuts";
import { OpenAlexLimitedError } from "../../lib/openalex/limited";

/** OpenAlex's largest page. */
const PAGE_SIZE = 200;
/** The fields a screening paper keeps. */
const SCREENING_FIELDS = "id,display_name,title,doi,publication_year,abstract_inverted_index,authorships";

export type SearchPaper = Infer<typeof screeningPaperInputValidator>;

const requestValidator = v.object({
  search: v.optional(v.string()),
  filter: v.optional(v.string()),
  oql: v.optional(v.string()),
  sort: v.string(),
});

const searchRequestValidator = v.object({
  clerkId: v.string(),
  request: v.union(requestValidator, v.null()),
  ratingRange: v.union(v.array(v.number()), v.null()),
});
type SearchRequest = Infer<typeof searchRequestValidator>;

/** The request a saved search's results page makes, and its rating filter. */
export const readSearch = internalQuery({
  args: { userId: v.id("users"), searchId: v.string() },
  returns: searchRequestValidator,
  handler: async (ctx, { userId, searchId }) => {
    const user = await ctx.db.get("users", userId);
    if (!user) throw createError("UNAUTHENTICATED", "Authentication required");
    const row = await ctx.db.query("searches").withIndex("by_user_and_localId", (q) => q.eq("userId", userId).eq("localId", searchId)).unique();
    if (!row) throw createError("NOT_FOUND", "Search not found");
    const saved = currentSearch(row.data);
    const params = { ...DEFAULT_SEARCH_PARAMS, ...searchResultToParams(restoreSearch({ ...saved, screeningResponses: [] })), q: saved.query };
    // The account's shortcuts this query uses, as the results page expands them.
    const shortcuts = await Promise.all(
      shortcutNames(saved.query).map((name) =>
        ctx.db.query("queryShortcuts").withIndex("by_user_and_shorthand", (q) => q.eq("userId", userId).eq("data.shorthand", name)).first(),
      ),
    );
    const expansions = Object.fromEntries(shortcuts.flatMap((row) => (row ? [[row.data.shorthand, row.data.expansion]] : [])));
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
    const rows = await Promise.all(
      paperIds.map((paperId) => ctx.db.query("paperRatings").withIndex("by_user_and_paperId", (q) => q.eq("userId", userId).eq("data.paperId", paperId)).first()),
    );
    return rows.flatMap((row) => (row ? [row.data] : []));
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

/** One numbered page of the search. An OQL search goes in a POST body: it outgrows the URL limit. */
async function readPage(request: Infer<typeof requestValidator>, page: number): Promise<Work[]> {
  const parameters = { "per-page": String(PAGE_SIZE), page: String(page), sort: request.sort, select: SCREENING_FIELDS };
  const url = request.oql
    ? openAlexUrl("", parameters)
    : openAlexUrl("works", { ...parameters, search: request.search, filter: request.filter });
  const response = await fetch(url, request.oql
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oql: request.oql }) }
    : {});
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    console.error(`[paperSets] OpenAlex page ${page} failed: ${response.status} ${detail}`);
    throw createError("VALIDATION_ERROR", `OpenAlex couldn't return these papers (${response.status}). Try again in a moment.`);
  }
  const body = (await response.json()) as { results?: Work[] };
  return body.results ?? [];
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
  const found: SearchRequest = await ctx.runQuery(internal.paperSets.search.readSearch, { userId, searchId });
  const { clerkId, request, ratingRange } = found;
  if (!request) throw createError("VALIDATION_ERROR", "This search's query isn't valid. Fix it on the results page first.");

  const firstPage = Math.floor((first - 1) / PAGE_SIZE) + 1;
  const pages = Array.from({ length: Math.ceil(last / PAGE_SIZE) - firstPage + 1 }, (_, i) => firstPage + i);
  const allowed: boolean = await ctx.runMutation(internal.paperSets.search.spendRequests, { clerkId, count: pages.length });
  if (!allowed) {
    throw createError("VALIDATION_ERROR", new OpenAlexLimitedError().message);
  }
  const read = await Promise.all(pages.map((page) => readPage(request, page)));
  const offset = (firstPage - 1) * PAGE_SIZE;
  const papers = read.flat().slice(first - 1 - offset, last - offset).map(toPaper);
  if (!ratingRange) return papers;

  const rated: Array<{ paperId: string; rating: number }> = await ctx.runQuery(internal.paperSets.search.ratingsOf, { userId, paperIds: papers.map((paper) => paper.openalexId) });
  const ratings = new Map(rated.map(({ paperId, rating }) => [paperId, rating]));
  return papers.filter((paper) => {
    const rating = ratings.get(paper.openalexId);
    return rating !== undefined && rating >= ratingRange[0] && rating <= ratingRange[1];
  });
}
