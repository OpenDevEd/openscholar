/**
 * Which source OpenScholar's searches read: OpenAlex, or our own index (the OpenScholar API). One is active for the
 * whole site, chosen by a site admin at Settings > Admin > Switches. Evidence Communities don't follow it: their
 * sources ask OpenAlex themselves.
 */
export type SearchSource = "openalex" | "openscholar";

// ponytail: an on/off flag, since there are two sources. A third source needs a setting that holds a name.
export const SEARCH_SOURCE_FLAG = "search.openscholar";

/** What people read a source as. A brand, so it isn't translated. */
export const SEARCH_SOURCE_NAMES: Record<SearchSource, string> = { openalex: "OpenAlex", openscholar: "Openscholar" };

export const sourceFromFlag = (on: boolean | undefined): SearchSource => (on ? "openscholar" : "openalex");

/** A record's ID on our index, such as OS79563844, OSA2259683 or OSV1, bare or as its address. */
const OWN_ID = /^(?:https?:\/\/openscholar\.ai\/)?OS[AV]?\d+$/i;

export const isOwnId = (id: string) => OWN_ID.test(id.trim());

/** Which source reads a record by its ID: only ours knows our IDs, and any other ID goes to the active source. */
export const sourceForId = (id: string, active: SearchSource): SearchSource => (isOwnId(id) ? "openscholar" : active);

/** Ways to search only our index has. They aren't offered while OpenAlex is active. */
export const OWN_ONLY_FIELDS: readonly string[] = ["default", "semantic"];
export const SEMANTIC_FIELD = "semantic";

/** What a saved search for similar papers says on OpenAlex, which has no such search. */
export const SIMILAR_NEEDS_OWN_INDEX = "Similar papers need our own index, and search is on OpenAlex right now.";

/** A question as OpenAlex's search of the words in a title and abstract reads it, without what would make it an operator or split the filter. */
export const questionAsWords = (question: string) => question.replace(/[,|*?()"]/g, " ").replace(/\s+/g, " ").trim();

/** Filters as OpenAlex reads them: a question runs on its words. The combined scope needs nothing, since OpenAlex takes it as a plain search. */
export const asKeywords = <Filters extends { searchField: string }>(filters: Filters): Filters =>
  filters.searchField === SEMANTIC_FIELD ? { ...filters, searchField: "title_and_abstract" } : filters;

/** Search params as a source runs them: a question saved on our index runs on OpenAlex as its words, with the filters and sort words take. What's saved and shared stays the question. */
export const paramsAsRun = <Params extends { field: string; q: string }>(params: Params, source: SearchSource): Params =>
  source === "openalex" && params.field === SEMANTIC_FIELD ? { ...params, field: "title_and_abstract", q: questionAsWords(params.q) } : params;

/** Filters a source can't serve, by their panel in the search sidebar. They aren't offered while it's active. */
export const UNSERVED_FILTER_PANELS: Record<SearchSource, readonly string[]> = {
  openalex: [],
  openscholar: ["studyDesign"],
};

/** The DOI a whole query is, with or without its address, in the form a filter takes it; null for anything else. */
export function doiOfQuery(query: string): string | null {
  const doi = query.trim().match(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/\S+)$/i)?.[1];
  return doi ? `https://doi.org/${doi.toLowerCase()}` : null;
}
