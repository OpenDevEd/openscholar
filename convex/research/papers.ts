/**
 * Papers, looked up without saving anything (#327). The saved-search tools (./searches.ts)
 * change what the person keeps and sees; these only read. With them the assistant answers
 * "what cites this paper" or "how many would that find" without making a search in the
 * person's history and deleting it again, which is what it did before it had them.
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { readWork } from "../paperSets/openalex";
import { ASSISTANT_FIELDS, toPaper, type SavedSearchRequest, type Work } from "../paperSets/search";
import { readPage, short } from "./searches";
import { AUTHORS_LISTED, FUNDERS_LISTED, INSTITUTIONS_LISTED, pageValidator, paperRecordValidator, RESULTS_PAGE, resultsValidator, searchSettings, SETTINGS } from "./searchValidators";

export const searchAction = defineUserAction({
  path: "research/papers:search",
  description:
    "Searches OpenAlex for papers by a query, filters, or both, and saves nothing. Use it to look papers up, to answer a question about papers, or to try a query: the person's saved searches stay as they are, and nothing changes on their page. " +
    `Returns ${RESULTS_PAGE} papers a page, each with its ID, title, first authors with their IDs, the countries they work in, year, venue, type, DOI, whether it's open access, citations and the start of its abstract, and how many papers match in all. ` +
    "The query is keywords, with AND, OR, NOT and quoted phrases. " +
    SETTINGS +
    " Each page read counts against the person's OpenAlex allowance.",
  args: { query: v.optional(v.string()), ...searchSettings, page: pageValidator },
  returns: resultsValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It changes nothing, so there's nothing to undo.
  undoable: true,
  run: async (ctx, userId, { query, page, ...settings }): Promise<Infer<typeof resultsValidator>> => {
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const found: SavedSearchRequest = await ctx.runQuery(internal.research.searches.requestFor, { userId, query, settings });
    return await readPage(ctx, userId, found, page ?? 1, "This query isn't one OpenAlex can read. Check its brackets and quotes.");
  },
});
export const search = userAction(searchAction);
export const searchForAssistant = assistantAction(searchAction);

/** Characters of an abstract a paper's record carries: all of nearly every one. A longer one is cut and marked as cut. */
const ABSTRACT_MAX = 6_000;
const NAME_MAX = 120;
/** A paper by its OpenAlex ID or its DOI, as OpenAlex's address for one work takes it. */
function workPath(id: string) {
  const given = id.trim();
  const work = given.match(/^(?:https?:\/\/openalex\.org\/(?:works\/)?)?(W\d+)$/i)?.[1];
  if (work) return work.toUpperCase();
  const doi = given.match(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)?(10\.\d{4,9}\/\S+)$/i)?.[1];
  if (doi) return `https://doi.org/${doi}`;
  throw createError("VALIDATION_ERROR", "A paper is read by its ID, such as W2741809807, or its DOI.");
}

export const getAction = defineUserAction({
  path: "research/papers:get",
  description:
    "Reads one paper whole, by its ID as results give it (such as W2741809807) or its DOI: its title, its authors with their IDs and where each works, year, venue, type, language, DOI, whether and where it's free to read, citations, who funded it, and all of its abstract. An abstract cut short ends in an ellipsis. " +
    "One request against the person's OpenAlex allowance.",
  args: { id: v.string() },
  returns: paperRecordValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It changes nothing, so there's nothing to undo.
  undoable: true,
  run: async (ctx, userId, { id }): Promise<Infer<typeof paperRecordValidator>> => {
    const path = workPath(id);
    const person: { clerkId: string } | null = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
    const { clerkId } = person;
    const work = await readWork<Work>(path, `${ASSISTANT_FIELDS},funders`, (count) => ctx.runMutation(internal.paperSets.search.spendRequests, { clerkId, count }));
    if (!work) throw createError("NOT_FOUND", "OpenAlex has no paper by that ID.");
    const paper = toPaper(work);
    const authors = (work.authorships ?? []).flatMap(({ author, institutions }) => {
      if (!author?.display_name) return [];
      const works = (institutions ?? []).flatMap(({ display_name: name, country_code: country }) => (name ? [`${name.slice(0, NAME_MAX)}${country ? ` (${country})` : ""}`] : []));
      return [{ name: author.display_name.slice(0, NAME_MAX), ...(author.id ? { id: author.id.split("/").at(-1)! } : {}), ...(works.length ? { institutions: works.slice(0, INSTITUTIONS_LISTED) } : {}) }];
    });
    const funders = (work.funders ?? []).flatMap(({ id: funder, display_name: name }) => (funder && name ? [{ name: name.slice(0, NAME_MAX), id: funder.split("/").at(-1)! }] : []));
    return {
      id: paper.openalexId,
      title: paper.title,
      authors: authors.slice(0, AUTHORS_LISTED),
      ...(authors.length > AUTHORS_LISTED ? { moreAuthors: authors.length - AUTHORS_LISTED } : {}),
      ...(paper.publicationYear === undefined ? {} : { year: paper.publicationYear }),
      ...(paper.venue ? { venue: paper.venue } : {}),
      ...(work.type ? { type: work.type } : {}),
      ...(work.language ? { language: work.language } : {}),
      ...(paper.doi ? { doi: paper.doi.replace(/^https?:\/\/doi\.org\//, "") } : {}),
      ...(typeof work.open_access?.is_oa === "boolean" ? { openAccess: work.open_access.is_oa } : {}),
      ...(work.open_access?.oa_url ? { link: work.open_access.oa_url } : {}),
      ...(paper.citedByCount === undefined ? {} : { citations: paper.citedByCount }),
      ...(funders.length ? { funders: funders.slice(0, FUNDERS_LISTED) } : {}),
      ...(paper.abstract ? { abstract: short(paper.abstract, ABSTRACT_MAX) } : {}),
    };
  },
});
export const get = userAction(getAction);
export const getForAssistant = assistantAction(getAction);
