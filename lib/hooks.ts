"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { format } from "date-fns";
import { create } from "zustand";
import { getEffectiveSearchId, DEFAULT_FILTERS } from "@/lib/utils";
import { useSearchHistoryStore } from "@/lib/store";
import { DateRange } from "react-day-picker";
import type { QueryHistoryEntry, SearchField, SearchFilters } from '@/lib/types';

// Import the new search context
import { useSearchOptional, type SearchParams, type SetQueryOptions } from './search';
import { useSearchHistoryEntries } from "./research/history";

// Shared store for query history navigation index, keyed by searchId.
// Lives here (not in lib/store) because it's an implementation detail of useQueryHistory.
const useQueryHistoryIndexStore = create<{
  indices: Record<string, number>;
  set: (searchId: string, index: number) => void;
}>((set) => ({
  indices: {},
  set: (searchId, index) =>
    set((state) => ({ indices: { ...state.indices, [searchId]: index } })),
}));

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    
    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    
    return () => media.removeEventListener("change", listener);
  }, [query]);

  return matches;
}

// Mobile detection hook using standard breakpoint
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

export function useIsTablet(): boolean {
  return useMediaQuery("(max-width: 1023px)");
}

// Custom hook to handle query changes without keyword expansion
// The keyword expansion and setSuggestedQuery is now handled centrally by QuerySyncProvider
export function useQueryChangeHandler(setQuery: (query: string) => void) {
  return (newQuery: string) => {
    setQuery(newQuery);
  };
}

/**
 * Custom hook to get the effective search ID.
 * Combines the store's currentSearchId with route-based fallback.
 * 
 * This is useful when components need the search ID but the store might not be populated yet
 * (e.g., when users land directly on a results page through a URL).
 * 
 * @returns The effective search ID or undefined if not on a results page
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const pathname = usePathname();
 *   const effectiveSearchId = useEffectiveSearchId();
 *   const isOnResultsPage = pathname?.startsWith('/results');
 *   
 *   const keywordPageUrl = isOnResultsPage && effectiveSearchId 
 *     ? `/results/${effectiveSearchId}/keyword-expansion` 
 *     : '/keyword-expansion';
 *   
 *   return <Link href={keywordPageUrl}>Keywords</Link>;
 * }
 * ```
 */
export function useEffectiveSearchId(): string | undefined {
  const pathname = usePathname();
  // A search running away from the results page names itself.
  const search = useSearchOptional();

  return getEffectiveSearchId(pathname, search?.searchId || undefined);
}

/**
 * Shared query history navigation hook.
 * Tracks position in a search's queryHistory and exposes prev/next navigation.
 * Calls setQuery with { skipHistory: true } so navigation doesn't create new entries.
 * The position is kept as steps back from the newest query, so reading older queries
 * (lib/research/history.ts) doesn't move it.
 */
export function useQueryHistory(
  searchId: string | null | undefined,
  setQuery: ((q: string, options?: SetQueryOptions) => void) | undefined,
) {
  const key = searchId ?? '';
  const currentSearchResult = useSearchHistoryStore((state) =>
    searchId ? state.searchHistory.find((item) => item.id === searchId) : null
  );
  const history = useSearchHistoryEntries(currentSearchResult, "query");
  const queryHistory = history.entries;

  const stepsBack = useQueryHistoryIndexStore((s) => s.indices[key] ?? 0);
  const setStepsBack = useQueryHistoryIndexStore((s) => s.set);
  const loadedIndex = queryHistory.length - 1 - stepsBack;
  const prevTotalRef = useRef(history.total);

  // Jump to latest only when a NEW entry is added (not when navigating)
  useEffect(() => {
    if (history.total > prevTotalRef.current) {
      setStepsBack(key, 0);
    }
    prevTotalRef.current = history.total;
  }, [history.total, key, setStepsBack]);

  // Entries from before scopes were saved are keyword queries.
  const showEntry = useCallback(
    (entry: QueryHistoryEntry) =>
      setQuery?.(entry.query, { skipHistory: true, field: entry.field ?? DEFAULT_FILTERS.field }),
    [setQuery],
  );

  const canGoPrevious = loadedIndex > 0 || history.hasOlder;
  const canGoNext = queryHistory.length > 0 && stepsBack > 0;

  const goToPrevious = useCallback(() => {
    if (loadedIndex > 0) {
      setStepsBack(key, stepsBack + 1);
      showEntry(queryHistory[loadedIndex - 1]);
    } else if (history.hasOlder) {
      // The previous query isn't read yet: read it, and the next press shows it.
      history.loadOlder();
    }
  }, [loadedIndex, stepsBack, queryHistory, showEntry, key, setStepsBack, history]);

  const goToNext = useCallback(() => {
    if (canGoNext) {
      setStepsBack(key, stepsBack - 1);
      showEntry(queryHistory[loadedIndex + 1]);
    }
  }, [canGoNext, stepsBack, loadedIndex, queryHistory, showEntry, key, setStepsBack]);

  return {
    queryHistory,
    historyIndex: Math.max(0, history.total - 1 - stepsBack),
    historyLength: history.total,
    canGoPrevious,
    canGoNext,
    goToPrevious,
    goToNext,
  };
}

/**
 * Custom hook to get current search form state from URL params
 * Updated to use URL as source of truth instead of store
 * 
 * NOTE: This hook uses useSearchState() which requires a Suspense boundary
 * when using nuqs. For pages that don't need URL-based state, consider
 * using the store directly or wrapping the page in Suspense.
 */
export function useCurrentSearchFormState() {
  const pathname = usePathname();
  // A search provider mounted away from the results page owns the state too.
  const localSearch = useSearchOptional();
  const isOnResultsPage = pathname?.startsWith('/results');
  
  // Only use URL-based state on results pages
  // For other pages, use store defaults
  if (!isOnResultsPage && !localSearch) {
    return useCurrentSearchFormStateFromStore();
  }
  
  return useCurrentSearchFormStateFromUrl();
}

/**
 * Internal hook that uses URL-based state via useSearch context
 * Only use this on pages with results
 */
function useCurrentSearchFormStateFromUrl() {
  const search = useSearchOptional();
  
  const defaultYearRange = DEFAULT_FILTERS.yearRange();
  
  // If not inside SearchProvider, fall back to defaults
  if (!search) {
    return useCurrentSearchFormStateFromStore();
  }
  
  // Map from URL-based state to the old API format
  return {
    currentSearchField: search.params.field as SearchField,
    currentQuery: search.params.q,
    currentLanguage: search.params.lang ?? '',
    dateRange: search.params.df || search.params.dt ? {
      from: search.params.df ? new Date(search.params.df) : undefined,
      to: search.params.dt ? new Date(search.params.dt) : undefined,
    } : DEFAULT_FILTERS.dateRange,
    sortBy: search.params.sort,
    filterType: search.params.ft as 'date' | 'year',
    yearRange: search.params.yf && search.params.yt 
      ? [search.params.yf, search.params.yt] as [number, number]
      : defaultYearRange,
    isYearRangeEnabled: !!(search.params.yf || search.params.yt),
    yearFromInput: search.params.yf?.toString() || defaultYearRange[0].toString(),
    yearToInput: search.params.yt?.toString() || defaultYearRange[1].toString(),
    ratingRange: [search.params.rmin, search.params.rmax] as [number, number],
    onlyRatedPapers: search.params.rated,
    selectedRegions: search.params.reg,
    selectedCountryFocus: search.params.focus,
    citesItemId: search.params.cites,
    citedByItemId: search.params.citedBy,
    relatedToItemId: search.params.rel,
    reviewFilter: search.params.review,
    researchAreas: search.params.area,
    sdgs: search.params.sdg,
    openAccessOnly: search.params.oa,
    workTypes: search.params.type,
    workLanguages: search.params.wlang,
    institutionTypes: search.params.itype,
    funders: search.params.funder,
    minCitations: search.params.mincite,
    hasAbstract: search.params.abs,
    includeRetracted: search.params.retracted,
  };
}

/**
 * Internal hook that uses store-based state (for non-results pages)
 */
function useCurrentSearchFormStateFromStore() {
  const effectiveSearchId = useEffectiveSearchId();
  const { getSearchResult } = useSearchHistoryStore();
  const searchResult = effectiveSearchId ? getSearchResult(effectiveSearchId) : null;
  
  const defaultYearRange = DEFAULT_FILTERS.yearRange();
  
  return {
    currentSearchField: (searchResult?.field || 'title_and_abstract') as SearchField,
    currentQuery: searchResult?.query ?? '',
    currentLanguage: searchResult?.language ?? '',
    dateRange: searchResult?.dateRange || DEFAULT_FILTERS.dateRange,
    sortBy: searchResult?.sortBy || 'relevance_score:desc',
    filterType: (searchResult?.filterType || 'year') as 'date' | 'year',
    yearRange: searchResult?.yearRange || defaultYearRange,
    isYearRangeEnabled: searchResult?.isYearRangeEnabled || false,
    yearFromInput: searchResult?.yearRange?.[0]?.toString() || defaultYearRange[0].toString(),
    yearToInput: searchResult?.yearRange?.[1]?.toString() || defaultYearRange[1].toString(),
    ratingRange: (searchResult?.ratingRange || [0, 5]) as [number, number],
    onlyRatedPapers: searchResult?.onlyRatedPapers || false,
    selectedRegions: searchResult?.selectedRegions || [],
    selectedCountryFocus: searchResult?.selectedCountryFocus || [],
    citesItemId: searchResult?.citesItemId || '',
    citedByItemId: searchResult?.citedByItemId || '',
    relatedToItemId: searchResult?.relatedToItemId || '',
    reviewFilter: searchResult?.reviewFilter || false,
    researchAreas: searchResult?.researchAreas ?? [],
    sdgs: searchResult?.sdgs ?? [],
    openAccessOnly: searchResult?.openAccessOnly ?? false,
    workTypes: searchResult?.workTypes ?? [],
    workLanguages: searchResult?.workLanguages ?? [],
    institutionTypes: searchResult?.institutionTypes ?? [],
    funders: searchResult?.funders ?? [],
    minCitations: searchResult?.minCitations ?? null,
    hasAbstract: searchResult?.hasAbstract ?? false,
    includeRetracted: searchResult?.includeRetracted ?? false,
  };
}

/**
 * Custom hook to update search filters via URL params
 * Updated to use URL as source of truth
 * Only works on results pages where SearchProvider is available.
 */
export function useUpdateSearchFilter() {
  const pathname = usePathname();
  const localSearch = useSearchOptional();
  const isOnResultsPage = pathname?.startsWith('/results');
  
  // On results pages, and inside a local search provider, use its state
  if (isOnResultsPage || localSearch) {
    return useUpdateSearchFilterFromUrl();
  }
  
  // On other pages, return a no-op function
  return useCallback((_updates: Record<string, unknown>) => {
    console.warn('useUpdateSearchFilter called outside of results page - no-op');
  }, []);
}

/**
 * Internal hook that uses URL-based state updates
 */
function useUpdateSearchFilterFromUrl() {
  const search = useSearchOptional();
  
  const updateFilter = useCallback((updates: Record<string, unknown>) => {
    // If not inside SearchProvider, do nothing
    if (!search) {
      console.warn('useUpdateSearchFilter called outside of SearchProvider - no-op');
      return;
    }

    const batchUpdates: Partial<SearchParams> = {};
    let shouldResetPage = false;
    const currentYearRange =
      search.params.yf !== null && search.params.yt !== null
        ? ([search.params.yf, search.params.yt] as [number, number])
        : null;

    if ('currentSearchField' in updates || 'field' in updates) {
      batchUpdates.field = (updates.currentSearchField || updates.field) as SearchParams['field'];
    }
    if ('sortBy' in updates) {
      batchUpdates.sort = updates.sortBy as string;
    }
    if ('filterType' in updates) {
      batchUpdates.ft = updates.filterType as SearchParams['ft'];
    }
    if ('yearRange' in updates) {
      const range = updates.yearRange as [number, number] | undefined;
      batchUpdates.yf = range?.[0] ?? null;
      batchUpdates.yt = range?.[1] ?? null;
      batchUpdates.ft = 'year';
      shouldResetPage = true;
    }
    if ('isYearRangeEnabled' in updates) {
      const enabled = Boolean(updates.isYearRangeEnabled);

      if (enabled) {
        const requestedRange =
          (updates.yearRange as [number, number] | undefined) ??
          currentYearRange ??
          DEFAULT_FILTERS.yearRange();

        batchUpdates.yf = requestedRange[0];
        batchUpdates.yt = requestedRange[1];
        batchUpdates.ft = 'year';
        shouldResetPage = true;
      } else {
        // If disabling year range, clear the values
        batchUpdates.yf = null;
        batchUpdates.yt = null;
        batchUpdates.ft = 'year';
        shouldResetPage = true;
      }
    }
    if ('dateRange' in updates) {
      const range = updates.dateRange as DateRange | undefined;
      batchUpdates.df = range?.from ? format(range.from, 'yyyy-MM-dd') : null;
      batchUpdates.dt = range?.to ? format(range.to, 'yyyy-MM-dd') : null;
      batchUpdates.ft = 'date';
      shouldResetPage = true;
    }
    if ('ratingRange' in updates) {
      const range = updates.ratingRange as [number, number] | undefined;
      batchUpdates.rmin = range?.[0] ?? DEFAULT_FILTERS.ratingRange[0];
      batchUpdates.rmax = range?.[1] ?? DEFAULT_FILTERS.ratingRange[1];
      shouldResetPage = true;
    }
    if ('onlyRatedPapers' in updates) {
      batchUpdates.rated = updates.onlyRatedPapers as boolean;
      shouldResetPage = true;
    }
    if ('selectedRegions' in updates) {
      batchUpdates.reg = updates.selectedRegions as string[];
      shouldResetPage = true;
    }
    if ('selectedCountryFocus' in updates) {
      batchUpdates.focus = updates.selectedCountryFocus as string[];
      shouldResetPage = true;
    }
    if ('citesItemId' in updates) {
      batchUpdates.cites = updates.citesItemId as string;
      shouldResetPage = true;
    }
    if ('citedByItemId' in updates) {
      batchUpdates.citedBy = updates.citedByItemId as string;
      shouldResetPage = true;
    }
    if ('relatedToItemId' in updates) {
      batchUpdates.rel = updates.relatedToItemId as string;
      shouldResetPage = true;
    }
    if ('reviewFilter' in updates) {
      batchUpdates.review = updates.reviewFilter as boolean;
      shouldResetPage = true;
    }
    if ('researchAreas' in updates) {
      batchUpdates.area = updates.researchAreas as string[];
      shouldResetPage = true;
    }
    if ('sdgs' in updates) {
      batchUpdates.sdg = updates.sdgs as string[];
      shouldResetPage = true;
    }
    if ('openAccessOnly' in updates) {
      batchUpdates.oa = updates.openAccessOnly as boolean;
      shouldResetPage = true;
    }
    if ('workTypes' in updates) {
      batchUpdates.type = updates.workTypes as string[];
      shouldResetPage = true;
    }
    if ('workLanguages' in updates) {
      batchUpdates.wlang = updates.workLanguages as string[];
      shouldResetPage = true;
    }
    if ('institutionTypes' in updates) {
      batchUpdates.itype = updates.institutionTypes as string[];
      shouldResetPage = true;
    }
    if ('funders' in updates) {
      batchUpdates.funder = updates.funders as string[];
      shouldResetPage = true;
    }
    if ('minCitations' in updates) {
      batchUpdates.mincite = updates.minCitations as number | null;
      shouldResetPage = true;
    }
    if ('hasAbstract' in updates) {
      batchUpdates.abs = updates.hasAbstract as boolean;
      shouldResetPage = true;
    }
    if ('includeRetracted' in updates) {
      batchUpdates.retracted = updates.includeRetracted as boolean;
      shouldResetPage = true;
    }
    if ('language' in updates || 'lang' in updates) {
      batchUpdates.lang = ((updates.language as string | null | undefined) ?? updates.lang ?? null) as string | null;
      shouldResetPage = true;
    }

    if (shouldResetPage) {
      batchUpdates.page = 1;
    }

    if (Object.keys(batchUpdates).length > 0) {
      search.updateParams(batchUpdates);
    }
  }, [search]);
  
  return updateFilter;
}

/**
 * Create a SearchFilters object from current form state with optional overrides
 */
export function useCreateSearchFilters() {
  const {
    currentSearchField,
    dateRange,
    sortBy,
    filterType,
    yearRange,
    isYearRangeEnabled,
    selectedRegions,
    selectedCountryFocus,
    ratingRange,
    onlyRatedPapers,
    citesItemId,
    citedByItemId,
    relatedToItemId,
    reviewFilter,
    researchAreas,
    sdgs,
    openAccessOnly,
    workTypes,
    workLanguages,
    institutionTypes,
    funders,
    minCitations,
    hasAbstract,
    includeRetracted,
  } = useCurrentSearchFormState();

  return (overrides: Partial<SearchFilters> = {}): SearchFilters => ({
    searchField: currentSearchField,
    sortBy: sortBy || 'relevance_score:desc',
    filterType: filterType || 'year',
    dateRange,
    yearRange,
    isYearRangeEnabled,
    ratingRange,
    onlyRatedPapers,
    selectedRegions: selectedRegions || [],
    selectedCountryFocus: selectedCountryFocus || [],
    citesItemId: citesItemId || '',
    citedByItemId: citedByItemId || '',
    relatedToItemId: relatedToItemId || '',
    reviewFilter: reviewFilter || false,
    researchAreas,
    sdgs,
    openAccessOnly,
    workTypes,
    workLanguages,
    institutionTypes,
    funders,
    minCitations,
    hasAbstract,
    includeRetracted,
    ...overrides, // Override any fields passed in
  });
} 
