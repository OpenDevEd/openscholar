/**
 * True if the query contains a `*` or `?` wildcard OUTSIDE of a quoted phrase.
 *
 * A wildcard only works on OpenAlex's no-stem (exact) search field. On the
 * default stemmed `.search` field the engine strips the literal prefix at index
 * time and rejects the query with HTTP 400. So we detect an unquoted wildcard
 * and route that search to the `.search.exact` field instead — mirroring how
 * openalex.org's own search box behaves (openalex-gui `searchBox.helpers.js`).
 *
 * A wildcard *inside* a quoted phrase is a separate proximity case the engine
 * handles on its own, so quoted phrases are stripped before the check.
 */
export function hasUnquotedWildcard(query: string): boolean {
  if (!query || typeof query !== "string") return false;
  const unquoted = query.replace(/"[^"]*"/g, " ");
  return unquoted
    .split(/\s+/)
    .some((word) => word.includes("*") || word.includes("?"));
}
