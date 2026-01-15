import { DateRange } from 'react-day-picker';
import { getSearchResults } from '@/app/actions/openalex';
import { isCountryFilterActive, isCountryFocusActive, isCitesFilterActive, isCitedByFilterActive, isRelatedToFilterActive, isDateFilterActive, isFilterAtDefault } from './utils';
import { getCountryCodesForRegions, COUNTRIES } from './constants';
import { useSearchHistoryStore } from './store';
import { validateAndExpandKeywords } from './keyword-validation';
import type { SearchFilters, SearchField } from './types';

export interface SearchWithFiltersParams {
  query: string;
  filters: SearchFilters;
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
  results: any;
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
  params: SearchWithFiltersParams
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
        const cleanedName = cleanCountryNameForAPI(COUNTRIES[code]);
        if (!countryNames.includes(cleanedName)) {
          countryNames.push(cleanedName);
        }
      }
    });
    
    return countryNames;
  };

  const countryNames = getCountryNames();

  // Validate and expand keywords on the original query first
  const validation = validateAndExpandKeywords(query);
  if (!validation.isValid) {
    // Return early with error state instead of throwing
    return {
      originalQuery: query,
      enhancedQuery: query,
      countryNames,
      validation,
      results: { results: [], meta: { count: 0 } }
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
  const results = await getSearchResults(
    finalApiQuery,
    effectiveFilters,
    finalApiQuery, // Pass the final enhanced query as both search and expanded query
    effectiveCitesItemId,
    effectiveRelatedToItemId
  );

  return {
    originalQuery: query,
    enhancedQuery: query, // Keep the original query for UI display
    countryNames,
    validation,
    results
  };
}

/**
 * Helper function to create search state object for saving to history
 */
export function createSearchStateFromStore(
  query: string,
  filters: SearchFilters,
  resultsCount?: number,
  researchQuestion?: string
) {
  return {
    query,
    field: filters.searchField,
    count: resultsCount || 0,
    dateRange: filters.dateRange,
    yearRange: filters.yearRange,
    filterType: filters.filterType,
    isYearRangeEnabled: filters.isYearRangeEnabled,
    sortBy: filters.sortBy,
    selectedRegions: filters.selectedRegions,
    selectedCountryFocus: filters.selectedCountryFocus,
    // Only include rating fields if they're not at default values
    ...(filters.ratingRange && !isFilterAtDefault.ratingRange(filters.ratingRange) ? { ratingRange: filters.ratingRange } : {}),
    ...(filters.onlyRatedPapers !== undefined && !isFilterAtDefault.onlyRatedPapers(filters.onlyRatedPapers) ? { onlyRatedPapers: filters.onlyRatedPapers } : {}),
    citesItemId: filters.citesItemId,
    citedByItemId: filters.citedByItemId,
    relatedToItemId: filters.relatedToItemId,
    reviewFilter: filters.reviewFilter,
    // Include questionHistory if research question is provided
    ...(researchQuestion ? {
      questionHistory: [{
        question: researchQuestion,
        timestamp: new Date().toISOString()
      }]
    } : {})
  };
} 