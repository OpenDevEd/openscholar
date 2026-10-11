/**
 * Search Params Module
 * 
 * Central module for URL-based search state management.
 * 
 * This module provides:
 * 1. URL parsers for all search parameters (nuqs)
 * 2. Smart region encoding for compact URLs
 * 3. Converters between URL params, SearchResult, and SearchFilters
 * 4. URL building utilities for results pages
 * 
 * @example
 * ```tsx
 * import { searchParamsParsers, buildResultsUrl } from '@/lib/search-params';
 * import { useQueryStates } from 'nuqs';
 * 
 * // In a component
 * const [params, setParams] = useQueryStates(searchParamsParsers);
 * 
 * // Build a results page URL
 * const url = buildResultsUrl('abc-123', params);
 * ```
 */

import { serializeSearchParams, type ParsedSearchParams } from './parsers';
import { OQL_FIELD } from '../openalex/oql';

// Parsers and serialization
export { parseSearchParamsFromUrl, DEFAULT_SEARCH_PARAMS, type ParsedSearchParams } from './parsers';

// Type converters
export { paramsToSearchResult, searchResultToParams, paramsToFilters, effectiveSort } from './converters';

const SHARED_OQL = 'oql';

/** The OQL query a shared link carries in its fragment. */
export function readSharedOql(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get(SHARED_OQL);
}

/** An OQL query can outgrow a URL, so an OQL search keeps it only in its history entry. */
function withUrlQuery(params: Partial<ParsedSearchParams>): Partial<ParsedSearchParams> {
  return params.field === OQL_FIELD ? { ...params, q: '' } : params;
}

/**
 * Build a results page URL for a search
 * Uses nuqs serializer with base path for proper URL construction
 * 
 * @param searchId - The search entry ID
 * @param params - The search params to serialize
 * @returns Full URL path like "/results/abc-123?q=test&field=title"
 */
export function buildResultsUrl(searchId: string, params: Partial<ParsedSearchParams>): string {
  return serializeSearchParams(`/results/${encodeURIComponent(searchId)}`, withUrlQuery(params));
}

/**
 * Build a SHAREABLE results URL: the query and filters, and the search's id when it's an account's.
 *
 * With the id (#653), whoever can open the search opens the search itself: a member of its
 * workspace, or a guest it was shared with. Anyone else doesn't have it, and their
 * SearchInitializer makes their own copy from the query and filters (resolveSearchInit Branch A),
 * as it does for a link without one. A signed-out browser's id is a key in its own storage,
 * meaningless to a recipient, so its links carry none. Defaults are stripped via clearOnDefault.
 *
 * @param origin - The absolute origin, e.g. window.location.origin
 * @param params - The search params to serialize
 * @param searchId - The account's search the link opens for those who can open it
 */
export function buildShareableUrl(origin: string, params: Partial<ParsedSearchParams>, searchId?: string): string {
  const url = serializeSearchParams(`${origin}/results${searchId ? `/${encodeURIComponent(searchId)}` : ""}`, withUrlQuery(params));
  // A browser never sends the fragment to the server, so a long OQL query fits there.
  return params.field === OQL_FIELD && params.q ? `${url}#${SHARED_OQL}=${encodeURIComponent(params.q)}` : url;
}

