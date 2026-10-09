import { OQL_FIELD, joinOql } from './openalex/oql';
import { SEMANTIC_FIELD } from './openalex/semantic';
import { isCitesFilterActive, isRelatedToFilterActive, isDateFilterActive } from './utils';
import { countryFocusNames, OQL_REVIEW_TERMS, REVIEW_TERMS } from './search/focus-terms';
import { validateAndExpandKeywords, type ExpandShortcuts } from './keyword-validation';
import type { SearchFilters, SearchField } from './types';

export interface SearchWithFiltersParams {
  query: string;
  filters: SearchFilters;
}

export interface GetSearchResultsWithFiltersOptions {
  /** Expands the query's shortcuts: `browserExpand` in the browser, the account's records on the server. */
  expand: ExpandShortcuts;
  getMessage?: (key: string, params?: Record<string, string>) => string;
  onWarning?: (message: string) => void;
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
  options: GetSearchResultsWithFiltersOptions
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

  // A question by meaning goes as typed: keyword expansion, country focus and review terms are a keyword search's.
  if (filters.searchField === SEMANTIC_FIELD) {
    const question = query.trim();
    return {
      validation: { isValid: true, expandedQuery: question, warnings: [] },
      countryNames: [],
      finalApiQuery: question,
      effectiveFilters,
      effectiveCitesItemId,
      effectiveRelatedToItemId,
    };
  }

  const countryNames = countryFocusNames(filters.selectedCountryFocus);

  // Validate and expand keywords on the original query first
  const validation = validateAndExpandKeywords(query, options.expand, {
    getMessage: options.getMessage,
    onWarning: options.onWarning,
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
      oql ? OQL_REVIEW_TERMS : REVIEW_TERMS,
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
