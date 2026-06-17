import { hasUnquotedWildcard } from "./wildcard";

/**
 * The value assigned to an OpenAlex search filter field (e.g. `title_and_abstract`).
 * The SDK flattens `{ search: q }` to `title_and_abstract.search:q` (stemmed) and
 * `{ search: { exact: q } }` to `title_and_abstract.search.exact:q` (no-stem).
 */
export type SearchSubfilter = { search: string } | { search: { exact: string } };

/**
 * Pick the stemmed `.search` field by default, but route to the no-stem
 * `.search.exact` field when the query contains an unquoted wildcard — the
 * same rule openalex.org applies, so wildcard queries don't 400 against the
 * stemmed field. See [[hasUnquotedWildcard]].
 */
export function buildSearchSubfilter(query: string): SearchSubfilter {
  return hasUnquotedWildcard(query)
    ? { search: { exact: query } }
    : { search: query };
}
