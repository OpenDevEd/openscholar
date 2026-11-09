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
  // The words go in a filter, where a comma starts the next filter, inside quotes too for our own index: a pasted
  // sentence's commas made it "not a filter". A comma means nothing among search words, or in a phrase whose words are
  // matched without their punctuation, so it's a space.
  const words = query.replace(/,/g, " ");
  return hasUnquotedWildcard(words)
    ? { search: { exact: words } }
    : { search: words };
}
