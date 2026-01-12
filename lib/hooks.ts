"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getEffectiveSearchId, DEFAULT_FILTERS } from "@/lib/utils";
import { useSearchHistoryStore } from "@/lib/store";
import { DateRange } from "react-day-picker";
import type { SearchField, SearchFilters } from '@/lib/types';

// Import the new search context
import { useSearchOptional } from './search';

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
  
  return getEffectiveSearchId(pathname, undefined);
}

/**
 * Custom hook to get the current effective query from any context.
 * This works across all pages and provides the most relevant query:
 * 1. From URL search params (if present)
 * 2. From current search results (if on results page)
 * 3. From the most recent search in history (fallback)
 * 4. Empty string (if no context available)
 */
export function useEffectiveQuery(): string {
  const pathname = usePathname();
  let searchParams = null;
  
  // Try to get search params, but handle SSR gracefully
  try {
    searchParams = useSearchParams();
  } catch (error) {
    // During SSR, useSearchParams might not be available
    searchParams = null;
  }
  
  const { searchHistory } = useSearchHistoryStore();
  const effectiveSearchId = useEffectiveSearchId();
  
  // Priority 1: URL search params (client-side only)
  const urlQuery = searchParams?.get('q');
  if (urlQuery) {
    return urlQuery;
  }
  
  // Priority 2: Query from search history if we have a search ID
  if (effectiveSearchId && searchHistory.length > 0) {
    const searchResult = searchHistory.find(result => result.id === effectiveSearchId);
    if (searchResult?.query) {
      return searchResult.query;
    }
  }
  
  // Priority 3: Empty string
  return '';
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
  const isOnResultsPage = pathname?.startsWith('/results');
  
  // Only use URL-based state on results pages
  // For other pages, use store defaults
  if (!isOnResultsPage) {
    return useCurrentSearchFormStateFromStore();
  }
  
  return useCurrentSearchFormStateFromUrl();
}

/**
 * Internal hook that uses URL-based state via useSearch context
 * Only use this on pages with results (or wrapped in Suspense)
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
  };
}

/**
 * Custom hook to update search filters via URL params
 * Updated to use URL as source of truth
 * 
 * NOTE: This hook uses useSearchState() which requires being on a results page
 * or being wrapped in a Suspense boundary.
 */
export function useUpdateSearchFilter() {
  const pathname = usePathname();
  const isOnResultsPage = pathname?.startsWith('/results');
  
  // On results pages, use URL-based state
  if (isOnResultsPage) {
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
    
    if ('currentSearchField' in updates || 'field' in updates) {
      search.setField((updates.currentSearchField || updates.field) as SearchField);
    }
    if ('sortBy' in updates) {
      search.setSort(updates.sortBy as string);
    }
    if ('filterType' in updates) {
      search.setFilterType(updates.filterType as 'date' | 'year');
    }
    if ('yearRange' in updates) {
      const range = updates.yearRange as [number, number] | undefined;
      search.setYearRange(range?.[0] ?? null, range?.[1] ?? null);
    }
    if ('isYearRangeEnabled' in updates) {
      // If disabling year range, clear the values
      if (!updates.isYearRangeEnabled) {
        search.setYearRange(null, null);
      }
    }
    if ('dateRange' in updates) {
      const range = updates.dateRange as DateRange | undefined;
      search.setDateRange(range?.from ?? null, range?.to ?? null);
    }
    if ('ratingRange' in updates) {
      const range = updates.ratingRange as [number, number];
      search.setRatingRange(range[0], range[1]);
    }
    if ('onlyRatedPapers' in updates) {
      search.setOnlyRated(updates.onlyRatedPapers as boolean);
    }
    if ('selectedRegions' in updates) {
      search.setRegions(updates.selectedRegions as string[]);
    }
    if ('selectedCountryFocus' in updates) {
      search.setCountryFocus(updates.selectedCountryFocus as string[]);
    }
    if ('citesItemId' in updates) {
      search.setCites(updates.citesItemId as string);
    }
    if ('citedByItemId' in updates) {
      search.setCitedBy(updates.citedByItemId as string);
    }
    if ('relatedToItemId' in updates) {
      search.setRelatedTo(updates.relatedToItemId as string);
    }
    if ('reviewFilter' in updates) {
      search.setReviewOnly(updates.reviewFilter as boolean);
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
    ...overrides, // Override any fields passed in
  });
} 