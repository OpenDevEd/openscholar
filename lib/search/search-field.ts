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
  // The words go in a filter, where a comma outside quotes starts the next filter: a pasted sentence's commas made it
  // "not a filter". A comma means nothing among search words, so it's a space; one in a quoted phrase is kept.
  const words = query.split('"').map((part, at) => (at % 2 ? part : part.replace(/,/g, " "))).join('"');
  return hasUnquotedWildcard(words)
    ? { search: { exact: words } }
    : { search: words };
}
