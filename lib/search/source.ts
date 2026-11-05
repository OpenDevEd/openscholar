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

/** Filters as OpenAlex reads them: a search saved in a way only our index has runs on the words it holds. */
export const asKeywords = <Filters extends { searchField: string }>(filters: Filters): Filters =>
  OWN_ONLY_FIELDS.includes(filters.searchField) ? { ...filters, searchField: "title_and_abstract" } : filters;

/** Filters a source can't serve, by their panel in the search sidebar. They aren't offered while it's active. */
export const UNSERVED_FILTER_PANELS: Record<SearchSource, readonly string[]> = {
  openalex: [],
  openscholar: ["studyDesign"],
};
