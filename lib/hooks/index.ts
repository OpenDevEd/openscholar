/**
 * Hooks Index
 * 
 * Central export point for all custom hooks
 */

// New URL-based search state hooks
export { 
  useSearchState, 
  useSearchResultsWithParams,
  type UseSearchStateReturn,
} from './use-search-state';

// Re-export from parent hooks.ts for backwards compatibility
// These will be gradually deprecated in favor of useSearchState
