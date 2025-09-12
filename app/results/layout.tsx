"use client";

import React, { createContext } from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { useUIStore } from "@/lib/store";
import { useSearchResults } from "@/lib/hooks";
import { useCurrentSearchFormState, useCreateSearchFilters } from "@/lib/hooks";
import { isDateFilterActive } from "@/lib/utils";
import { updateCurrentSearch } from "@/lib/search-actions";
import { SearchFilters } from "@/lib/types";

interface ResultsLayoutProps {
  children: React.ReactNode;
}

export const SearchContext = createContext<{
  handleUpdateCurrentSearch: (query: string) => void;
  loadingResultIndex: number | null;
}>({
  handleUpdateCurrentSearch: () => {},
  loadingResultIndex: null,
});

export default function ResultsLayout({ children }: ResultsLayoutProps) {
  const router = useRouter();

  const {
    currentSearchField,
    dateRange,
    sortBy,
    filterType,
    yearRange,
    isYearRangeEnabled,
  } = useCurrentSearchFormState();

  // Computed filter active state
  const isFilterActive = isDateFilterActive(
    dateRange,
    yearRange,
    filterType,
    isYearRangeEnabled
  );

  const { loadingResultIndex } = useUIStore();

  const { originalQuery: currentQuery } = useSearchResults();

  const createSearchFilters = useCreateSearchFilters();

  const handleUpdateCurrentSearch = async (query: string) => {
    // Update the current search results with new query
    const formData = new FormData();
    formData.set("query", query);

    // Create filters object from current state
    const filters = createSearchFilters();

    // Update current search without creating a new entry
    await updateCurrentSearch(formData, filters);
    // Note: This updates the existing search entry and stays on the same page
  };

  return (
    <div className="bg-background">
      <SearchContext.Provider value={{ handleUpdateCurrentSearch, loadingResultIndex }}>
        <Navbar
          loadingResultIndex={loadingResultIndex}
        />
      {children}
      </SearchContext.Provider>
    </div>
  );
}
