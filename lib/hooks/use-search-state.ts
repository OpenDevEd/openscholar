'use client';

/**
 * useSearchState - Hybrid URL + Store State Hook
 * 
 * This is the main hook for managing search state. It provides:
 * 
 * 1. URL query params as the source of truth (shareable)
 * 2. Automatic sync with localStorage for history persistence
 * 3. Reconciliation logic for handling shared URLs
 * 
 * Behavior:
 * - Unknown ID + has params → Create new entry with new ID, redirect
 * - Known ID + params differ → Update stored state to match URL params
 * - Known ID + no params → Populate URL from stored state
 * - Known ID + matching params → In sync, do nothing
 */

import { useEffect, useLayoutEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQueryStates } from 'nuqs';
import { format, parseISO } from 'date-fns';
import useSWR from 'swr';
import { toast } from 'sonner';

import { 
  searchParamsParsers, 
  serializeSearchParams,
  paramsToSearchResult,
  searchResultToParams,
  paramsMatchState,
  hasActiveFilters,
  type ParsedSearchParams,
} from '../search-params';
import { useSearchHistoryStore } from '../store';
import type { SearchFilters, SearchField } from '../types';
import { useDebounceValue } from '@/hooks/use-debounce-value';
import { getSearchResultsWithFilters, type SearchWithFiltersParams } from '../search-utils';

// Reconciliation states
type ReconciliationState = 'pending' | 'reconciling' | 'done';

export interface UseSearchStateReturn {
  // Current search ID (from URL path)
  searchId: string | undefined;
  
  // Current params from URL
  query: string;
  field: string;
  sort: string;
  page: number;
  yearFrom: number | null;
  yearTo: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  filterType: string;
  ratingMin: number;
  ratingMax: number;
  onlyRated: boolean;
  regions: string[];
  countryFocus: string[];
  cites: string;
  citedBy: string;
  relatedTo: string;
  reviewOnly: boolean;
  language: string | null;
  
  // State flags
  isInitialized: boolean;
  isReconciling: boolean;
  
  // Setters - update URL and sync to store
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
  updateParams: (updates: Partial<ParsedSearchParams>) => void;
  resetFilters: () => void;
  
  // Utilities
  getShareableUrl: () => string;
  toSearchFilters: () => SearchFilters;
}

export function useSearchState(): UseSearchStateReturn {
  const router = useRouter();
  const params = useParams<{ searchId?: string }>();
  const searchId = params?.searchId;
  
  // Reconciliation state machine
  const [reconciliationState, setReconciliationState] = useState<ReconciliationState>('pending');
  const prevSearchIdRef = useRef<string | undefined>(undefined);
  const reconciliationInProgress = useRef(false);
  
  // Get URL params with nuqs
  const [urlParams, setUrlParams] = useQueryStates(searchParamsParsers, {
    history: 'push',
    shallow: false,
  });
  
  // Store access - get stable references
  const getSearchResult = useSearchHistoryStore((state) => state.getSearchResult);
  const addSearchResult = useSearchHistoryStore((state) => state.addSearchResult);
  const updateSearchResult = useSearchHistoryStore((state) => state.updateSearchResult);
  
  // Reset reconciliation state when searchId changes
  useEffect(() => {
    if (prevSearchIdRef.current !== searchId) {
      prevSearchIdRef.current = searchId;
      setReconciliationState('pending');
      reconciliationInProgress.current = false;
    }
  }, [searchId]);
  
  // Reconciliation: sync URL params with stored state on mount
  // Using useLayoutEffect for synchronous execution before render
  useLayoutEffect(() => {
    // Guard: only run when pending and not already in progress
    if (reconciliationState !== 'pending' || !searchId || reconciliationInProgress.current) {
      return;
    }
    
    // Mark as in progress immediately to prevent re-entry
    reconciliationInProgress.current = true;
    setReconciliationState('reconciling');
    
    const storedSearch = getSearchResult(searchId);
    
    // Check if URL has any meaningful params (query OR active filters)
    const hasAnyUrlParams = urlParams.q !== '' || hasActiveFilters(urlParams);
    
    // Case 1: Unknown ID but has URL params → Create new entry with new ID
    if (!storedSearch && hasAnyUrlParams) {
      const newState = paramsToSearchResult(urlParams);
      const newId = addSearchResult(newState);
      
      // Build query string from current params
      const queryString = serializeSearchParams(urlParams);
      
      // Use replace to avoid back button issues
      router.replace(`/results/${newId}?${queryString}`);
      setReconciliationState('done');
      return;
    }
    
    // Case 2: Known ID but params differ → Update stored state to match URL
    if (storedSearch && hasAnyUrlParams && !paramsMatchState(urlParams, storedSearch)) {
      const updatedState = paramsToSearchResult(urlParams);
      updateSearchResult(searchId, updatedState);
      setReconciliationState('done');
      return;
    }
    
    // Case 3: Known ID with no/empty URL params → Populate URL from stored state
    if (storedSearch && !hasAnyUrlParams) {
      const stateParams = searchResultToParams(storedSearch);
      const queryString = serializeSearchParams(stateParams);
      router.replace(`/results/${searchId}?${queryString}`);
      setReconciliationState('done');
      return;
    }
    
    // Case 4: Known ID with matching params → Already in sync
    // Case 5: Unknown ID with no params → Nothing to do (will show empty state)
    setReconciliationState('done');
  }, [searchId, reconciliationState]); // Minimal dependencies - urlParams read inside
  
  // Helper to update both URL and store
  const updateParamsAndStore = useCallback((updates: Partial<ParsedSearchParams>) => {
    // Update URL
    setUrlParams(updates);
    
    // Also update store for persistence
    if (searchId) {
      const currentSearch = getSearchResult(searchId);
      if (currentSearch) {
        // Map URL param names to store field names
        const storeUpdates: Record<string, unknown> = {};
        
        if ('q' in updates) storeUpdates.query = updates.q;
        if ('field' in updates) storeUpdates.field = updates.field;
        if ('sort' in updates) storeUpdates.sortBy = updates.sort;
        if ('yf' in updates || 'yt' in updates) {
          const yf = updates.yf ?? urlParams.yf;
          const yt = updates.yt ?? urlParams.yt;
          storeUpdates.yearRange = yf && yt ? [yf, yt] : undefined;
          storeUpdates.isYearRangeEnabled = !!(yf || yt);
        }
        if ('df' in updates || 'dt' in updates) {
          storeUpdates.dateRange = {
            from: updates.df ? new Date(updates.df) : undefined,
            to: updates.dt ? new Date(updates.dt) : undefined,
          };
        }
        if ('ft' in updates) storeUpdates.filterType = updates.ft;
        if ('rmin' in updates || 'rmax' in updates) {
          storeUpdates.ratingRange = [
            updates.rmin ?? urlParams.rmin,
            updates.rmax ?? urlParams.rmax,
          ];
        }
        if ('rated' in updates) storeUpdates.onlyRatedPapers = updates.rated;
        if ('reg' in updates) storeUpdates.selectedRegions = updates.reg;
        if ('focus' in updates) storeUpdates.selectedCountryFocus = updates.focus;
        if ('cites' in updates) storeUpdates.citesItemId = updates.cites;
        if ('citedBy' in updates) storeUpdates.citedByItemId = updates.citedBy;
        if ('rel' in updates) storeUpdates.relatedToItemId = updates.rel;
        if ('review' in updates) storeUpdates.reviewFilter = updates.review;
        if ('lang' in updates) storeUpdates.language = updates.lang;
        
        updateSearchResult(searchId, storeUpdates);
      }
    }
  }, [searchId, urlParams, setUrlParams, getSearchResult, updateSearchResult]);
  
  // Individual setters
  const setQuery = useCallback((q: string) => updateParamsAndStore({ q }), [updateParamsAndStore]);
  const setField = useCallback((field: SearchField) => updateParamsAndStore({ field }), [updateParamsAndStore]);
  const setSort = useCallback((sort: string) => updateParamsAndStore({ sort }), [updateParamsAndStore]);
  const setPage = useCallback((page: number) => setUrlParams({ page }), [setUrlParams]); // Page doesn't persist to store
  
  const setYearRange = useCallback((from: number | null, to: number | null) => {
    updateParamsAndStore({ yf: from, yt: to, ft: 'year' });
  }, [updateParamsAndStore]);
  
  const setDateRange = useCallback((from: Date | null, to: Date | null) => {
    updateParamsAndStore({ 
      df: from ? format(from, 'yyyy-MM-dd') : null, 
      dt: to ? format(to, 'yyyy-MM-dd') : null,
      ft: 'date',
    });
  }, [updateParamsAndStore]);
  
  const setFilterType = useCallback((type: 'year' | 'date') => {
    updateParamsAndStore({ ft: type });
  }, [updateParamsAndStore]);
  
  const setRatingRange = useCallback((min: number, max: number) => {
    updateParamsAndStore({ rmin: min, rmax: max });
  }, [updateParamsAndStore]);
  
  const setOnlyRated = useCallback((value: boolean) => {
    updateParamsAndStore({ rated: value });
  }, [updateParamsAndStore]);
  
  const setRegions = useCallback((regions: string[]) => {
    updateParamsAndStore({ reg: regions });
  }, [updateParamsAndStore]);
  
  const setCountryFocus = useCallback((countries: string[]) => {
    updateParamsAndStore({ focus: countries });
  }, [updateParamsAndStore]);
  
  const setCites = useCallback((id: string) => {
    updateParamsAndStore({ cites: id });
  }, [updateParamsAndStore]);
  
  const setCitedBy = useCallback((id: string) => {
    updateParamsAndStore({ citedBy: id });
  }, [updateParamsAndStore]);
  
  const setRelatedTo = useCallback((id: string) => {
    updateParamsAndStore({ rel: id });
  }, [updateParamsAndStore]);
  
  const setReviewOnly = useCallback((value: boolean) => {
    updateParamsAndStore({ review: value });
  }, [updateParamsAndStore]);
  
  const setLanguage = useCallback((lang: string | null) => {
    updateParamsAndStore({ lang });
  }, [updateParamsAndStore]);
  
  // Reset all filters to defaults
  const resetFilters = useCallback(() => {
    updateParamsAndStore({
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
  }, [updateParamsAndStore]);
  
  // Get shareable URL
  const getShareableUrl = useCallback(() => {
    if (typeof window === 'undefined') return '';
    const queryString = serializeSearchParams(urlParams);
    return `${window.location.origin}/results/${searchId}?${queryString}`;
  }, [searchId, urlParams]);
  
  // Convert to SearchFilters for API calls
  const toSearchFilters = useCallback((): SearchFilters => {
    return {
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
    };
  }, [urlParams]);
  
  return {
    // Search ID
    searchId,
    
    // Current params
    query: urlParams.q,
    field: urlParams.field,
    sort: urlParams.sort,
    page: urlParams.page,
    yearFrom: urlParams.yf,
    yearTo: urlParams.yt,
    dateFrom: urlParams.df,
    dateTo: urlParams.dt,
    filterType: urlParams.ft,
    ratingMin: urlParams.rmin,
    ratingMax: urlParams.rmax,
    onlyRated: urlParams.rated,
    regions: urlParams.reg,
    countryFocus: urlParams.focus,
    cites: urlParams.cites,
    citedBy: urlParams.citedBy,
    relatedTo: urlParams.rel,
    reviewOnly: urlParams.review,
    language: urlParams.lang,
    
    // State flags
    isInitialized: reconciliationState === 'done',
    isReconciling: reconciliationState === 'reconciling',
    
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
    updateParams: updateParamsAndStore,
    resetFilters,
    
    // Utilities
    getShareableUrl,
    toSearchFilters,
  };
}

/**
 * useSearchResultsWithParams - SWR-based data fetching using URL params
 * 
 * This hook combines useSearchState with SWR for data fetching.
 * It uses URL params directly as the source of truth for search parameters.
 */
export function useSearchResultsWithParams() {
  const searchState = useSearchState();
  const updateSearchResult = useSearchHistoryStore((state) => state.updateSearchResult);
  
  // Create a stable params object using useMemo with primitive dependencies
  // This prevents the object identity issue that causes infinite re-renders
  const paramsForDebounce = useMemo(() => ({
    q: searchState.query,
    field: searchState.field,
    sort: searchState.sort,
    yf: searchState.yearFrom,
    yt: searchState.yearTo,
    df: searchState.dateFrom,
    dt: searchState.dateTo,
    ft: searchState.filterType,
    reg: searchState.regions,
    focus: searchState.countryFocus,
    cites: searchState.cites,
    citedBy: searchState.citedBy,
    rel: searchState.relatedTo,
    review: searchState.reviewOnly,
  }), [
    searchState.query,
    searchState.field,
    searchState.sort,
    searchState.yearFrom,
    searchState.yearTo,
    searchState.dateFrom,
    searchState.dateTo,
    searchState.filterType,
    // For arrays, we need to serialize to ensure stable comparison
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(searchState.regions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(searchState.countryFocus),
    searchState.cites,
    searchState.citedBy,
    searchState.relatedTo,
    searchState.reviewOnly,
  ]);
  
  // Debounce the serialized params string to avoid rapid API calls
  const paramsKey = useMemo(() => JSON.stringify(paramsForDebounce), [paramsForDebounce]);
  const debouncedKey = useDebounceValue(paramsKey, 300);
  
  // Parse back to object only when debounced key changes
  const debouncedParams = useMemo(() => {
    if (!debouncedKey) return null;
    try {
      return JSON.parse(debouncedKey) as typeof paramsForDebounce;
    } catch {
      return null;
    }
  }, [debouncedKey]);
  
  // Create SWR key - returns null until reconciliation is done to prevent premature fetches
  const swrKey = useMemo(() => {
    // Don't fetch until reconciliation is complete
    if (!searchState.isInitialized) return null;
    
    // Don't fetch if we don't have params yet
    if (!debouncedParams) return null;
    
    // Don't fetch if there's no query and no active filters
    const hasQuery = debouncedParams.q && debouncedParams.q.trim() !== '';
    const hasFilters = hasActiveFilters(debouncedParams as ParsedSearchParams);
    if (!hasQuery && !hasFilters) return null;
    
    // Build a stable key array with all params
    return [
      'search-results',
      debouncedParams.q,
      debouncedParams.field,
      debouncedParams.sort,
      debouncedParams.yf,
      debouncedParams.yt,
      debouncedParams.df,
      debouncedParams.dt,
      debouncedParams.ft,
      JSON.stringify(debouncedParams.reg),
      JSON.stringify(debouncedParams.focus),
      debouncedParams.cites,
      debouncedParams.citedBy,
      debouncedParams.rel,
      debouncedParams.review,
    ] as const;
  }, [searchState.isInitialized, debouncedParams]);
  
  // SWR fetcher - extracts all values from key, no external dependencies
  const fetcher = useCallback(async (key: readonly unknown[]) => {
    const [
      _prefix,
      query,
      field,
      sort,
      yf,
      yt,
      df,
      dt,
      ft,
      regJson,
      focusJson,
      cites,
      citedBy,
      rel,
      review,
    ] = key as readonly [string, string, string, string, number | null, number | null, string | null, string | null, string, string, string, string, string, string, boolean];
    
    // Parse regions and focus from JSON strings
    const reg = regJson ? JSON.parse(regJson) as string[] : [];
    const focus = focusJson ? JSON.parse(focusJson) as string[] : [];
    
    // Auto-switch from relevance sorting if no query provided
    let effectiveSortBy = sort;
    if (sort === 'relevance_score:desc' && (!query || query.trim() === '')) {
      effectiveSortBy = 'publication_date:desc';
    }
    
    // Create unified filters object
    const filters: SearchFilters = {
      searchField: field as SearchField,
      sortBy: effectiveSortBy,
      filterType: ft as 'date' | 'year',
      yearRange: yf && yt ? [yf, yt] : undefined,
      isYearRangeEnabled: !!(yf || yt),
      dateRange: df || dt ? {
        from: df ? parseISO(df) : undefined,
        to: dt ? parseISO(dt) : undefined,
      } : undefined,
      ratingRange: undefined, // Rating is handled client-side
      onlyRatedPapers: undefined,
      selectedRegions: reg,
      selectedCountryFocus: focus,
      citesItemId: cites,
      citedByItemId: citedBy,
      relatedToItemId: rel,
      reviewFilter: review,
    };
    
    const params: SearchWithFiltersParams = {
      query,
      filters,
    };
    
    return getSearchResultsWithFilters(params);
  }, []); // Empty deps - all data comes from key
  
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    swrKey,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateOnMount: true,
      revalidateIfStale: false, // Prevent stale revalidation causing extra fetches
      dedupingInterval: 5000, // 5 second deduplication window
      keepPreviousData: true,
      errorRetryCount: 2,
      errorRetryInterval: 1000,
      onSuccess: (data) => {
        // Update search history count
        if (data?.results?.meta?.count !== undefined && searchState.searchId) {
          updateSearchResult(searchState.searchId, { count: data.results.meta.count });
        }
      },
      onError: (error) => {
        console.error('Search request failed:', error);
        
        if (error?.message?.includes('400')) {
          toast.error('Search query too large', {
            description: 'Please try simplifying your search.',
            action: { label: 'Retry', onClick: () => mutate() },
          });
        } else if (error?.message?.includes('429')) {
          toast.error('Too many requests', {
            description: 'Please wait a moment before trying again.',
            action: { label: 'Retry', onClick: () => mutate() },
          });
        } else {
          toast.error('Search failed', {
            description: 'An unexpected error occurred.',
            action: { label: 'Retry', onClick: () => mutate() },
          });
        }
      },
    }
  );
  
  return {
    // Search state (all params and setters)
    ...searchState,
    
    // Results data
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
    isLoadingResults: isLoading || isValidating,
    error,
    mutate,
  };
}
