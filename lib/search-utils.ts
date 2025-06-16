import { DateRange } from 'react-day-picker';
import { getSearchResults } from '@/app/actions/openalex';
import { SearchField } from './utils';
import { getCountryCodesForRegions, COUNTRIES } from './constants';
import { useSearchFormStore } from './store';
import { validateAndExpandKeywords } from './keyword-validation';

export interface SearchWithFiltersParams {
  query: string;
  searchField: SearchField;
  dateRange?: DateRange;
  sortBy?: string;
  yearRange?: [number, number];
  filterType?: "date" | "year";
  isFilterActive?: boolean;
  // Override state - if provided, uses these instead of store state
  overrideState?: {
    selectedRegions?: string[];
    isCountryFilterActive?: boolean;
    selectedCountryFocus?: string[];
    isCountryFocusActive?: boolean;
    citesItemId?: string;
    isCitesFilterActive?: boolean;
    relatedToItemId?: string;
    isRelatedToFilterActive?: boolean;
  };
}

export interface EnhancedSearchResult {
  originalQuery: string;
  enhancedQuery: string;
  effectiveCountryCodes?: string[];
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
  const {
    query,
    searchField,
    dateRange,
    sortBy,
    yearRange,
    filterType,
    isFilterActive,
    overrideState
  } = params;

  // Get state from store or use overrides
  const storeState = useSearchFormStore.getState();
  const {
    selectedRegions = storeState.selectedRegions,
    isCountryFilterActive = storeState.isCountryFilterActive,
    selectedCountryFocus = storeState.selectedCountryFocus,
    isCountryFocusActive = storeState.isCountryFocusActive,
    citesItemId = storeState.citesItemId,
    isCitesFilterActive = storeState.isCitesFilterActive,
    relatedToItemId = storeState.relatedToItemId,
    isRelatedToFilterActive = storeState.isRelatedToFilterActive
  } = overrideState || {};

  // Determine which date/year range to use based on filter type
  const effectiveDateRange = (filterType === "date" && isFilterActive) ? dateRange : undefined;
  const effectiveYearRange = (filterType === "year" && isFilterActive) ? yearRange : undefined;

  // Get country codes for API filtering if country filter is active
  const updateCountryData = isCountryFilterActive ? getCountryCodesForRegions(selectedRegions) : null;
  const effectiveCountryCodes = updateCountryData ? updateCountryData.countries : undefined;

  // Get effective cites item ID
  const effectiveCitesItemId = isCitesFilterActive ? citesItemId : undefined;

  // Get effective related_to item ID
  const effectiveRelatedToItemId = isRelatedToFilterActive ? relatedToItemId : undefined;

  // Get country names for query enhancement if Country focus is active
  const getCountryNames = (): string[] => {
    if (!isCountryFocusActive || selectedCountryFocus.length === 0) return [];
    const countryNames: string[] = [];
    const countryData = getCountryCodesForRegions(selectedCountryFocus, true); // Bypass limit for Country focus
    
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
      effectiveCountryCodes,
      countryNames,
      validation,
      results: { results: [], meta: { count: 0 } }
    };
  }

  // Create the final API query by enhancing the expanded query with country names
  let finalApiQuery = validation.expandedQuery;
  if (countryNames.length > 0) {
    const countryTerms = countryNames.map(name => `"${name}"`).join(' OR ');
    finalApiQuery = `(${validation.expandedQuery}) AND (${countryTerms})`;
  }

  // Get results with the final enhanced query for API, but keep original query for UI
  const results = await getSearchResults(
    finalApiQuery,
    searchField,
    effectiveDateRange,
    sortBy,
    effectiveYearRange,
    effectiveCountryCodes,
    finalApiQuery, // Pass the final enhanced query as both search and expanded query
    effectiveCitesItemId,
    effectiveRelatedToItemId
  );

  return {
    originalQuery: query,
    enhancedQuery: query, // Keep the original query for UI display
    effectiveCountryCodes,
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
  searchField: SearchField,
  dateRange?: DateRange,
  yearRange?: [number, number],
  filterType?: "date" | "year",
  sortBy?: string,
  resultsCount?: number
) {
  const {
    selectedRegions,
    isCountryFilterActive,
    selectedCountryFocus,
    isCountryFocusActive,
    ratingRange,
    isRatingFilterActive,
    onlyRatedPapers,
    citesItemId,
    isCitesFilterActive,
    relatedToItemId,
    isRelatedToFilterActive
  } = useSearchFormStore.getState();

  return {
    query,
    field: searchField,
    count: resultsCount || 0,
    dateRange,
    yearRange,
    filterType,
    sortBy,
    selectedRegions,
    isCountryFilterActive,
    selectedCountryFocus,
    isCountryFocusActive,
    ratingRange,
    isRatingFilterActive,
    onlyRatedPapers,
    citesItemId: isCitesFilterActive ? citesItemId : undefined,
    relatedToItemId: isRelatedToFilterActive ? relatedToItemId : undefined
  };
}

/**
 * Helper function to extract search state from a stored search result
 * for use with getSearchResultsWithFilters
 */
export function extractStateFromSearchResult(searchResult: any) {
  return {
    selectedRegions: searchResult.selectedRegions || [],
    isCountryFilterActive: searchResult.isCountryFilterActive || false,
    selectedCountryFocus: searchResult.selectedCountryFocus || [],
    isCountryFocusActive: searchResult.isCountryFocusActive || false,
    citesItemId: searchResult.citesItemId || '',
    isCitesFilterActive: !!searchResult.citesItemId,
    relatedToItemId: searchResult.relatedToItemId || '',
    isRelatedToFilterActive: !!searchResult.relatedToItemId
  };
} 