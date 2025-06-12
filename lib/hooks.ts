"use client";

import { useState, useEffect } from "react";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { useKeywordExpansionDialogStore } from "@/lib/store";
import { usePathname, useSearchParams } from "next/navigation";
import { useSearchFormStore } from "@/lib/store";
import { getEffectiveSearchId } from "@/lib/utils";
import { useResultsStore } from "@/lib/store";
import { useSearchHistoryStore } from "@/lib/store";

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

// Custom hook to handle query changes with keyword expansion
export function useQueryChangeHandler(setQuery: (query: string) => void) {
  const { setSuggestedQuery } = useKeywordExpansionDialogStore();

  return (newQuery: string) => {
    setQuery(newQuery);
    const { expandedQuery } = validateAndExpandKeywordsSilently(newQuery);
    setSuggestedQuery(expandedQuery);
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
  const { currentSearchId } = useSearchFormStore();
  
  return getEffectiveSearchId(pathname, currentSearchId);
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
  
  const { currentQuery } = useResultsStore();
  const { searchHistory } = useSearchHistoryStore();
  const effectiveSearchId = useEffectiveSearchId();
  
  // Priority 1: URL search params (client-side only)
  const urlQuery = searchParams?.get('q');
  if (urlQuery) {
    return urlQuery;
  }
  
  // Priority 2: Current results query (if on results page with loaded results)
  if (pathname?.startsWith('/results') && currentQuery) {
    return currentQuery;
  }
  
  // Priority 3: Query from search history if we have a search ID
  if (effectiveSearchId && searchHistory.length > 0) {
    const searchResult = searchHistory.find(result => result.id === effectiveSearchId);
    if (searchResult?.query) {
      return searchResult.query;
    }
  }
  
  // Priority 4: Most recent search from history (fallback for any page)
  if (searchHistory.length > 0) {
    return searchHistory[0].query;
  }
  
  // Priority 5: Empty string
  return '';
} 