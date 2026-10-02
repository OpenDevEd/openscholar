import { OQL_FIELD, joinOql } from './openalex/oql';
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

export interface PreparedOpenAlexSearch {
  validation: { isValid: boolean; expandedQuery: string; warnings: string[] };
  countryNames: string[];
  /** The query OpenAlex is asked, after keyword expansion, country focus and the review filter. Null when the query is invalid. */
  finalApiQuery: string | null;
  effectiveFilters: SearchFilters;
  effectiveCitesItemId?: string;
  effectiveRelatedToItemId?: string;
}

/**
 * Everything the search decides before it calls OpenAlex. Pure, so an
 * Evidence Library import can ask OpenAlex exactly what a search asked.
 */
export function prepareOpenAlexSearch(
  params: SearchWithFiltersParams,
  options?: GetSearchResultsWithFiltersOptions
): PreparedOpenAlexSearch {
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
    return { validation, countryNames, finalApiQuery: null, effectiveFilters };
  }

  // Country focus and the review filter add terms to the query itself, in the
  // query's own language: OQL clauses or a classic search string.
  const oql = filters.searchField === OQL_FIELD;
  const appendTerms = (query: string, terms: string) => {
    if (oql) return joinOql(query, [`title/abstract has ${terms}`]);
    return query ? `(${query}) AND ${terms}` : terms;
  };

  let finalApiQuery = validation.expandedQuery;
  if (countryNames.length > 0) {
    const countryTerms = countryNames.map(name => `"${name}"`).join(oql ? ' or ' : ' OR ');
    finalApiQuery = appendTerms(finalApiQuery, `(${countryTerms})`);
  }

  if (filters.reviewFilter) {
    finalApiQuery = appendTerms(
      finalApiQuery,
      oql ? '(review or synthesis or stemmed "meta-analysis")' : '(review OR synthesis OR "meta-analysis")',
    );
  }

  return {
    validation,
    countryNames,
    finalApiQuery,
    effectiveFilters,
    effectiveCitesItemId,
    effectiveRelatedToItemId,
  };
}

export function requestFilters(
  filters: SearchFilters,
  citesItemId: string | undefined,
  relatedToItemId: string | undefined,
): SearchFilters {
  return {
    ...filters,
    citesItemId: citesItemId || filters.citesItemId,
    relatedToItemId: relatedToItemId || filters.relatedToItemId,
  };
}

/**
 * The query and filters a search sends OpenAlex, after keyword expansion,
 * country focus and review terms. Null when the query is not valid.
 */
export function searchRequest(
  params: SearchWithFiltersParams,
): { query: string; filters: SearchFilters } | null {
  const prepared = prepareOpenAlexSearch(params);
  if (prepared.finalApiQuery === null) return null;
  return {
    query: prepared.finalApiQuery,
    filters: requestFilters(prepared.effectiveFilters, prepared.effectiveCitesItemId, prepared.effectiveRelatedToItemId),
  };
}
