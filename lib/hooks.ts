"use client";

import { useState, useEffect } from "react";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { useKeywordExpansionDialogStore } from "@/lib/store";

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