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

import { createContext, useContext, useMemo, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useQueryStates } from 'nuqs';
import { format, parseISO } from 'date-fns';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useAppToast } from '@/lib/toast';

import { searchParamsParsers, DEFAULT_SEARCH_PARAMS } from '../search-params/parsers';
import { buildShareableUrl, effectiveSort } from '../search-params';
import { sanitizeSelection } from '../search-params/sanitize';
import { getSearchResultsWithFilters, type SearchWithFiltersParams } from '../search-utils';
import { useSearchHistoryStore, useKeywordExpansionStore } from '../store';
import { validateAndExpandKeywordsSilently } from '../keyword-validation';
import type { SearchFilters, SearchField, PaperResult } from '../types';
import type { SearchContextValue, SearchParams, SearchResultData } from './types';
import {
  SEARCH_EVENT_SCHEMA_VERSION,
  SEARCH_FETCH_PARAM_KEYS,
  buildSearchFilterSnapshot,
  captureSearchExecuted,
  captureSearchFailed,
  captureSearchSucceeded,
  createSearchRequestId,
  deriveSearchTrigger,
  getChangedParamKeys,
  type SearchBaseEventPayload,
  type SearchParamKey,
} from '../posthog-search';

// Create context with undefined default (must be used within provider)
const SearchContext = createContext<SearchContextValue | undefined>(undefined);

/**
 * Runs the search away from the results page: the caller owns the id and the
 * params that the URL would otherwise hold.
 */
export interface LocalSearchState {
  searchId: string;
  params: SearchParams;
  onParamsChange: (updates: Partial<SearchParams>) => void;
}

interface SearchProviderProps {
  local?: LocalSearchState;
  children: ReactNode;
}

interface PendingSearchRequest {
  startedAt: number;
  payload: SearchBaseEventPayload;
}

const SEARCH_FETCH_PARAM_KEY_SET = new Set<SearchParamKey>(SEARCH_FETCH_PARAM_KEYS);

// Module-level cache for params snapshots (avoids ref access during render)
const paramsSnapshotByKey = new Map<string, SearchParams>();

function parseSearchErrorType(message: string): string {
  const statusMatch = message.match(/\b(\d{3})\b/);
  if (statusMatch) {
    const status = statusMatch[1];
    return status.startsWith('4') ? 'http_4xx' : status.startsWith('5') ? 'http_5xx' : `http_${status}`;
  }

  if (/network|failed to fetch|timeout/i.test(message)) {
    return 'network';
  }

  return 'unknown';
}

function cloneSearchParams(params: SearchParams): SearchParams {
  return {
    ...params,
    reg: [...params.reg],
    focus: [...params.focus],
    area: [...params.area],
    sdg: [...params.sdg],
    type: [...params.type],
    wlang: [...params.wlang],
    itype: [...params.itype],
    funder: [...params.funder],
  };
}

/**
 * SearchProvider - Wrap your results pages with this
 */
export function SearchProvider({ children, local }: SearchProviderProps) {
  const toast = useAppToast();
  const tValidation = useTranslations("validation");
  const routeParams = useParams<{ searchId: string }>();
  const searchId = local?.searchId ?? routeParams?.searchId ?? '';
  
  // Read URL params via nuqs - THIS IS THE SOURCE OF TRUTH
  const [routeUrlParams, setRouteUrlParams] = useQueryStates(searchParamsParsers, {
    history: 'push',
    shallow: false,
  });
  const urlParams = local ? local.params : routeUrlParams;
  const onLocalParamsChange = local?.onParamsChange;
  const setUrlParams = useCallback(
    (updates: Partial<SearchParams>, options?: { scroll?: boolean }) => {
      if (onLocalParamsChange) onLocalParamsChange(updates);
      else void setRouteUrlParams(updates as Parameters<typeof setRouteUrlParams>[0], options);
    },
    [onLocalParamsChange, setRouteUrlParams],
  );

  const currentParams = urlParams as SearchParams;
  const previousTrackedParamsRef = useRef<SearchParams | null>(null);
  const pendingRequestsRef = useRef<Map<string, PendingSearchRequest>>(new Map());
  
  // Get store methods for updating history entry
  const updateSearchResult = useSearchHistoryStore((state) => state.updateSearchResult);
  const getSearchResult = useSearchHistoryStore((state) => state.getSearchResult);
  const addQueryToHistory = useSearchHistoryStore((state) => state.addQueryToHistory);
  
  // Get expandQuery function for keyword expansion in shareable links
  const expandQuery = useKeywordExpansionStore((state) => state.expandQuery);
  
  // Helper to sync filter changes to store for history persistence
  // This ensures that when users change filters, the changes persist when navigating
  // between history entries. Each setter updates both URL (nuqs) and store (Zustand).
  const syncToStore = useCallback((storeUpdates: Record<string, unknown>) => {
    if (searchId) {
      updateSearchResult(searchId, storeUpdates);
    }
  }, [searchId, updateSearchResult]);
  
  // Create stable params object for debouncing
  // We serialize to string first to get stable reference
  const paramsKey = useMemo(() => {
    const key = JSON.stringify({
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
      area: urlParams.area,
      sdg: urlParams.sdg,
      oa: urlParams.oa,
      type: urlParams.type,
      wlang: urlParams.wlang,
      itype: urlParams.itype,
      funder: urlParams.funder,
      mincite: urlParams.mincite,
      abs: urlParams.abs,
      retracted: urlParams.retracted,
    });

    paramsSnapshotByKey.set(key, cloneSearchParams(currentParams));

    if (paramsSnapshotByKey.size > 40) {
      const oldestKey = paramsSnapshotByKey.keys().next().value;
      if (oldestKey) {
        paramsSnapshotByKey.delete(oldestKey);
      }
    }

    return key;
  }, [
    currentParams,
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
    urlParams.area,
    urlParams.sdg,
    urlParams.oa,
    urlParams.type,
    urlParams.wlang,
    urlParams.itype,
    urlParams.funder,
    urlParams.mincite,
    urlParams.abs,
    urlParams.retracted,
    urlParams.page,
    urlParams.rmin,
    urlParams.rmax,
    urlParams.rated,
    urlParams.lang,
  ]);
  
  // Build SWR key - null means don't fetch
  const swrKey = useMemo(() => {
    if (!paramsKey) return null;
    
    return ['search', paramsKey] as const;
  }, [paramsKey]);
  
  // Single SWR fetcher - all data comes from the key
  const fetcher = useCallback(async ([, paramsJson]: readonly [string, string]) => {
    const parsedParams = JSON.parse(paramsJson) as Partial<SearchParams>;
    const snapshotParams = paramsSnapshotByKey.get(paramsJson);
    const params: SearchParams = snapshotParams
      ? cloneSearchParams(snapshotParams)
      : {
          ...DEFAULT_SEARCH_PARAMS,
          ...parsedParams,
          reg: parsedParams.reg ? [...parsedParams.reg] : [],
          focus: parsedParams.focus ? [...parsedParams.focus] : [],
          area: parsedParams.area ? [...parsedParams.area] : [],
          sdg: parsedParams.sdg ? [...parsedParams.sdg] : [],
          type: parsedParams.type ? [...parsedParams.type] : [],
          wlang: parsedParams.wlang ? [...parsedParams.wlang] : [],
          itype: parsedParams.itype ? [...parsedParams.itype] : [],
          funder: parsedParams.funder ? [...parsedParams.funder] : [],
          page: DEFAULT_SEARCH_PARAMS.page,
          rmin: DEFAULT_SEARCH_PARAMS.rmin,
          rmax: DEFAULT_SEARCH_PARAMS.rmax,
          rated: DEFAULT_SEARCH_PARAMS.rated,
          lang: DEFAULT_SEARCH_PARAMS.lang,
        };

    const previousParams = previousTrackedParamsRef.current;
    const changedParamKeys = getChangedParamKeys(previousParams, params);
    const trigger = deriveSearchTrigger(previousParams, params, changedParamKeys);
    const requestId = createSearchRequestId();
    const searchResult = searchId ? getSearchResult(searchId) : undefined;
    const fallbackQuerySource = searchResult?.query || params.q || '';
    const fallbackResearchQuestion = fallbackQuerySource
      ? validateAndExpandKeywordsSilently(fallbackQuerySource).expandedQuery
      : '';

    const basePayload: SearchBaseEventPayload = {
      search_id: searchId || 'unknown',
      request_id: requestId,
      trigger,
      changed_param_keys: changedParamKeys,
      changed_param_count: changedParamKeys.length,
      search_event_schema_version: SEARCH_EVENT_SCHEMA_VERSION,
      ...buildSearchFilterSnapshot(params, {
        searchResult,
        fallbackResearchQuestion,
      }),
    };

    captureSearchExecuted(basePayload);
    pendingRequestsRef.current.set(paramsJson, {
      startedAt: Date.now(),
      payload: basePayload,
    });
    previousTrackedParamsRef.current = cloneSearchParams(params);
    
    const effectiveSortBy = effectiveSort(params);
    
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
      researchAreas: params.area,
      sdgs: params.sdg,
      openAccessOnly: params.oa,
      workTypes: params.type,
      workLanguages: params.wlang,
      institutionTypes: params.itype,
      funders: params.funder,
      minCitations: params.mincite,
      hasAbstract: params.abs,
      includeRetracted: params.retracted,
    };
    
    const searchParams: SearchWithFiltersParams = {
      query: params.q || '',
      filters,
    };

    const result = await getSearchResultsWithFilters(searchParams, {
      getMessage: (key, params) =>
        tValidation(key as "singleCharSearch", params as Record<string, string>),
    });
    // Attach the paramsKey and requestId for outcome tracking
    return { ...result, paramsKey: paramsJson, requestId };
  }, [searchId, getSearchResult, toast, tValidation]);
  
  // Single SWR instance
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    swrKey,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      keepPreviousData: true,
      dedupingInterval: 5000,
      errorRetryCount: 2,
      errorRetryInterval: 1000,
      onSuccess: (data) => {
        if (data?.paramsKey) {
          const pendingRequest = pendingRequestsRef.current.get(data.paramsKey);
          if (pendingRequest) {
            captureSearchSucceeded({
              ...pendingRequest.payload,
              duration_ms: Date.now() - pendingRequest.startedAt,
              results_count: data?.results?.meta?.count ?? 0,
              validation_is_valid: data?.validation?.isValid ?? true,
              validation_warning_count: data?.validation?.warnings?.length ?? 0,
            });
            pendingRequestsRef.current.delete(data.paramsKey);
          }
        }

        if (data?.results?.meta?.count !== undefined && searchId && data.paramsKey === paramsKey) {
          const existing = getSearchResult(searchId);
          if (existing && existing.count !== data.results.meta.count) {
            updateSearchResult(searchId, { count: data.results.meta.count });
          }
        }
      },
      onError: (err, key) => {
        console.error('Search failed:', err);
        const message = err?.message || '';

        const paramsJson = Array.isArray(key) && typeof key[1] === 'string' ? key[1] : undefined;
        if (paramsJson) {
          const pendingRequest = pendingRequestsRef.current.get(paramsJson);
          if (pendingRequest) {
            captureSearchFailed({
              ...pendingRequest.payload,
              duration_ms: Date.now() - pendingRequest.startedAt,
              error_message: message || 'Unknown error',
              error_type: parseSearchErrorType(message),
            });
            pendingRequestsRef.current.delete(paramsJson);
          }
        }
        
        toast.search.failed(err);
      },
    }
  );

  // Track local-only search interactions (pagination, rating, language)
  // that intentionally do not trigger API fetches.
  useEffect(() => {
    const previousParams = previousTrackedParamsRef.current;
    if (!previousParams) {
      return;
    }

    const changedParamKeys = getChangedParamKeys(previousParams, currentParams);
    if (changedParamKeys.length === 0) {
      return;
    }

    const hasFetchParamChange = changedParamKeys.some((key) => SEARCH_FETCH_PARAM_KEY_SET.has(key));
    if (hasFetchParamChange) {
      return;
    }

    const requestId = createSearchRequestId();
    const trigger = deriveSearchTrigger(previousParams, currentParams, changedParamKeys);
    const searchResult = searchId ? getSearchResult(searchId) : undefined;
    const fallbackQuerySource = searchResult?.query || currentParams.q || '';
    const fallbackResearchQuestion = fallbackQuerySource
      ? validateAndExpandKeywordsSilently(fallbackQuerySource).expandedQuery
      : '';
    const basePayload: SearchBaseEventPayload = {
      search_id: searchId || 'unknown',
      request_id: requestId,
      trigger,
      changed_param_keys: changedParamKeys,
      changed_param_count: changedParamKeys.length,
      search_event_schema_version: SEARCH_EVENT_SCHEMA_VERSION,
      ...buildSearchFilterSnapshot(currentParams, {
        searchResult,
        fallbackResearchQuestion,
      }),
    };

    captureSearchExecuted(basePayload);
    captureSearchSucceeded({
      ...basePayload,
      duration_ms: 0,
      results_count: data?.results?.meta?.count ?? 0,
      validation_is_valid: data?.validation?.isValid ?? true,
      validation_warning_count: data?.validation?.warnings?.length ?? 0,
    });
    previousTrackedParamsRef.current = cloneSearchParams(currentParams);
  }, [
    currentParams.q,
    currentParams.field,
    currentParams.sort,
    currentParams.page,
    currentParams.yf,
    currentParams.yt,
    currentParams.df,
    currentParams.dt,
    currentParams.ft,
    currentParams.rmin,
    currentParams.rmax,
    currentParams.rated,
    currentParams.reg,
    currentParams.focus,
    currentParams.cites,
    currentParams.citedBy,
    currentParams.rel,
    currentParams.review,
    currentParams.area,
    currentParams.sdg,
    currentParams.oa,
    currentParams.type,
    currentParams.wlang,
    currentParams.itype,
    currentParams.funder,
    currentParams.mincite,
    currentParams.abs,
    currentParams.retracted,
    currentParams.lang,
    data?.results?.meta?.count,
    data?.validation?.isValid,
    data?.validation?.warnings?.length,
    searchId,
    getSearchResult,
  ]);
  
  // Param setters - just update URL, SWR auto-refetches
  const setQuery = useCallback((q: string, options?: { skipHistory?: boolean }) => {
    // Get current query from store to check if it changed
    const existing = getSearchResult(searchId);
    const currentQuery = existing?.query ?? '';
    
    // Update URL (source of truth for filtering)
    setUrlParams({ q });
    
    // Track in history if query actually changed and we have a valid searchId
    // Skip history tracking when navigating through history (preview mode)
    if (searchId && q !== currentQuery && !options?.skipHistory) {
      addQueryToHistory(searchId, q);
    }
  }, [setUrlParams, searchId, getSearchResult, addQueryToHistory]);
  
  const setField = useCallback((field: SearchField) => {
    setUrlParams({ field });
    syncToStore({ field });
  }, [setUrlParams, syncToStore]);
  
  const setSort = useCallback((sort: string) => {
    setUrlParams({ sort });
    syncToStore({ sortBy: sort });
  }, [setUrlParams, syncToStore]);
  
  const setPage = useCallback((page: number) => {
    setUrlParams({ page }, { scroll: true });
    syncToStore({ page });
  }, [setUrlParams, syncToStore]);
  
  const setYearRange = useCallback((from: number | null, to: number | null) => {
    setUrlParams({ yf: from, yt: to, ft: 'year', page: 1 });
    syncToStore({
      yearRange: from !== null && to !== null ? [from, to] : undefined,
      isYearRangeEnabled: from !== null || to !== null,
      filterType: 'year',
      page: 1,
    });
  }, [setUrlParams, syncToStore]);
  
  const setDateRange = useCallback((from: Date | null, to: Date | null) => {
    setUrlParams({
      df: from ? format(from, 'yyyy-MM-dd') : null,
      dt: to ? format(to, 'yyyy-MM-dd') : null,
      ft: 'date',
      page: 1,
    });
    syncToStore({
      dateRange: from || to ? { from: from ?? undefined, to: to ?? undefined } : undefined,
      filterType: 'date',
      page: 1,
    });
  }, [setUrlParams, syncToStore]);
  
  const setFilterType = useCallback((type: 'year' | 'date') => {
    setUrlParams({ ft: type });
    syncToStore({ filterType: type });
  }, [setUrlParams, syncToStore]);
  
  const setRatingRange = useCallback((min: number, max: number) => {
    setUrlParams({ rmin: min, rmax: max, page: 1 });
    syncToStore({ ratingRange: [min, max], page: 1 });
  }, [setUrlParams, syncToStore]);
  
  const setOnlyRated = useCallback((value: boolean) => {
    setUrlParams({ rated: value, page: 1 });
    syncToStore({ onlyRatedPapers: value, page: 1 });
  }, [setUrlParams, syncToStore]);
  
  const setRegions = useCallback((regions: string[]) => {
    const cleaned = sanitizeSelection(regions);
    setUrlParams({ reg: cleaned, page: 1 });
    syncToStore({ selectedRegions: cleaned, page: 1 });
  }, [setUrlParams, syncToStore]);

  const setCountryFocus = useCallback((countries: string[]) => {
    const cleaned = sanitizeSelection(countries);
    setUrlParams({ focus: cleaned, page: 1 });
    syncToStore({ selectedCountryFocus: cleaned, page: 1 });
  }, [setUrlParams, syncToStore]);
  
  const setCites = useCallback((id: string) => {
    setUrlParams({ cites: id, page: 1 });
    syncToStore({ citesItemId: id, page: 1 });
  }, [setUrlParams, syncToStore]);
  
  const setCitedBy = useCallback((id: string) => {
    setUrlParams({ citedBy: id, page: 1 });
    syncToStore({ citedByItemId: id, page: 1 });
  }, [setUrlParams, syncToStore]);
  
  const setRelatedTo = useCallback((id: string) => {
    setUrlParams({ rel: id, page: 1 });
    syncToStore({ relatedToItemId: id, page: 1 });
  }, [setUrlParams, syncToStore]);
  
  const setReviewOnly = useCallback((value: boolean) => {
    setUrlParams({ review: value, page: 1 });
    syncToStore({ reviewFilter: value, page: 1 });
  }, [setUrlParams, syncToStore]);
  
  const setLanguage = useCallback((lang: string | null) => {
    setUrlParams({ lang, page: 1 });
    syncToStore({ language: lang || undefined, page: 1 });
  }, [setUrlParams, syncToStore]);
  
  // Bulk update
  const updateParams = useCallback((updates: Partial<SearchParams>) => {
    setUrlParams(updates as Partial<typeof urlParams>);
    // Convert URL param keys to store field names and sync
    const storeUpdates: Record<string, unknown> = {};
    if ('field' in updates) storeUpdates.field = updates.field;
    if ('sort' in updates) storeUpdates.sortBy = updates.sort;
    if ('yf' in updates || 'yt' in updates) {
      const yf = 'yf' in updates ? updates.yf : urlParams.yf;
      const yt = 'yt' in updates ? updates.yt : urlParams.yt;
      storeUpdates.yearRange = yf !== null && yt !== null ? [yf, yt] : undefined;
      storeUpdates.isYearRangeEnabled = yf !== null || yt !== null;
    }
    if ('df' in updates || 'dt' in updates) {
      const df = 'df' in updates ? updates.df : urlParams.df;
      const dt = 'dt' in updates ? updates.dt : urlParams.dt;
      storeUpdates.dateRange = df || dt ? {
        from: df ? new Date(df) : undefined,
        to: dt ? new Date(dt) : undefined,
      } : undefined;
    }
    if ('ft' in updates) storeUpdates.filterType = updates.ft;
    if ('rmin' in updates || 'rmax' in updates) {
      const rmin = 'rmin' in updates ? updates.rmin : urlParams.rmin;
      const rmax = 'rmax' in updates ? updates.rmax : urlParams.rmax;
      storeUpdates.ratingRange = [rmin, rmax];
    }
    if ('rated' in updates) storeUpdates.onlyRatedPapers = updates.rated;
    if ('reg' in updates) storeUpdates.selectedRegions = updates.reg;
    if ('focus' in updates) storeUpdates.selectedCountryFocus = updates.focus;
    if ('cites' in updates) storeUpdates.citesItemId = updates.cites;
    if ('citedBy' in updates) storeUpdates.citedByItemId = updates.citedBy;
    if ('rel' in updates) storeUpdates.relatedToItemId = updates.rel;
    if ('review' in updates) storeUpdates.reviewFilter = updates.review;
    if ('area' in updates) storeUpdates.researchAreas = updates.area;
    if ('sdg' in updates) storeUpdates.sdgs = updates.sdg;
    if ('oa' in updates) storeUpdates.openAccessOnly = updates.oa;
    if ('type' in updates) storeUpdates.workTypes = updates.type;
    if ('wlang' in updates) storeUpdates.workLanguages = updates.wlang;
    if ('itype' in updates) storeUpdates.institutionTypes = updates.itype;
    if ('funder' in updates) storeUpdates.funders = updates.funder;
    if ('mincite' in updates) storeUpdates.minCitations = updates.mincite ?? undefined;
    if ('abs' in updates) storeUpdates.hasAbstract = updates.abs;
    if ('retracted' in updates) storeUpdates.includeRetracted = updates.retracted;
    if ('lang' in updates) storeUpdates.language = updates.lang || undefined;
    if ('page' in updates) storeUpdates.page = updates.page;
    
    if (Object.keys(storeUpdates).length > 0) {
      syncToStore(storeUpdates);
    }
  }, [setUrlParams, syncToStore, urlParams]);
  
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
      area: [],
      sdg: [],
      oa: false,
      type: [],
      wlang: [],
      itype: [],
      funder: [],
      mincite: null,
      abs: false,
      retracted: false,
      page: 1,
    });
    // Also reset in store
    syncToStore({
      yearRange: undefined,
      isYearRangeEnabled: false,
      dateRange: undefined,
      filterType: 'year',
      ratingRange: [0, 5],
      onlyRatedPapers: false,
      selectedRegions: [],
      selectedCountryFocus: [],
      citesItemId: '',
      citedByItemId: '',
      relatedToItemId: '',
      reviewFilter: false,
      researchAreas: [],
      sdgs: [],
      openAccessOnly: false,
      workTypes: [],
      workLanguages: [],
      institutionTypes: [],
      funders: [],
      minCitations: undefined,
      hasAbstract: false,
      includeRetracted: false,
      page: 1,
    });
  }, [setUrlParams, syncToStore]);
  
  // Get shareable URL - pass base URL to serializer to avoid double ?
  // Expands keyword bookmarks before generating the URL so shared links work for everyone
  const getShareableUrl = useCallback(() => {
    if (typeof window === 'undefined') return '';

    // Expand keywords in the query (e.g., ml... → "machine learning" OR AI)
    const { expandedQuery } = expandQuery(urlParams.q || '');

    // Strip the local history id from shared links — the recipient's
    // SearchInitializer mints a fresh id for them. See buildShareableUrl.
    return buildShareableUrl(window.location.origin, {
      ...urlParams,
      q: expandedQuery,
    });
  }, [urlParams, expandQuery]);
  
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
    researchAreas: urlParams.area,
    sdgs: urlParams.sdg,
    openAccessOnly: urlParams.oa,
    workTypes: urlParams.type,
    workLanguages: urlParams.wlang,
    institutionTypes: urlParams.itype,
    funders: urlParams.funder,
    minCitations: urlParams.mincite,
    hasAbstract: urlParams.abs,
    includeRetracted: urlParams.retracted,
  }), [urlParams]);
  
  // Build context value
  const value: SearchContextValue = useMemo(() => ({
    searchId,
    
    params: urlParams as SearchParams,
    
    // Results
    results: (data?.results?.results || []) as PaperResult[],
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
