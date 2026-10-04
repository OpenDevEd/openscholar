/**
 * What the assistant's search tools take and return (./searches.ts): a search as plain
 * settings, and a page of its results. Apart from the saved search's own fields, so a
 * tool's definition stays short (#326).
 */
import { v } from "convex/values";
import { capped } from "../lib/listCaps";

/** Papers one page of results holds. */
export const RESULTS_PAGE = 10;
/** The last page that can be read: OpenAlex lists a search's first 10,000 works by page number. */
export const LAST_PAGE = 10_000 / RESULTS_PAGE;
/**
 * The last page under a sort that is read from the start (convex/paperSets/openalex.ts):
 * its first 2,000 works, which is ten requests of the person's allowance.
 */
export const LAST_PAGE_FROM_START = 2_000 / RESULTS_PAGE;

const fieldValidator = v.union(v.literal("title_and_abstract"), v.literal("title"), v.literal("abstract"), v.literal("fulltext"));
const sortValidator = v.union(v.literal("relevance"), v.literal("most_cited"), v.literal("newest"), v.literal("oldest"));
const numberValidator = v.optional(v.union(v.number(), v.null()));
const dayValidator = v.optional(v.union(v.string(), v.null()));
const listValidator = v.optional(v.union(v.array(v.string()), v.null()));

/**
 * A search's settings, as the assistant gives them: the filters its page has that take
 * plain values. Left out, a setting stays as it is; null takes it off. What they mean is
 * said once, in SETTINGS, for the tools that take them.
 */
export const searchSettings = {
  /** Where the query's words are looked for. */
  field: v.optional(fieldValidator),
  fromYear: numberValidator,
  toYear: numberValidator,
  fromDate: dayValidator,
  toDate: dayValidator,
  authorsIn: listValidator,
  about: listValidator,
  types: listValidator,
  languages: listValidator,
  institutionTypes: listValidator,
  sdgs: v.optional(v.union(v.array(v.number()), v.null())),
  openAccessOnly: v.optional(v.boolean()),
  withAbstractOnly: v.optional(v.boolean()),
  reviewsOnly: v.optional(v.boolean()),
  includeRetracted: v.optional(v.boolean()),
  minCitations: numberValidator,
  ratedOnly: v.optional(v.boolean()),
  minRating: numberValidator,
  maxRating: numberValidator,
  sort: v.optional(sortValidator),
};

/** What the settings mean, for the description of each tool that takes them. A value one doesn't take is refused with the ones it does. */
export const SETTINGS =
  "The time span is whole years (`fromYear`, `toYear`) or exact days (`fromDate`, `toDate`, as YYYY-MM-DD), not both. " +
  "`authorsIn` is where the authors' institutions are and `about` is where the paper is about: each a list of two-letter country codes or regions, such as africa, western_africa, southern_asia or europe. " +
  "`types` and `institutionTypes` are OpenAlex's, such as article, preprint, book-chapter, and education, government. `languages` are ISO 639 codes. `sdgs` are goal numbers, 1 to 17. " +
  "`ratedOnly`, `minRating` and `maxRating` (0 to 5) keep papers by the person's own ratings.";

const paperValidator = v.object({
  id: v.string(),
  title: v.string(),
  authors: v.optional(v.string()),
  year: v.optional(v.number()),
  venue: v.optional(v.string()),
  citations: v.optional(v.number()),
  /** The start of its abstract. */
  abstract: v.optional(v.string()),
});

export const resultsValidator = v.object({
  /** How many results the search has in all. */
  total: v.number(),
  page: v.number(),
  pages: v.number(),
  papers: capped(v.array(paperValidator), RESULTS_PAGE),
});
