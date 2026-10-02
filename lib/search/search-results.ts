import { getSearchResults } from '@/app/actions/openalex';
import type { Works } from '@sickrin/openalex-sdk/dist/src/types/work';
import { SearchError } from './search-error';
import {
  prepareOpenAlexSearch,
  requestFilters,
  type PreparedOpenAlexSearch,
  type GetSearchResultsWithFiltersOptions,
  type SearchWithFiltersParams,
} from '../search-utils';

export interface EnhancedSearchResult {
  originalQuery: string;
  enhancedQuery: string;
  countryNames: string[];
  validation: PreparedOpenAlexSearch["validation"];
  results: Works;
  paramsKey?: string;
}

/**
 * Enhanced wrapper for getSearchResults that handles all state management,
 * query enhancement, and country filtering logic.
 */
export async function getSearchResultsWithFilters(
  params: SearchWithFiltersParams,
  options?: GetSearchResultsWithFiltersOptions
): Promise<EnhancedSearchResult> {
  const { query } = params;
  const {
    validation,
    countryNames,
    finalApiQuery,
    effectiveFilters,
    effectiveCitesItemId,
    effectiveRelatedToItemId,
  } = prepareOpenAlexSearch(params, options);
  if (finalApiQuery === null) {
    // Return early with error state instead of throwing
    return {
      originalQuery: query,
      enhancedQuery: query,
      countryNames,
      validation,
      results: { results: [], meta: { count: 0, db_response_time_ms: 0, page: 1, per_page: 0, groups_count: null, next_cursor: "" } }
    };
  }

  // Get results with the final enhanced query for API, but keep original query for UI
  const result = await getSearchResults(
    finalApiQuery,
    requestFilters(effectiveFilters, effectiveCitesItemId, effectiveRelatedToItemId),
  );

  if (!result.ok) {
    // Throw client-side so the real status + OpenAlex message reach the toast
    // intact. A server-action-thrown message is stripped by Next in production;
    // this SearchError is constructed here, in the browser, so it survives.
    throw new SearchError(result.message, result.status, result.detail ?? null);
  }

  return {
    originalQuery: query,
    enhancedQuery: query, // Keep the original query for UI display
    countryNames,
    validation,
    results: result.data
  };
} 