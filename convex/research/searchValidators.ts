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
/** A day or a paper's ID, or null to take it off. */
const textValidator = v.optional(v.union(v.string(), v.null()));
const listValidator = v.optional(v.union(v.array(v.string()), v.null()));
/** A page of results to read; left out or null, the first. */
export const pageValidator = v.optional(v.union(v.number(), v.null()));

/**
 * A search's settings, as the assistant gives them: the filters its page has that take
 * plain values. null takes a setting off. What they mean is said once, in SETTINGS, for the
 * tools that take them.
 */
export const searchSettings = {
  /** Where the query's words are looked for. */
  field: v.optional(fieldValidator),
  fromYear: numberValidator,
  toYear: numberValidator,
  fromDate: textValidator,
  toDate: textValidator,
  authorsIn: listValidator,
  about: listValidator,
  types: listValidator,
  languages: listValidator,
  institutionTypes: listValidator,
  sdgs: v.optional(v.union(v.array(v.number()), v.null())),
  authors: listValidator,
  funders: listValidator,
  researchAreas: listValidator,
  citationsOf: textValidator,
  referencesOf: textValidator,
  relatedTo: textValidator,
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

/**
 * A change to a saved search, as its edit takes them: one setting by name, with its new
 * value. A list of these, and not the settings side by side, because a model that fills in
 * every argument it's offered then names only what it means to change. Side by side, such a
 * model sent null for each setting it wasn't asked about, which took every filter off.
 */
export const changesValidator = v.array(
  v.object({
    setting: v.union(v.literal("query"), ...Object.keys(searchSettings).map((name) => v.literal(name as keyof typeof searchSettings))),
    value: v.union(v.string(), v.number(), v.boolean(), v.null(), v.array(v.union(v.string(), v.number()))),
  }),
);

/** What the settings mean, for the description of each tool that takes them. A value one doesn't take is refused with the ones it does. */
export const SETTINGS =
  "The time span is whole years (`fromYear`, `toYear`) or exact days (`fromDate`, `toDate`, as YYYY-MM-DD), not both. " +
  "`authorsIn` is where the authors' institutions are and `about` is where the paper is about: each a list of two-letter country codes or regions, such as africa, sub_saharan_africa, western_africa, southern_asia, latin_america or europe. " +
  "`types` and `institutionTypes` are OpenAlex's, such as article, preprint, book-chapter, and education, government. `languages` are ISO 639 codes. `sdgs` are goal numbers, 1 to 17. " +
  "`authors` are author IDs from a result or from research/lookup:find, or names as papers print them. `funders` and `researchAreas` are IDs from research/lookup:find. " +
  "`citationsOf`, `referencesOf` and `relatedTo` each take one paper's ID: the papers that cite that paper, the papers in its own reference list, and papers related to it. " +
  "`ratedOnly` keeps only papers the person rated. `minRating` and `maxRating` (0 to 5) keep those rated within them, and turn `ratedOnly` on.";

/** Authors of a paper the results name, each with its ID to filter by. */
export const AUTHORS_SHOWN = 3;
/** Matches one lookup returns. */
export const LOOKUP_MAX = 8;
export const lookupKindValidator = v.union(v.literal("author"), v.literal("funder"), v.literal("researchArea"));
export const lookupValidator = v.object({
  matches: capped(v.array(v.object({ id: v.string(), name: v.string(), detail: v.optional(v.string()) })), LOOKUP_MAX),
});

/** What a count of papers can be divided by, and OpenAlex's own name for each grouping. */
export const GROUPINGS = {
  year: "publication_year",
  language: "language",
  type: "type",
  openAccess: "open_access.is_oa",
  country: "authorships.countries",
  author: "authorships.author.id",
  institution: "authorships.institutions.id",
  funder: "funders.id",
  journal: "primary_location.source.id",
  field: "primary_topic.field.id",
  sdg: "sustainable_development_goals.id",
} as const;
export type Grouping = keyof typeof GROUPINGS;
/** Groups one count returns: the largest, or under `year` the latest. */
export const GROUPS_MAX = 40;
export const countValidator = v.object({
  /** How many papers match in all. */
  total: v.number(),
  /** The groups, largest first, or by year from the earliest. `id` is what the matching filter takes, where there is one. */
  groups: capped(v.optional(v.array(v.object({ name: v.string(), count: v.number(), id: v.optional(v.string()) }))), GROUPS_MAX),
  /** There are more groups than these. How many isn't known: OpenAlex returns the largest 200. */
  moreGroups: v.optional(v.literal(true)),
});

/** Countries a paper's authors work in that a results page names. */
export const COUNTRIES_SHOWN = 5;
const paperValidator = v.object({
  id: v.string(),
  title: v.string(),
  /** Its first authors, and how many more it has. An author OpenAlex has a record for comes with their ID. */
  authors: capped(v.optional(v.array(v.object({ name: v.string(), id: v.optional(v.string()) }))), AUTHORS_SHOWN),
  moreAuthors: v.optional(v.number()),
  /** The countries its authors' institutions are in, as two-letter codes. */
  countries: capped(v.optional(v.array(v.string())), COUNTRIES_SHOWN),
  year: v.optional(v.number()),
  venue: v.optional(v.string()),
  /** What kind of work it is: article, preprint, book-chapter and so on. */
  type: v.optional(v.string()),
  doi: v.optional(v.string()),
  /** Whether anyone can read it for free. */
  openAccess: v.optional(v.boolean()),
  citations: v.optional(v.number()),
  /** The start of its abstract. research/papers:get reads all of it. */
  abstract: v.optional(v.string()),
});

/** Authors of one paper its record lists, institutions named for each, and its funders. */
export const AUTHORS_LISTED = 20;
export const INSTITUTIONS_LISTED = 3;
export const FUNDERS_LISTED = 8;
/** One paper, whole: what a results page says of it, with every author it can list, where each works, and all of its abstract. */
export const paperRecordValidator = v.object({
  id: v.string(),
  title: v.string(),
  authors: capped(v.array(v.object({ name: v.string(), id: v.optional(v.string()), institutions: capped(v.optional(v.array(v.string())), INSTITUTIONS_LISTED) })), AUTHORS_LISTED),
  moreAuthors: v.optional(v.number()),
  year: v.optional(v.number()),
  venue: v.optional(v.string()),
  type: v.optional(v.string()),
  language: v.optional(v.string()),
  doi: v.optional(v.string()),
  openAccess: v.optional(v.boolean()),
  /** Where it can be read for free, when it can. */
  link: v.optional(v.string()),
  citations: v.optional(v.number()),
  /** Who funded it, as OpenAlex records it, each with the ID the `funders` filter takes. */
  funders: capped(v.optional(v.array(v.object({ name: v.string(), id: v.string() }))), FUNDERS_LISTED),
  abstract: v.optional(v.string()),
});

export const resultsValidator = v.object({
  /** How many results the search has in all. */
  total: v.number(),
  page: v.number(),
  pages: v.number(),
  papers: capped(v.array(paperValidator), RESULTS_PAGE),
});
