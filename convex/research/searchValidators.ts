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
const yearValidator = v.optional(v.union(v.number(), v.null()));

/** A search's settings, as the assistant gives them. Left out, a setting stays as it is; null takes a year or a minimum off. */
export const searchSettings = {
  /** Where the query's words are looked for. */
  field: v.optional(fieldValidator),
  fromYear: yearValidator,
  toYear: yearValidator,
  openAccessOnly: v.optional(v.boolean()),
  withAbstractOnly: v.optional(v.boolean()),
  reviewsOnly: v.optional(v.boolean()),
  minCitations: v.optional(v.union(v.number(), v.null())),
  sort: v.optional(sortValidator),
};

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
