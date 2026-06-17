/**
 * Pure decision logic for SearchInitializer — the URL/history reconciliation
 * that runs when a /results route mounts. Ported from the `old` branch
 * (cc727f1d) and extracted out of the component so it can be unit-tested
 * without React/router/store.
 *
 * The three branches:
 *  A. missing OR unknown searchId  -> create a new entry (caller mints the id
 *     and redirects to /results/[newId]); this is what makes bare /results
 *     always render results, with an empty query being a valid empty search.
 *  B. known id, no explicit URL params -> restore stored state to a canonical URL.
 *  C. known id, explicit params -> sync the store if they differ, then
 *     canonicalize the URL (strip default/empty params).
 *
 * The caller (the component) performs the side effects: mint id via the store,
 * router.replace, updateSearchResult/addQueryToHistory.
 */

import type { ParsedSearchParams } from "../search-params/parsers";
import {
  paramsToSearchResult,
  searchResultToParams,
  paramsMatchState,
  type NewSearchResultData,
} from "../search-params/converters";
import { buildResultsUrl } from "../search-params";
import type { SearchResult } from "../types";

export type SearchInitFilterUpdates = Omit<NewSearchResultData, "query" | "count">;

export type SearchInitDecision =
  | { kind: "create"; entry: NewSearchResultData }
  | { kind: "redirect"; url: string }
  | {
      kind: "sync";
      addQuery: string | null;
      filterUpdates: SearchInitFilterUpdates;
      redirectTo: string | null;
    }
  | { kind: "ready" };

export interface SearchInitInput {
  searchId: string;
  parsedParams: ParsedSearchParams;
  hasExplicitParams: boolean;
  existingEntry: SearchResult | undefined;
  currentUrl: string;
}

function canonicalUrlForParams(
  searchId: string,
  parsedParams: ParsedSearchParams
): string {
  const entry = paramsToSearchResult(parsedParams);
  const canonicalParams = searchResultToParams({
    ...entry,
    id: searchId,
  } as SearchResult);
  return buildResultsUrl(searchId, canonicalParams);
}

/**
 * Normalize a URL for comparison: decode + re-encode the query string through
 * URLSearchParams and sort the keys. nuqs leaves `(` `)` unencoded while the
 * browser's `searchParams.toString()` encodes them as %28/%29 — comparing the
 * raw strings would treat the same query as "non-canonical" forever and
 * redirect-loop. Normalizing makes the comparison encoding- and order-agnostic.
 */
function normalizeUrl(url: string): string {
  const q = url.indexOf("?");
  if (q === -1) return url;
  const sp = new URLSearchParams(url.slice(q + 1));
  sp.sort();
  return `${url.slice(0, q)}?${sp.toString()}`;
}

export function resolveSearchInit(input: SearchInitInput): SearchInitDecision {
  const { searchId, parsedParams, hasExplicitParams, existingEntry, currentUrl } =
    input;

  // Branch A: missing OR unknown id -> create.
  if (!searchId || !existingEntry) {
    return { kind: "create", entry: paramsToSearchResult(parsedParams) };
  }

  // Branch B: known id, no explicit params -> restore stored state to URL.
  if (!hasExplicitParams) {
    return {
      kind: "redirect",
      url: buildResultsUrl(searchId, searchResultToParams(existingEntry)),
    };
  }

  // Branch C: known id, explicit params. Compare normalized URLs so encoding
  // differences (nuqs vs browser) don't trigger spurious canonicalize redirects.
  const canonicalUrl = canonicalUrlForParams(searchId, parsedParams);
  const isCanonical = normalizeUrl(canonicalUrl) === normalizeUrl(currentUrl);

  if (paramsMatchState(parsedParams, existingEntry)) {
    return isCanonical
      ? { kind: "ready" }
      : { kind: "redirect", url: canonicalUrl };
  }

  const addQuery =
    parsedParams.q !== existingEntry.query ? parsedParams.q : null;
  const { query: _query, count: _count, ...filterUpdates } =
    paramsToSearchResult(parsedParams);

  return {
    kind: "sync",
    addQuery,
    filterUpdates,
    redirectTo: isCanonical ? null : canonicalUrl,
  };
}
