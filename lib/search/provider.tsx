'use client';

/**
 * SearchProvider - Single Source of Truth for Search State
 * 
 * This provider:
 * 1. Reads URL params via nuqs (the source of truth)
 * 2. Provides a single SWR instance for data fetching
 * 3. Shares search state with all child components via context
 * 
 * NO useEffects for syncing - URL is truth, SWR handles caching.
 */

import { createContext, useContext, useMemo, useCallback, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useQueryStates } from 'nuqs';
import { format, parseISO } from 'date-fns';
import useSWR from 'swr';
import { toast } from 'sonner';

import { searchParamsParsers, serializeSearchParams } from '../search-params/parsers';
import { getSearchResultsWithFilters, type SearchWithFiltersParams } from '../search-utils';
import { useSearchHistoryStore } from '../store';
import { useDebounceValue } from '@/hooks/use-debounce-value';
import type { SearchFilters, SearchField } from '../types';
import type { SearchContextValue, SearchParams, SearchResultData } from './types';
import { hasActiveFilters } from './types';

// Create context with undefined default (must be used within provider)
const SearchContext = createContext<SearchContextValue | undefined>(undefined);

interface SearchProviderProps {
  children: ReactNode;
}

/**
 * SearchProvider - Wrap your results pages with this
 */
export function SearchProvider({ children }: SearchProviderProps) {
  const routeParams = useParams<{ searchId: string }>();
  const searchId = routeParams?.searchId ?? '';
  
  // Read URL params via nuqs - THIS IS THE SOURCE OF TRUTH
  const [urlParams, setUrlParams] = useQueryStates(searchParamsParsers, {
    history: 'push',
    shallow: false,
  });
  
  // Get store methods for updating history entry
  const updateSearchResult = useSearchHistoryStore((state) => state.updateSearchResult);
  
  // Create stable params object for debouncing
  // We serialize to string first to get stable reference
  const paramsKey = useMemo(() => JSON.stringify({
    q: urlParams.q,
    field: urlParams.field,
    sort: urlParams.sort,
    yf: urlParams.yf,
    yt: urlParams.yt,
    df: urlParams.df,
    dt: urlParams.dt,
    ft: urlParams.ft,
    reg: urlParams.reg,
    focus: urlParams.focus,
    cites: urlParams.cites,
    citedBy: urlParams.citedBy,
    rel: urlParams.rel,
    review: urlParams.review,
  }), [
    urlParams.q,
    urlParams.field,
    urlParams.sort,
    urlParams.yf,
    urlParams.yt,
    urlParams.df,
    urlParams.dt,
    urlParams.ft,
    urlParams.reg,
    urlParams.focus,
    urlParams.cites,
    urlParams.citedBy,
    urlParams.rel,
    urlParams.review,
  ]);
  
  // Debounce the params key to avoid rapid API calls
  const debouncedKey = useDebounceValue(paramsKey, 300);
  
  // Parse debounced params
  const debouncedParams = useMemo(() => {
    if (!debouncedKey) return null;
    try {
      return JSON.parse(debouncedKey);
    } catch {
      return null;
    }
  }, [debouncedKey]);
  
  // Build SWR key - null means don't fetch
  const swrKey = useMemo(() => {
    if (!debouncedParams) return null;
    
    // Need either a query or active filters to fetch
    const hasQuery = debouncedParams.q && debouncedParams.q.trim() !== '';
    if (!hasQuery && !hasActiveFilters(debouncedParams)) return null;
    
    // Return a stable array key
    return ['search', debouncedKey] as const;
  }, [debouncedParams, debouncedKey]);
  
  // Single SWR fetcher - all data comes from the key
  const fetcher = useCallback(async ([, paramsJson]: readonly [string, string]) => {
    const params = JSON.parse(paramsJson);
    
    // Auto-switch from relevance sorting if no query
    let effectiveSortBy = params.sort;
    if (params.sort === 'relevance_score:desc' && (!params.q || params.q.trim() === '')) {
      effectiveSortBy = 'publication_date:desc';
    }
    
    // Build SearchFilters object for the API
    const filters: SearchFilters = {
      searchField: params.field as SearchField,
      sortBy: effectiveSortBy,
      filterType: params.ft as 'date' | 'year',
      yearRange: params.yf && params.yt ? [params.yf, params.yt] : undefined,
      isYearRangeEnabled: !!(params.yf || params.yt),
      dateRange: params.df || params.dt ? {
        from: params.df ? parseISO(params.df) : undefined,
        to: params.dt ? parseISO(params.dt) : undefined,
      } : undefined,
      ratingRange: undefined, // Handled client-side
      onlyRatedPapers: undefined,
      selectedRegions: params.reg || [],
      selectedCountryFocus: params.focus || [],
      citesItemId: params.cites || '',
      citedByItemId: params.citedBy || '',
      relatedToItemId: params.rel || '',
      reviewFilter: params.review || false,
    };
    
    const searchParams: SearchWithFiltersParams = {
      query: params.q || '',
      filters,
    };
    
    return getSearchResultsWithFilters(searchParams);
  }, []);
  
  // Single SWR instance
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    swrKey,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      dedupingInterval: 5000,
      keepPreviousData: true,
      errorRetryCount: 2,
      errorRetryInterval: 1000,
      onSuccess: (data) => {
        // Update history entry with result count
        if (data?.results?.meta?.count !== undefined && searchId) {
          updateSearchResult(searchId, { count: data.results.meta.count });
        }
      },
      onError: (err) => {
        console.error('Search failed:', err);
        const message = err?.message || '';
        
        if (message.includes('400')) {
          toast.error('Search query too large', {
            description: 'Please try simplifying your search.',
          });
        } else if (message.includes('429')) {
          toast.error('Too many requests', {
            description: 'Please wait a moment before trying again.',
          });
        } else {
          toast.error('Search failed', {
            description: 'An unexpected error occurred.',
          });
        }
      },
    }
  );
  
  // Param setters - just update URL, SWR auto-refetches
  const setQuery = useCallback((q: string) => setUrlParams({ q }), [setUrlParams]);
  const setField = useCallback((field: SearchField) => setUrlParams({ field }), [setUrlParams]);
  const setSort = useCallback((sort: string) => setUrlParams({ sort }), [setUrlParams]);
  const setPage = useCallback((page: number) => setUrlParams({ page }), [setUrlParams]);
  
  const setYearRange = useCallback((from: number | null, to: number | null) => {
    setUrlParams({ yf: from, yt: to, ft: 'year' });
  }, [setUrlParams]);
  
  const setDateRange = useCallback((from: Date | null, to: Date | null) => {
    setUrlParams({
      df: from ? format(from, 'yyyy-MM-dd') : null,
      dt: to ? format(to, 'yyyy-MM-dd') : null,
      ft: 'date',
    });
  }, [setUrlParams]);
  
  const setFilterType = useCallback((type: 'year' | 'date') => {
    setUrlParams({ ft: type });
  }, [setUrlParams]);
  
  const setRatingRange = useCallback((min: number, max: number) => {
    setUrlParams({ rmin: min, rmax: max });
  }, [setUrlParams]);
  
  const setOnlyRated = useCallback((value: boolean) => {
    setUrlParams({ rated: value });
  }, [setUrlParams]);
  
  const setRegions = useCallback((regions: string[]) => {
    setUrlParams({ reg: regions });
  }, [setUrlParams]);
  
  const setCountryFocus = useCallback((countries: string[]) => {
    setUrlParams({ focus: countries });
  }, [setUrlParams]);
  
  const setCites = useCallback((id: string) => {
    setUrlParams({ cites: id });
  }, [setUrlParams]);
  
  const setCitedBy = useCallback((id: string) => {
    setUrlParams({ citedBy: id });
  }, [setUrlParams]);
  
  const setRelatedTo = useCallback((id: string) => {
    setUrlParams({ rel: id });
  }, [setUrlParams]);
  
  const setReviewOnly = useCallback((value: boolean) => {
    setUrlParams({ review: value });
  }, [setUrlParams]);
  
  const setLanguage = useCallback((lang: string | null) => {
    setUrlParams({ lang });
  }, [setUrlParams]);
  
  // Bulk update
  const updateParams = useCallback((updates: Partial<SearchParams>) => {
    setUrlParams(updates as any);
  }, [setUrlParams]);
  
  // Reset filters to defaults
  const resetFilters = useCallback(() => {
    setUrlParams({
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
    });
  }, [setUrlParams]);
  
  // Get shareable URL - pass base URL to serializer to avoid double ?
  const getShareableUrl = useCallback(() => {
    if (typeof window === 'undefined') return '';
    const baseUrl = `${window.location.origin}/results/${searchId}`;
    return serializeSearchParams(baseUrl, urlParams);
  }, [searchId, urlParams]);
  
  // Convert URL params to SearchFilters for external use
  const toSearchFilters = useCallback((): SearchFilters => ({
    searchField: urlParams.field as SearchField,
    sortBy: urlParams.sort,
    filterType: urlParams.ft as 'date' | 'year',
    yearRange: urlParams.yf && urlParams.yt ? [urlParams.yf, urlParams.yt] : undefined,
    isYearRangeEnabled: !!(urlParams.yf || urlParams.yt),
    dateRange: urlParams.df || urlParams.dt ? {
      from: urlParams.df ? new Date(urlParams.df) : undefined,
      to: urlParams.dt ? new Date(urlParams.dt) : undefined,
    } : undefined,
    ratingRange: [urlParams.rmin, urlParams.rmax],
    onlyRatedPapers: urlParams.rated,
    selectedRegions: urlParams.reg,
    selectedCountryFocus: urlParams.focus,
    citesItemId: urlParams.cites,
    citedByItemId: urlParams.citedBy,
    relatedToItemId: urlParams.rel,
    reviewFilter: urlParams.review,
  }), [urlParams]);
  
  // Build context value
  const value: SearchContextValue = useMemo(() => ({
    searchId,
    
    params: urlParams as SearchParams,
    
    // Results
    results: data?.results?.results || [],
    totalCount: data?.results?.meta?.count || 0,
    apiUrl: data?.results?.meta?.url || '',
    originalQuery: data?.originalQuery || '',
    enhancedQuery: data?.enhancedQuery || '',
    countryNames: data?.countryNames || [],
    validation: data?.validation || { isValid: true, expandedQuery: '', warnings: [] },
    
    // Loading states
    isLoading,
    isValidating,
    error: error || null,
    
    // Setters
    setQuery,
    setField,
    setSort,
    setPage,
    setYearRange,
    setDateRange,
    setFilterType,
    setRatingRange,
    setOnlyRated,
    setRegions,
    setCountryFocus,
    setCites,
    setCitedBy,
    setRelatedTo,
    setReviewOnly,
    setLanguage,
    
    // Bulk operations
    updateParams,
    resetFilters,
    
    // Utilities
    getShareableUrl,
    toSearchFilters,
    mutate: () => mutate(),
  }), [
    searchId,
    urlParams,
    data,
    isLoading,
    isValidating,
    error,
    setQuery,
    setField,
    setSort,
    setPage,
    setYearRange,
    setDateRange,
    setFilterType,
    setRatingRange,
    setOnlyRated,
    setRegions,
    setCountryFocus,
    setCites,
    setCitedBy,
    setRelatedTo,
    setReviewOnly,
    setLanguage,
    updateParams,
    resetFilters,
    getShareableUrl,
    toSearchFilters,
    mutate,
  ]);
  
  return (
    <SearchContext.Provider value={value}>
      {children}
    </SearchContext.Provider>
  );
}

/**
 * useSearch - Access search state from any component under SearchProvider
 * 
 * @throws Error if used outside of SearchProvider
 */
export function useSearch(): SearchContextValue {
  const context = useContext(SearchContext);
  if (context === undefined) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
}

/**
 * useSearchOptional - Access search state, returns undefined if outside provider
 * 
 * Useful for components that may or may not be under a SearchProvider
 */
export function useSearchOptional(): SearchContextValue | undefined {
  return useContext(SearchContext);
}
