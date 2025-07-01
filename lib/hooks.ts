"use client";

import { useState, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getEffectiveSearchId, getCurrentSearchFormState, DEFAULT_FILTERS } from "@/lib/utils";
import { useResultsStore } from "@/lib/store";
import { useSearchHistoryStore } from "@/lib/store";
import { DateRange } from "react-day-picker";
import useSWR from 'swr';
import { toast } from 'sonner';
import { getSearchResultsWithFilters, SearchWithFiltersParams } from '@/lib/search-utils';
import type { SearchField, SearchFilters } from '@/lib/types';

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
 * Custom hook to get current search form state from search history
 * This replaces useSearchFormStore functionality and properly subscribes to state changes
 */
export function useCurrentSearchFormState() {
  const pathname = usePathname();
  
  // Extract search ID from URL
  const searchId = getEffectiveSearchId(pathname, undefined);
  
  // Use a proper Zustand selector that subscribes to changes in the search history
  // This will trigger re-renders when the specific search result changes
  const searchState = useSearchHistoryStore((state) => 
    searchId ? state.searchHistory.find(item => item.id === searchId) : null
  );
  
  const currentYear = new Date().getFullYear();
  const defaultYearRange = DEFAULT_FILTERS.yearRange();
  
  // Helper function to get field with fallback
  const getField = <T>(field: string, fallback: T): T => {
    if (!searchState) return fallback;
    return (searchState as any)[field] ?? fallback;
  };
  
  return {
    currentSearchField: getField('field', DEFAULT_FILTERS.field),
    dateRange: getField('dateRange', DEFAULT_FILTERS.dateRange),
    sortBy: getField('sortBy', DEFAULT_FILTERS.sortBy),
    filterType: getField('filterType', DEFAULT_FILTERS.filterType),
    yearRange: getField('yearRange', defaultYearRange),
    isYearRangeEnabled: getField('isYearRangeEnabled', DEFAULT_FILTERS.isYearRangeEnabled),
    yearFromInput: getField('yearRange', defaultYearRange)[0]?.toString() || defaultYearRange[0].toString(),
    yearToInput: getField('yearRange', defaultYearRange)[1]?.toString() || defaultYearRange[1].toString(),
    ratingRange: getField('ratingRange', DEFAULT_FILTERS.ratingRange),
    onlyRatedPapers: getField('onlyRatedPapers', DEFAULT_FILTERS.onlyRatedPapers),
    selectedRegions: getField('selectedRegions', DEFAULT_FILTERS.selectedRegions),
    selectedCountryFocus: getField('selectedCountryFocus', DEFAULT_FILTERS.selectedCountryFocus),
    citesItemId: getField('citesItemId', DEFAULT_FILTERS.citesItemId),
    citedByItemId: getField('citedByItemId', DEFAULT_FILTERS.citedByItemId),
    relatedToItemId: getField('relatedToItemId', DEFAULT_FILTERS.relatedToItemId),
    reviewFilter: getField('reviewFilter', DEFAULT_FILTERS.reviewFilter),
  };
}

/**
 * Custom hook to update search filters in history
 * This replaces SearchFormStore setters
 */
export function useUpdateSearchFilter() {
  const pathname = usePathname();
  const { updateSearchResult } = useSearchHistoryStore();
  
  const updateFilter = (updates: Record<string, any>) => {
    const effectiveSearchId = getEffectiveSearchId(pathname, undefined);
    if (effectiveSearchId) {
      // Map field names from component API to SearchResult schema
      const mappedUpdates = { ...updates };
      
      // Map currentSearchField to field
      if ('currentSearchField' in mappedUpdates) {
        mappedUpdates.field = mappedUpdates.currentSearchField;
        delete mappedUpdates.currentSearchField;
      }
      
      updateSearchResult(effectiveSearchId, mappedUpdates);
    }
  };
  
  return updateFilter;
}

/**
 * SWR-based hook for search results - the single source of truth for search data
 * This replaces the Zustand results store
 */
export function useSearchResults() {
  const pathname = usePathname();
  const searchId = getEffectiveSearchId(pathname, undefined);
  const { updateSearchResult } = useSearchHistoryStore();
  const searchState = useSearchHistoryStore((state) => 
    searchId ? state.searchHistory.find(item => item.id === searchId) : null
  );

  // Create SWR key from search parameters
  const swrKey = searchState ? [
    'search-results',
    searchState.query,
    searchState.field,
    searchState.dateRange,
    searchState.sortBy,
    searchState.yearRange,
    searchState.filterType,
    searchState.selectedRegions,
    searchState.selectedCountryFocus,
    searchState.citesItemId,
    searchState.citedByItemId,
    searchState.relatedToItemId,
    searchState.reviewFilter,
  ] : null;

  // SWR fetcher function
  const fetcher = async ([
    _key,
    query,
    searchField,
    dateRange,
    sortBy,
    yearRange,
    filterType,
    selectedRegions,
    selectedCountryFocus,
    citesItemId,
    citedByItemId,
    relatedToItemId,
    reviewFilter,
  ]: any[]) => {
    // Auto-switch from relevance sorting if no query provided
    let effectiveSortBy = sortBy;
    if (sortBy === 'relevance_score:desc' && (!query || query.trim() === '')) {
      effectiveSortBy = 'publication_date:desc'; // Default to newest first
    }
    
    // Create unified filters object
    const filters: SearchFilters = {
      searchField,
      sortBy: effectiveSortBy,
      filterType,
      dateRange,
      yearRange,
      isYearRangeEnabled: searchState?.isYearRangeEnabled, // Use actual value from search state
      ratingRange: undefined, // Rating filters are handled client-side
      onlyRatedPapers: undefined,
      selectedRegions,
      selectedCountryFocus,
      citesItemId,
      citedByItemId,
      relatedToItemId,
      reviewFilter: searchState?.reviewFilter || false,
    };
    
    const params: SearchWithFiltersParams = {
      query,
      filters,
    };

    const result = await getSearchResultsWithFilters(params);
    return result;
  };

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    swrKey,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateOnMount: true,
      revalidateIfStale: true,
      revalidateOnError: false, // Don't retry on error
      dedupingInterval: 10000, // 10 seconds deduplication
      keepPreviousData: true, // Keep previous data while loading new data
      errorRetryCount: 0, // Don't retry failed requests
      errorRetryInterval: 0, // Don't retry failed requests
      onSuccess: (data) => {
        // Update search history count when new data is successfully fetched
        if (data?.results?.meta?.count !== undefined && searchId && searchState) {
          const newCount = data.results.meta.count;
          // Only update if the count has changed to avoid unnecessary re-renders
          if (searchState.count !== newCount) {
            updateSearchResult(searchId, { count: newCount });
          }
        }
      },
      onError: (error, key) => {
        console.error('Search request failed:', error);
        
        // Handle specific error types with detailed messages
        if (error && typeof error === 'object' && 'message' in error) {
          if (error.message.includes('400')) {
            toast.error('Search query too large', {
              description: 'Your search query is too complex or long. Please try simplifying it or using fewer search terms.',
              action: {
                label: 'Retry',
                onClick: () => mutate(),
              },
            });
          } else if (error.message.includes('403')) {
            toast.error('Search request rejected', {
              description: 'The search query contains invalid parameters. Please try simplifying your search.',
              action: {
                label: 'Retry',
                onClick: () => mutate(),
              },
            });
          } else if (error.message.includes('429')) {
            toast.error('Too many requests', {
              description: 'Please wait a moment before trying again.',
              action: {
                label: 'Retry',
                onClick: () => mutate(),
              },
            });
          } else if (error.message.includes('500')) {
            toast.error('Server error', {
              description: 'The search service is temporarily unavailable. Please try again later.',
              action: {
                label: 'Retry',
                onClick: () => mutate(),
              },
            });
          } else if (error.message.toLowerCase().includes('network') || error.message.toLowerCase().includes('fetch')) {
            toast.error('Connection error', {
              description: 'Please check your internet connection and try again.',
              action: {
                label: 'Retry',
                onClick: () => mutate(),
              },
            });
          } else {
            toast.error('Search failed', {
              description: 'An unexpected error occurred. Please try again.',
              action: {
                label: 'Retry',
                onClick: () => mutate(),
              },
            });
          }
        } else {
          toast.error('Search failed', {
            description: 'An unexpected error occurred. Please try again.',
            action: {
              label: 'Retry',
              onClick: () => mutate(),
            },
          });
        }
      },
    }
  );

  return {
    results: data?.results?.results || [],
    totalCount: data?.results?.meta?.count || 0,
    apiUrl: data?.results?.meta?.url || '',
    originalQuery: data?.originalQuery || '',
    enhancedQuery: data?.enhancedQuery || '',
    countryNames: data?.countryNames || [],
    validation: data?.validation || { isValid: true, expandedQuery: '', warnings: [] },
    isLoading, // Initial loading (no data yet)
    isValidating, // Background loading/refetching (has data, getting new data)
    isLoadingResults: isLoading || isValidating, // Combined loading state for UI
    error,
    mutate, // For manual revalidation
    searchState, // Current search parameters
  };
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