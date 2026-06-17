/**
 * True if the query contains a `*` or `?` wildcard OUTSIDE of a quoted phrase.
 *
 * A wildcard only works on OpenAlex's no-stem (exact) search field. On the
 * default stemmed `.search` field the engine strips the literal prefix at index
 * time and rejects the query with HTTP 400. So we detect an unquoted wildcard
 * and route that search to the `.search.exact` field instead — mirroring how
 * openalex.org's own search box behaves (openalex-gui `searchBox.helpers.js`).
 *
 * A wildcard *inside* a quoted phrase is a different (invalid) case — OpenAlex
 * rejects it outright (see {@link hasWildcardInQuotedPhrase}) — so quoted phrases
 * are stripped before this check.
 */
export function hasUnquotedWildcard(query: string): boolean {
  if (!query || typeof query !== "string") return false;
  const unquoted = query.replace(/"[^"]*"/g, " ");
  return unquoted
    .split(/\s+/)
    .some((word) => word.includes("*") || word.includes("?"));
}

/**
 * True if the query has a `*` or `?` wildcard INSIDE a quoted phrase, e.g.
 * `"contextual support*"`. OpenAlex/Lucene rejects this with HTTP 400
 * ("Wildcards do not work inside this quoted phrase — use an adjacency phrase
 * or proximity"). It is an invalid query, not a routable one: the AI query
 * builder must drop the wildcard or move it onto a bare (unquoted) term.
 */
export function hasWildcardInQuotedPhrase(query: string): boolean {
  if (!query || typeof query !== "string") return false;
  const phrases = query.match(/"[^"]*"/g) ?? [];
  return phrases.some((p) => p.includes("*") || p.includes("?"));
}
