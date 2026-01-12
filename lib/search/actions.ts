/**
 * Search Actions
 * 
 * Explicit actions for search operations.
 * These are the only places that write to the history store.
 */

import { useSearchHistoryStore } from '../store';
import type { SearchFilters, SearchField } from '../types';

/**
 * Build URL params from query and filters
 */
function buildSearchParams(query: string, filters: SearchFilters): Record<string, any> {
  const params: Record<string, any> = {
    q: query,
    field: filters.searchField,
    sort: filters.sortBy || 'relevance_score:desc',
    ft: filters.filterType || 'year',
  };
  
  // Year range
  if (filters.isYearRangeEnabled && filters.yearRange) {
    params.yf = filters.yearRange[0];
    params.yt = filters.yearRange[1];
  }
  
  // Date range
  if (filters.filterType === 'date' && filters.dateRange) {
    if (filters.dateRange.from) {
      params.df = filters.dateRange.from instanceof Date
        ? filters.dateRange.from.toISOString().split('T')[0]
        : filters.dateRange.from;
    }
    if (filters.dateRange.to) {
      params.dt = filters.dateRange.to instanceof Date
        ? filters.dateRange.to.toISOString().split('T')[0]
        : filters.dateRange.to;
    }
  }
  
  // Rating range (only if not default)
  if (filters.ratingRange && (filters.ratingRange[0] !== 0 || filters.ratingRange[1] !== 5)) {
    params.rmin = filters.ratingRange[0];
    params.rmax = filters.ratingRange[1];
  }
  
  if (filters.onlyRatedPapers) params.rated = true;
  if (filters.selectedRegions?.length > 0) params.reg = filters.selectedRegions;
  if (filters.selectedCountryFocus?.length > 0) params.focus = filters.selectedCountryFocus;
  if (filters.citesItemId) params.cites = filters.citesItemId;
  if (filters.citedByItemId) params.citedBy = filters.citedByItemId;
  if (filters.relatedToItemId) params.rel = filters.relatedToItemId;
  if (filters.reviewFilter) params.review = true;
  
  return params;
}

/**
 * Build URL query string from params object
 */
function serializeParams(params: Record<string, any>): string {
  const searchParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (value === false) return;
    if (value === '') return;
    if (Array.isArray(value)) {
      if (value.length > 0) {
        searchParams.set(key, value.join(','));
      }
    } else {
      searchParams.set(key, String(value));
    }
  });
  
  return searchParams.toString();
}

export interface SubmitSearchResult {
  id: string;
  url: string;
}

/**
 * Submit a new search from the home page
 * 
 * Creates a new history entry and returns the URL to navigate to.
 * Call router.push(result.url) after this.
 */
export function submitNewSearch(
  query: string,
  filters: SearchFilters,
  researchQuestion?: string
): SubmitSearchResult {
  const { addSearchResult } = useSearchHistoryStore.getState();
  
  // Create history entry
  const entry = {
    query,
    field: filters.searchField,
    count: 0,
    sortBy: filters.sortBy,
    filterType: filters.filterType,
    yearRange: filters.yearRange,
    isYearRangeEnabled: filters.isYearRangeEnabled,
    dateRange: filters.dateRange,
    ratingRange: filters.ratingRange,
    onlyRatedPapers: filters.onlyRatedPapers,
    selectedRegions: filters.selectedRegions,
    selectedCountryFocus: filters.selectedCountryFocus,
    citesItemId: filters.citesItemId,
    citedByItemId: filters.citedByItemId,
    relatedToItemId: filters.relatedToItemId,
    reviewFilter: filters.reviewFilter,
    // Include question history if provided
    ...(researchQuestion ? {
      questionHistory: [{
        question: researchQuestion,
        timestamp: new Date().toISOString(),
      }],
    } : {}),
  };
  
  const id = addSearchResult(entry);
  
  // Build URL with params
  const params = buildSearchParams(query, filters);
  const queryString = serializeParams(params);
  
  return {
    id,
    url: `/results/${id}?${queryString}`,
  };
}

/**
 * Restore a search from history
 * 
 * Returns the URL to navigate to for viewing an existing search.
 */
export function restoreFromHistory(entry: {
  id: string;
  query: string;
  field?: SearchField;
  sortBy?: string;
  filterType?: 'date' | 'year';
  yearRange?: [number, number];
  isYearRangeEnabled?: boolean;
  dateRange?: { from?: Date; to?: Date };
  ratingRange?: [number, number];
  onlyRatedPapers?: boolean;
  selectedRegions?: string[];
  selectedCountryFocus?: string[];
  citesItemId?: string;
  citedByItemId?: string;
  relatedToItemId?: string;
  reviewFilter?: boolean;
}): string {
  const params: Record<string, any> = {
    q: entry.query || '',
    field: entry.field || 'title_and_abstract',
    sort: entry.sortBy || 'relevance_score:desc',
    ft: entry.filterType || 'year',
  };
  
  // Year range
  if (entry.isYearRangeEnabled && entry.yearRange) {
    params.yf = entry.yearRange[0];
    params.yt = entry.yearRange[1];
  }
  
  // Date range
  if (entry.filterType === 'date' && entry.dateRange) {
    if (entry.dateRange.from) {
      params.df = entry.dateRange.from instanceof Date
        ? entry.dateRange.from.toISOString().split('T')[0]
        : entry.dateRange.from;
    }
    if (entry.dateRange.to) {
      params.dt = entry.dateRange.to instanceof Date
        ? entry.dateRange.to.toISOString().split('T')[0]
        : entry.dateRange.to;
    }
  }
  
  // Other filters
  if (entry.ratingRange && (entry.ratingRange[0] !== 0 || entry.ratingRange[1] !== 5)) {
    params.rmin = entry.ratingRange[0];
    params.rmax = entry.ratingRange[1];
  }
  
  if (entry.onlyRatedPapers) params.rated = true;
  if (entry.selectedRegions?.length) params.reg = entry.selectedRegions;
  if (entry.selectedCountryFocus?.length) params.focus = entry.selectedCountryFocus;
  if (entry.citesItemId) params.cites = entry.citesItemId;
  if (entry.citedByItemId) params.citedBy = entry.citedByItemId;
  if (entry.relatedToItemId) params.rel = entry.relatedToItemId;
  if (entry.reviewFilter) params.review = true;
  
  const queryString = serializeParams(params);
  return `/results/${entry.id}?${queryString}`;
}

/**
 * Create a "cites" or "cited by" search from an existing paper
 * 
 * Creates a new history entry and returns the URL.
 */
export function createCitationSearch(
  paperId: string,
  type: 'cites' | 'citedBy',
  currentSearchField?: SearchField
): SubmitSearchResult {
  const { addSearchResult } = useSearchHistoryStore.getState();
  
  const entry = {
    query: '',
    field: currentSearchField || 'title_and_abstract',
    count: 0,
    sortBy: 'publication_date:desc', // Default to newest first for citation searches
    filterType: 'year' as const,
    selectedRegions: [],
    selectedCountryFocus: [],
    citesItemId: type === 'cites' ? paperId : '',
    citedByItemId: type === 'citedBy' ? paperId : '',
    relatedToItemId: '',
    reviewFilter: false,
  };
  
  const id = addSearchResult(entry);
  
  const params: Record<string, any> = {
    field: entry.field,
    sort: entry.sortBy,
    ft: 'year',
    [type]: paperId,
  };
  
  const queryString = serializeParams(params);
  
  return {
    id,
    url: `/results/${id}?${queryString}`,
  };
}
