/**
 * Search Module
 * 
 * Clean, URL-based search state management.
 * 
 * Usage:
 * 
 * 1. Wrap your results layout:
 * ```tsx
 * <SearchInitializer>
 *   <SearchProvider>
 *     {children}
 *   </SearchProvider>
 * </SearchInitializer>
 * ```
 * 
 * 2. Use in components:
 * ```tsx
 * const { query, results, isLoading, setQuery } = useSearch();
 * ```
 * 
 * 3. Submit new search from home:
 * ```tsx
 * const { url } = submitNewSearch(query, filters);
 * router.push(url);
 * ```
 */

// Provider and hooks
export { SearchProvider, useSearch, useSearchOptional } from './provider';
export type { LocalSearchState } from './provider';

// Initializer for shared link handling
export { SearchInitializer } from './initializer';

// Actions
export { submitNewSearch, restoreFromHistory, createCitationSearch } from './actions';

// Question detection
export { detectSearchMode } from './detect-mode';

// Types (interfaces only - no duplicate constants/functions)
export type { SearchParams, SearchContextValue, SearchResultData, SetQueryOptions } from './types';

// Re-export from canonical location (lib/search-params) to avoid duplication
export { hasActiveFilters, DEFAULT_SEARCH_PARAMS } from '../search-params';
