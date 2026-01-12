/**
 * Search Module Types
 * 
 * Clean type definitions for the URL-based search state management.
 * URL params are the source of truth; store is just for history.
 */

import type { SearchField, SearchFilters, PaperResult } from '../types';

/**
 * Parsed URL search parameters
 * These map directly to URL query params
 */
export interface SearchParams {
  q: string;
  field: string;
  sort: string;
  page: number;
  yf: number | null;      // yearFrom
  yt: number | null;      // yearTo
  df: string | null;      // dateFrom (ISO string)
  dt: string | null;      // dateTo (ISO string)
  ft: string;             // filterType: 'year' | 'date'
  rmin: number;           // ratingMin
  rmax: number;           // ratingMax
  rated: boolean;         // onlyRated
  reg: string[];          // regions
  focus: string[];        // countryFocus
  cites: string;
  citedBy: string;
  rel: string;            // relatedTo
  review: boolean;        // reviewOnly
  lang: string | null;
}

/**
 * Default values for search params
 */
export const DEFAULT_SEARCH_PARAMS: SearchParams = {
  q: '',
  field: 'title_and_abstract',
  sort: 'relevance_score:desc',
  page: 1,
  yf: null,
  yt: null,
  df: null,
  dt: null,
  ft: 'year',
  rmin: 0,
  rmax: 5,
  rated: false,
  reg: [],
  focus: [],
  cites: '',
  citedBy: '',
  rel: '',
  review: false,
  lang: null,
};

/**
 * Search results from the API
 */
export interface SearchResultData {
  results: PaperResult[];
  totalCount: number;
  apiUrl: string;
  originalQuery: string;
  enhancedQuery: string;
  countryNames: string[];
  validation: {
    isValid: boolean;
    expandedQuery: string;
    warnings: string[];
  };
}

/**
 * The complete search context value
 */
export interface SearchContextValue {
  // Search ID (reference to history entry)
  searchId: string;
  
  // Current params from URL (source of truth)
  params: SearchParams;
  
  // Results from SWR
  results: PaperResult[];
  totalCount: number;
  apiUrl: string;
  originalQuery: string;
  enhancedQuery: string;
  countryNames: string[];
  validation: {
    isValid: boolean;
    expandedQuery: string;
    warnings: string[];
  };
  
  // Loading states
  isLoading: boolean;
  isValidating: boolean;
  error: Error | null;
  
  // Param setters (update URL → SWR auto-refetches)
  setQuery: (q: string) => void;
  setField: (field: SearchField) => void;
  setSort: (sort: string) => void;
  setPage: (page: number) => void;
  setYearRange: (from: number | null, to: number | null) => void;
  setDateRange: (from: Date | null, to: Date | null) => void;
  setFilterType: (type: 'year' | 'date') => void;
  setRatingRange: (min: number, max: number) => void;
  setOnlyRated: (value: boolean) => void;
  setRegions: (regions: string[]) => void;
  setCountryFocus: (countries: string[]) => void;
  setCites: (id: string) => void;
  setCitedBy: (id: string) => void;
  setRelatedTo: (id: string) => void;
  setReviewOnly: (value: boolean) => void;
  setLanguage: (lang: string | null) => void;
  
  // Bulk operations
  updateParams: (updates: Partial<SearchParams>) => void;
  resetFilters: () => void;
  
  // Utilities
  getShareableUrl: () => string;
  toSearchFilters: () => SearchFilters;
  mutate: () => void;
}

/**
 * Check if params have any non-default filter values
 */
export function hasActiveFilters(params: Partial<SearchParams>): boolean {
  return (
    (params.yf !== null && params.yf !== undefined) ||
    (params.yt !== null && params.yt !== undefined) ||
    (params.df !== null && params.df !== undefined) ||
    (params.dt !== null && params.dt !== undefined) ||
    (params.rmin !== undefined && params.rmin !== 0) ||
    (params.rmax !== undefined && params.rmax !== 5) ||
    params.rated === true ||
    (params.reg !== undefined && params.reg.length > 0) ||
    (params.focus !== undefined && params.focus.length > 0) ||
    (params.cites !== undefined && params.cites !== '') ||
    (params.citedBy !== undefined && params.citedBy !== '') ||
    (params.rel !== undefined && params.rel !== '') ||
    params.review === true
  );
}

/**
 * Check if URL has any meaningful search params (query or filters)
 */
export function hasSearchParams(params: Partial<SearchParams>): boolean {
  const hasQuery = params.q !== undefined && params.q !== '';
  return hasQuery || hasActiveFilters(params);
}
