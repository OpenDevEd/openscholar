import { getSearchResults } from '@/app/actions/openalex';
import { SearchError } from './search/search-error';
import type { Works } from '@sickrin/openalex-sdk/dist/src/types/work';
import { isCountryFocusActive, isCitesFilterActive, isRelatedToFilterActive, isDateFilterActive } from './utils';
import { getCountryCodesForRegions, COUNTRIES, COUNTRY_NAME_CHANGES } from './constants';
import { validateAndExpandKeywords } from './keyword-validation';
import type { SearchFilters, SearchField } from './types';

export interface SearchWithFiltersParams {
  query: string;
  filters: SearchFilters;
}

export interface GetSearchResultsWithFiltersOptions {
  getMessage?: (key: string, params?: Record<string, string>) => string;
  onWarning?: (message: string) => void;
}

export interface EnhancedSearchResult {
  originalQuery: string;
  enhancedQuery: string;
  countryNames: string[];
  validation: {
    isValid: boolean;
    expandedQuery: string;
    warnings: string[];
  };
  results: Works;
  paramsKey?: string;
}

/**
 * Clean country names for use in OpenAlex API queries
 * Replace commas with spaces and handle other problematic characters
 */
function cleanCountryNameForAPI(countryName: string): string {
  return countryName
    .replace(/,/g, '') // Remove commas entirely
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Enhanced wrapper for getSearchResults that handles all state management,
 * query enhancement, and country filtering logic.
 */
export async function getSearchResultsWithFilters(
  params: SearchWithFiltersParams,
  options?: GetSearchResultsWithFiltersOptions
): Promise<EnhancedSearchResult> {
  const { query, filters } = params;

  // Calculate if date filters are active using the utility function
  const isDateFilterActiveState = isDateFilterActive(
    filters.dateRange, 
    filters.yearRange, 
    filters.filterType, 
    filters.isYearRangeEnabled
  );

  // Determine which date/year range to use based on filter type and if filter is active
  const effectiveDateRange = (filters.filterType === "date" && isDateFilterActiveState) ? filters.dateRange : undefined;
  const effectiveYearRange = (filters.filterType === "year" && isDateFilterActiveState && filters.isYearRangeEnabled) ? filters.yearRange : undefined;

  // Create filters with effective date/year ranges for the API call
  const effectiveFilters: SearchFilters = {
    ...filters,
    dateRange: effectiveDateRange,
    yearRange: effectiveYearRange,
  };

  // Get effective cites item ID
  const effectiveCitesItemId = isCitesFilterActive(filters.citesItemId) ? filters.citesItemId : undefined;

  // Get effective related_to item ID
  const effectiveRelatedToItemId = isRelatedToFilterActive(filters.relatedToItemId) ? filters.relatedToItemId : undefined;

  // Get country names for query enhancement if Country focus is active
  const getCountryNames = (): string[] => {
    if (!isCountryFocusActive(filters.selectedCountryFocus)) return [];
    const countryNames: string[] = [];
    const countryData = getCountryCodesForRegions(filters.selectedCountryFocus, true); // Bypass limit for Country focus
    
    countryData.countries.forEach(code => {
      if (COUNTRIES[code]) {
        for (const name of COUNTRY_NAME_CHANGES[code] ?? [COUNTRIES[code]]) {
          const cleanedName = cleanCountryNameForAPI(name);
          if (!countryNames.includes(cleanedName)) countryNames.push(cleanedName);
        }
      }
    });
    
    return countryNames;
  };

  const countryNames = getCountryNames();

  // Validate and expand keywords on the original query first
  const validation = validateAndExpandKeywords(query, {
    getMessage: options?.getMessage,
    onWarning: options?.onWarning,
  });
  if (!validation.isValid) {
    // Return early with error state instead of throwing
    return {
      originalQuery: query,
      enhancedQuery: query,
      countryNames,
      validation,
      results: { results: [], meta: { count: 0, db_response_time_ms: 0, page: 1, per_page: 0, groups_count: null, next_cursor: "" } }
    };
  }

  // Create the final API query by enhancing the expanded query with country names
  let finalApiQuery = validation.expandedQuery;
  if (countryNames.length > 0) {
    const countryTerms = countryNames.map(name => `"${name}"`).join(' OR ');
    if (validation.expandedQuery) {
      finalApiQuery = `(${validation.expandedQuery}) AND (${countryTerms})`;
    } else {
      finalApiQuery = `(${countryTerms})`;
    }
  }

  // Add review filter if active
  if (filters.reviewFilter) {
    const reviewTerms = '(review OR synthesis OR "meta-analysis")';
    if (finalApiQuery) {
      finalApiQuery = `(${finalApiQuery}) AND ${reviewTerms}`;
    } else {
      finalApiQuery = reviewTerms;
    }
  }

  // Get results with the final enhanced query for API, but keep original query for UI
  const result = await getSearchResults(
    finalApiQuery,
    effectiveFilters,
    finalApiQuery, // Pass the final enhanced query as both search and expanded query
    effectiveCitesItemId,
    effectiveRelatedToItemId
  );

  if (!result.ok) {
    // Throw client-side so the real status + OpenAlex message reach the toast
    // intact. A server-action-thrown message is stripped by Next in production;
    // this SearchError is constructed here, in the browser, so it survives.
    throw new SearchError(result.message, result.status);
  }

  return {
    originalQuery: query,
    enhancedQuery: query, // Keep the original query for UI display
    countryNames,
    validation,
    results: result.data
  };
} 