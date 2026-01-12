/**
 * Converters between URL params and SearchResult/SearchFilters types
 * 
 * These utilities handle conversion between:
 * 1. URL query params (compact, URL-safe)
 * 2. SearchResult (stored in history)
 * 3. SearchFilters (used for API calls)
 */

import { format, parseISO } from 'date-fns';
import type { SearchResult, SearchFilters, SearchField } from '../types';
import type { ParsedSearchParams } from './parsers';
import { DEFAULT_SEARCH_PARAMS } from './parsers';

/**
 * Convert URL params to a partial SearchResult
 * Used when creating a new history entry from shared URL
 */
export function paramsToSearchResult(params: ParsedSearchParams): Omit<SearchResult, 'id' | 'createdAt' | 'updatedAt' | 'queryHistory' | 'questionHistory' | 'screeningQuestions' | 'screeningResponses'> {
  return {
    query: params.q,
    field: params.field as SearchField,
    sortBy: params.sort,
    count: 0, // Will be updated after search
    
    // Year range
    yearRange: params.yf && params.yt ? [params.yf, params.yt] : undefined,
    isYearRangeEnabled: !!(params.yf || params.yt),
    
    // Date range
    dateRange: params.df || params.dt ? {
      from: params.df ? parseISO(params.df) : undefined,
      to: params.dt ? parseISO(params.dt) : undefined,
    } : undefined,
    filterType: params.ft as 'date' | 'year',
    
    // Rating
    ratingRange: [params.rmin, params.rmax],
    onlyRatedPapers: params.rated,
    
    // Geographic
    selectedRegions: params.reg,
    selectedCountryFocus: params.focus,
    
    // References
    citesItemId: params.cites,
    citedByItemId: params.citedBy,
    relatedToItemId: params.rel,
    
    // Content
    reviewFilter: params.review,
    
    // Language
    language: params.lang || undefined,
  };
}

/**
 * Convert a SearchResult to URL params
 * Used when syncing stored state to URL
 */
export function searchResultToParams(result: SearchResult): Partial<ParsedSearchParams> {
  const params: Partial<ParsedSearchParams> = {
    q: result.query,
    field: result.field,
    sort: result.sortBy || DEFAULT_SEARCH_PARAMS.sort,
    ft: result.filterType || 'year',
  };
  
  // Year range - only include if enabled and different from no filter
  if (result.isYearRangeEnabled && result.yearRange) {
    params.yf = result.yearRange[0];
    params.yt = result.yearRange[1];
  }
  
  // Date range
  if (result.filterType === 'date' && result.dateRange) {
    if (result.dateRange.from) {
      params.df = format(result.dateRange.from, 'yyyy-MM-dd');
    }
    if (result.dateRange.to) {
      params.dt = format(result.dateRange.to, 'yyyy-MM-dd');
    }
  }
  
  // Rating - only include if not default
  if (result.ratingRange && (result.ratingRange[0] !== 0 || result.ratingRange[1] !== 5)) {
    params.rmin = result.ratingRange[0];
    params.rmax = result.ratingRange[1];
  }
  if (result.onlyRatedPapers) {
    params.rated = true;
  }
  
  // Geographic - only include if non-empty
  if (result.selectedRegions && result.selectedRegions.length > 0) {
    params.reg = result.selectedRegions;
  }
  if (result.selectedCountryFocus && result.selectedCountryFocus.length > 0) {
    params.focus = result.selectedCountryFocus;
  }
  
  // References - only include if non-empty
  if (result.citesItemId) {
    params.cites = result.citesItemId;
  }
  if (result.citedByItemId) {
    params.citedBy = result.citedByItemId;
  }
  if (result.relatedToItemId) {
    params.rel = result.relatedToItemId;
  }
  
  // Content
  if (result.reviewFilter) {
    params.review = true;
  }
  
  // Language
  if (result.language) {
    params.lang = result.language;
  }
  
  return params;
}

/**
 * Convert URL params to SearchFilters for API calls
 */
export function paramsToFilters(params: ParsedSearchParams): SearchFilters {
  return {
    searchField: params.field as SearchField,
    sortBy: params.sort,
    filterType: params.ft as 'date' | 'year',
    
    yearRange: params.yf && params.yt ? [params.yf, params.yt] : undefined,
    isYearRangeEnabled: !!(params.yf || params.yt),
    
    dateRange: params.df || params.dt ? {
      from: params.df ? parseISO(params.df) : undefined,
      to: params.dt ? parseISO(params.dt) : undefined,
    } : undefined,
    
    ratingRange: [params.rmin, params.rmax],
    onlyRatedPapers: params.rated,
    
    selectedRegions: params.reg,
    selectedCountryFocus: params.focus,
    
    citesItemId: params.cites,
    citedByItemId: params.citedBy,
    relatedToItemId: params.rel,
    
    reviewFilter: params.review,
  };
}

/**
 * Check if URL params match stored state
 * Returns true if they represent the same search
 */
export function paramsMatchState(params: ParsedSearchParams, state: SearchResult): boolean {
  // Core search
  if (params.q !== state.query) return false;
  if (params.field !== state.field) return false;
  if (params.sort !== (state.sortBy || 'relevance_score:desc')) return false;
  
  // Year range
  const stateYearFrom = state.isYearRangeEnabled && state.yearRange ? state.yearRange[0] : null;
  const stateYearTo = state.isYearRangeEnabled && state.yearRange ? state.yearRange[1] : null;
  if (params.yf !== stateYearFrom || params.yt !== stateYearTo) return false;
  
  // Date range
  const stateDateFrom = state.filterType === 'date' && state.dateRange?.from 
    ? format(state.dateRange.from, 'yyyy-MM-dd') 
    : null;
  const stateDateTo = state.filterType === 'date' && state.dateRange?.to 
    ? format(state.dateRange.to, 'yyyy-MM-dd') 
    : null;
  if (params.df !== stateDateFrom || params.dt !== stateDateTo) return false;
  
  // Filter type
  if (params.ft !== (state.filterType || 'year')) return false;
  
  // Rating
  const stateRatingMin = state.ratingRange?.[0] ?? 0;
  const stateRatingMax = state.ratingRange?.[1] ?? 5;
  if (params.rmin !== stateRatingMin || params.rmax !== stateRatingMax) return false;
  if (params.rated !== (state.onlyRatedPapers ?? false)) return false;
  
  // Geographic
  const stateRegions = state.selectedRegions || [];
  const stateFocus = state.selectedCountryFocus || [];
  if (!arraysEqual(params.reg, stateRegions)) return false;
  if (!arraysEqual(params.focus, stateFocus)) return false;
  
  // References
  if (params.cites !== (state.citesItemId || '')) return false;
  if (params.citedBy !== (state.citedByItemId || '')) return false;
  if (params.rel !== (state.relatedToItemId || '')) return false;
  
  // Content
  if (params.review !== (state.reviewFilter ?? false)) return false;
  
  // Language
  if (params.lang !== (state.language || null)) return false;
  
  return true;
}

/**
 * Helper to compare arrays
 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

/**
 * Check if params have any non-default filters
 */
export function hasActiveFilters(params: ParsedSearchParams): boolean {
  return (
    params.yf !== null ||
    params.yt !== null ||
    params.df !== null ||
    params.dt !== null ||
    params.rmin !== 0 ||
    params.rmax !== 5 ||
    params.rated !== false ||
    params.reg.length > 0 ||
    params.focus.length > 0 ||
    params.cites !== '' ||
    params.citedBy !== '' ||
    params.rel !== '' ||
    params.review !== false
  );
}
