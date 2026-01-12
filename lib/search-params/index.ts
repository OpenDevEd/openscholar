/**
 * Search Params Module
 * 
 * Central module for URL-based search state management.
 * 
 * This module provides:
 * 1. URL parsers for all search parameters (nuqs)
 * 2. Smart region encoding for compact URLs
 * 3. Converters between URL params, SearchResult, and SearchFilters
 * 
 * @example
 * ```tsx
 * import { searchParamsParsers, serializeSearchParams } from '@/lib/search-params';
 * import { useQueryStates } from 'nuqs';
 * 
 * // In a component
 * const [params, setParams] = useQueryStates(searchParamsParsers);
 * 
 * // Build a shareable URL
 * const url = `/results/abc-123?${serializeSearchParams(params)}`;
 * ```
 */

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
} from './converters';
