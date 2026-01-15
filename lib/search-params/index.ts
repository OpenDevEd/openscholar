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

// Parsers and serialization
export {
  searchParamsParsers,
  serializeSearchParams,
  DEFAULT_SEARCH_PARAMS,
  type ParsedSearchParams,
} from './parsers';

// Region encoding
export {
  encodeRegions,
  decodeRegions,
} from './regions';

// Type converters
export {
  paramsToSearchResult,
  searchResultToParams,
  paramsToFilters,
  paramsMatchState,
  hasActiveFilters,
  type NewSearchResultData,
} from './converters';

/**
 * Build a results page URL for a search
 * Uses nuqs serializer with base path for proper URL construction
 * 
 * @param searchId - The search entry ID
 * @param params - The search params to serialize
 * @returns Full URL path like "/results/abc-123?q=test&field=title"
 */
export function buildResultsUrl(searchId: string, params: Partial<ParsedSearchParams>): string {
  return serializeSearchParams(`/results/${searchId}`, params);
}


