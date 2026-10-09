/**
 * Search by meaning, which the OpenScholar API serves on works as `search.semantic` (its own index of
 * every paper's vector). The question goes as typed: keyword expansion, country focus and the review
 * filter's added terms are for keyword searches, and the works come in relevance order alone. Offered
 * on the test environment's branch only, for internal use, while the API's search by meaning is tried.
 */

import { OQL_FIELD } from "./oql";

/** The search field that asks a question by meaning. */
export const SEMANTIC_FIELD = "semantic";

/** The works parameter that carries the question. */
export const SEMANTIC_PARAMETER = "search.semantic";

/** The works parameter that carries the papers whose nearest works by meaning are asked, joined by |. */
export const SIMILAR_PARAMETER = "similar_to";

/** The one order a search by meaning lists its works in. */
export const SEMANTIC_SORT = "relevance_score:desc";

/** Whether a search asks a question by meaning: the field is set and a question is typed. Its works then come by relevance alone. */
export function asksByMeaning(field: string | undefined, query: string | undefined): boolean {
  return field === SEMANTIC_FIELD && Boolean(query?.trim());
}

/**
 * Whether a search in this field can be one for the works nearest given papers: a question by
 * meaning and an OQL query each say by themselves what the works are searched by.
 */
export function takesLike(field: string): boolean {
  return field !== SEMANTIC_FIELD && field !== OQL_FIELD;
}
