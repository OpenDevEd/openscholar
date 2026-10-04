/**
 * Converters between URL params and SearchResult/SearchFilters types
 * 
 * These utilities handle conversion between:
 * 1. URL query params (compact, URL-safe)
 * 2. SearchResult (stored in history)
 * 3. SearchFilters (used for API calls)
 */

import { format, parseISO } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import type { SearchResult, SearchFilters, SearchField } from '../types';
import { OQL_FIELD } from '../openalex/oql';
import type { ParsedSearchParams } from './parsers';
import { DEFAULT_SEARCH_PARAMS } from './parsers';
import { sanitizeSelection } from './sanitize';

/**
 * Type for what addSearchResult expects (required fields for new history entries)
 * Uses DateRange from react-day-picker for compatibility with SearchResult
 */
export type NewSearchResultData = {
  query: string;
  field: SearchField;
  count: number;
  sortBy?: string;
  yearRange?: [number, number];
  isYearRangeEnabled?: boolean;
  dateRange?: DateRange;
  filterType?: 'date' | 'year';
  ratingRange?: [number, number];
  onlyRatedPapers?: boolean;
  selectedRegions?: string[];
  selectedCountryFocus?: string[];
  citesItemId?: string;
  citedByItemId?: string;
  relatedToItemId?: string;
  reviewFilter?: boolean;
  researchAreas?: string[];
  sdgs?: string[];
  openAccessOnly?: boolean;
  workTypes?: string[];
  workLanguages?: string[];
  institutionTypes?: string[];
  funders?: string[];
  authors?: string[];
  minCitations?: number;
  hasAbstract?: boolean;
  includeRetracted?: boolean;
  language?: string;
  page?: number;
};

/**
 * Convert URL params to SearchResult data
 * Used when creating a new history entry from shared URL
 * Returns object with required fields (query, field, count) always defined
 */
export function paramsToSearchResult(params: ParsedSearchParams): NewSearchResultData {
  // Build date range only if we have at least one date
  let dateRange: DateRange | undefined;
  if (params.df || params.dt) {
    dateRange = {
      from: params.df ? parseISO(params.df) : undefined,
      to: params.dt ? parseISO(params.dt) : undefined,
    };
  }

  return {
    query: params.q ?? '',
    field: (params.field ?? 'title_and_abstract') as SearchField,
    count: 0, // Will be updated after search
    sortBy: params.sort,
    
    // Year range
    yearRange: params.yf && params.yt ? [params.yf, params.yt] : undefined,
    isYearRangeEnabled: !!(params.yf || params.yt),
    
    // Date range
    dateRange,
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
    researchAreas: params.area,
    sdgs: params.sdg,
    openAccessOnly: params.oa,
    workTypes: params.type,
    workLanguages: params.wlang,
    institutionTypes: params.itype,
    funders: params.funder,
    authors: params.author,
    minCitations: params.mincite ?? undefined,
    hasAbstract: params.abs,
    includeRetracted: params.retracted,
    
    // Language
    language: params.lang || undefined,
    
    // Pagination
    page: params.page,
  };
}

/**
 * Convert a SearchResult to URL params
 * Used when syncing stored state to URL
 */
export function searchResultToParams(result: Partial<SearchResult>): Partial<ParsedSearchParams> {
  const params: Partial<ParsedSearchParams> = {
    q: result.query || '',
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
  
  // Geographic - sanitize (trim + drop empty) then only include if non-empty
  const selectedRegions = sanitizeSelection(result.selectedRegions);
  if (selectedRegions.length > 0) {
    params.reg = selectedRegions;
  }
  const selectedCountryFocus = sanitizeSelection(result.selectedCountryFocus);
  if (selectedCountryFocus.length > 0) {
    params.focus = selectedCountryFocus;
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
  if (result.researchAreas?.length) params.area = result.researchAreas;
  if (result.sdgs?.length) params.sdg = result.sdgs;
  if (result.openAccessOnly) params.oa = true;
  if (result.workTypes?.length) params.type = result.workTypes;
  if (result.workLanguages?.length) params.wlang = result.workLanguages;
  if (result.institutionTypes?.length) params.itype = result.institutionTypes;
  if (result.funders?.length) params.funder = result.funders;
  if (result.authors?.length) params.author = result.authors;
  if (result.minCitations) params.mincite = result.minCitations;
  if (result.hasAbstract) params.abs = true;
  if (result.includeRetracted) params.retracted = true;
  
  // Language
  if (result.language) {
    params.lang = result.language;
  }
  
  // Pagination - only include if not on first page
  if (result.page && result.page > 1) {
    params.page = result.page;
  }
  
  return params;
}

/**
 * Relevance needs a text search, so a search without one is sorted newest first.
 * An OQL query searches text only through a `has` or `is similar to` clause;
 * country focus and the review filter add one.
 */
export function effectiveSort(
  params: Pick<ParsedSearchParams, 'q' | 'sort' | 'field' | 'review' | 'focus'>,
): string {
  const searchesText = params.field === OQL_FIELD
    ? /\b(has|is similar to)\b/i.test(params.q) || params.review || params.focus.length > 0
    : Boolean(params.q.trim());
  return params.sort === 'relevance_score:desc' && !searchesText ? 'publication_date:desc' : params.sort;
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
    researchAreas: params.area,
    sdgs: params.sdg,
    openAccessOnly: params.oa,
    workTypes: params.type,
    workLanguages: params.wlang,
    institutionTypes: params.itype,
    funders: params.funder,
    authors: params.author,
    minCitations: params.mincite,
    hasAbstract: params.abs,
    includeRetracted: params.retracted,
  };
}

/**
 * Helper to compare arrays
 */
function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
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
  if (!arraysEqual(params.area, state.researchAreas ?? [])) return false;
  if (!arraysEqual(params.sdg, state.sdgs ?? [])) return false;
  if (params.oa !== (state.openAccessOnly ?? false)) return false;
  if (!arraysEqual(params.type, state.workTypes ?? [])) return false;
  if (!arraysEqual(params.wlang, state.workLanguages ?? [])) return false;
  if (!arraysEqual(params.itype, state.institutionTypes ?? [])) return false;
  if (!arraysEqual(params.funder, state.funders ?? [])) return false;
  if (!arraysEqual(params.author, state.authors ?? [])) return false;
  if (params.mincite !== (state.minCitations ?? null)) return false;
  if (params.abs !== (state.hasAbstract ?? false)) return false;
  if (params.retracted !== (state.includeRetracted ?? false)) return false;
  
  // Language
  if (params.lang !== (state.language || null)) return false;
  
  return true;
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
    params.review !== false ||
    params.area.length > 0 ||
    params.sdg.length > 0 ||
    params.oa ||
    params.type.length > 0 ||
    params.wlang.length > 0 ||
    params.itype.length > 0 ||
    params.funder.length > 0 ||
    params.author.length > 0 ||
    params.mincite !== null ||
    params.abs ||
    params.retracted
  );
}
