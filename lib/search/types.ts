/**
 * Search Module Types
 * 
 * Clean type definitions for the URL-based search state management.
 * URL params are the source of truth; store is just for history.
 * 
 * NOTE: DEFAULT_SEARCH_PARAMS and hasActiveFilters are defined in lib/search-params
 * to avoid duplication. Re-exported from lib/search/index.ts for convenience.
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
  area: string[];         // research area catalog ids
  sdg: string[];          // sustainable development goals
  oa: boolean;            // open access only
  type: string[];         // OpenAlex work types
  wlang: string[];        // languages the works are written in
  itype: string[];        // author institution types
  funder: string[];       // OpenAlex funder ids
  author: string[];       // OpenAlex author ids, or names OpenAlex has no author record for
  mincite: number | null; // minimum citations
  abs: boolean;           // only works with an abstract
  retracted: boolean;     // include retracted works
  lang: string | null;
}

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

export interface SetQueryOptions {
  /** A preview from the query history, which does not add an entry. */
  skipHistory?: boolean;
  /** The scope a query-history entry ran in. */
  field?: SearchField;
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
  /** An OQL search's full request, filters included. OQL cannot be written as `apiUrl`. */
  oql: string | null;
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
  setQuery: (q: string, options?: SetQueryOptions) => void;
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
