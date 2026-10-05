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

/** How many steps before the oldest read query the arrows read older ones. */
const HISTORY_READ_AHEAD = 5;

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
  const stepsBack = useQueryHistoryIndexStore((s) => s.indices[key] ?? 0);
  // A position kept from an earlier visit is read with the first page.
  const history = useSearchHistoryEntries(currentSearchResult, "query", true, stepsBack + HISTORY_READ_AHEAD + 1);
  const queryHistory = history.entries;

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

  const canGoPrevious = stepsBack < history.total - 1;
  const canGoNext = stepsBack > 0;

  // Older queries are read a few steps before the arrows reach them. A step to one not read
  // yet, from a place kept from an earlier visit or pressed during a read, reads it first;
  // a press during that read steps on from where the read will land. The read's result is
  // dropped if anything else moved meanwhile: a new query, another search, or these arrows
  // going away.
  const readToken = useRef(0);
  const pendingTarget = useRef<number | null>(null);
  useEffect(() => () => { readToken.current += 1; pendingTarget.current = null; }, [key]);
  const step = useCallback(async (delta: -1 | 1) => {
    const from = pendingTarget.current ?? stepsBack;
    const target = from - delta;
    if (target < 0 || target >= history.total) return;
    const loaded = pendingTarget.current === null ? queryHistory[loadedIndex + delta] : undefined;
    if (loaded) {
      if (loadedIndex + delta <= HISTORY_READ_AHEAD && history.hasOlder) history.loadOlder();
      setStepsBack(key, target);
      showEntry(loaded);
      return;
    }
    const token = ++readToken.current;
    pendingTarget.current = target;
    const positions = useQueryHistoryIndexStore.getState().indices;
    try {
      const entry = await history.readAt(target);
      if (token !== readToken.current || useQueryHistoryIndexStore.getState().indices !== positions) return;
      if (!entry) return;
      setStepsBack(key, target);
      showEntry(entry);
    } catch (error) {
      console.error("Couldn't read an earlier query of this search", { searchId: key, stepsBack: target, error });
    } finally {
      if (token === readToken.current) pendingTarget.current = null;
    }
  }, [loadedIndex, stepsBack, queryHistory, showEntry, key, setStepsBack, history]);
  const goToPrevious = useCallback(() => { if (canGoPrevious) void step(-1); }, [canGoPrevious, step]);
  const goToNext = useCallback(() => { if (canGoNext) void step(1); }, [canGoNext, step]);

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
 * The current search's form state: from the search provider's address when there is one
 * (it reads nuqs, which needs a Suspense boundary), otherwise from the store.
 */
export function useCurrentSearchFormState() {
  // Every hook runs on every render, whatever the page: a component kept across pages, such
  // as focus mode in the assistant's panel, moves between results pages and the rest. A search
  // provider, on the results page or mounted elsewhere, owns the state; without one, the store.
  const search = useSearchOptional();
  const fromStore = useCurrentSearchFormStateFromStore();
  return search ? formStateOf(search.params) : fromStore;
}

/** A search provider's address state in the form's shape. */
function formStateOf(params: NonNullable<ReturnType<typeof useSearchOptional>>["params"]) {
  const defaultYearRange = DEFAULT_FILTERS.yearRange();
  return {
    currentSearchField: params.field as SearchField,
    currentQuery: params.q,
    currentLanguage: params.lang ?? '',
    dateRange: params.df || params.dt ? {
      from: params.df ? new Date(params.df) : undefined,
      to: params.dt ? new Date(params.dt) : undefined,
    } : DEFAULT_FILTERS.dateRange,
    sortBy: params.sort,
    filterType: params.ft as 'date' | 'year',
    yearRange: params.yf && params.yt
      ? [params.yf, params.yt] as [number, number]
      : defaultYearRange,
    isYearRangeEnabled: !!(params.yf || params.yt),
    yearFromInput: params.yf?.toString() || defaultYearRange[0].toString(),
    yearToInput: params.yt?.toString() || defaultYearRange[1].toString(),
    ratingRange: [params.rmin, params.rmax] as [number, number],
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
    authors: searchResult?.authors ?? [],
    minCitations: searchResult?.minCitations ?? null,
    hasAbstract: searchResult?.hasAbstract ?? false,
    includeRetracted: searchResult?.includeRetracted ?? false,
  };
}

/** Updates the search provider's filters in its address. Without a search provider it changes nothing. */
export function useUpdateSearchFilter() {
  // The same hooks on every page, so a component kept across pages keeps its hook order.
  return useUpdateSearchFilterFromUrl();
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
    if ('authors' in updates) {
      batchUpdates.author = updates.authors as string[];
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
    authors,
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
    authors,
    minCitations,
    hasAbstract,
    includeRetracted,
    ...overrides, // Override any fields passed in
  });
} 
