"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/navbar';
import { useUIStore } from '@/lib/store';
import { useSearchResults } from '@/lib/hooks';
import { useCurrentSearchFormState } from '@/lib/hooks';
import { isDateFilterActive } from '@/lib/utils';
import {
  submitSearchAndLoadResults,
  updateCurrentSearch,
} from '@/lib/search-actions';

interface ResultsLayoutProps {
  children: React.ReactNode;
}

export default function ResultsLayout({ children }: ResultsLayoutProps) {
  const router = useRouter();

  const {
    currentSearchField,
    dateRange,
    sortBy,
    filterType,
    yearRange,
  } = useCurrentSearchFormState();

  // Computed filter active state
  const isFilterActive = isDateFilterActive(dateRange, yearRange, filterType);

  const {
    loadingResultIndex,
  } = useUIStore();

  const { 
    originalQuery: currentQuery,
  } = useSearchResults();

  const handleUpdateCurrentSearch = async (query: string) => {
    // Update the current search results with new query
    const formData = new FormData();
    formData.set('query', query);
    
    // Update current search without creating a new entry
    await updateCurrentSearch(
      formData,
      currentSearchField,
      dateRange,
      sortBy,
      yearRange,
      filterType,
      isFilterActive
    );
    // Note: This updates the existing search entry and stays on the same page
  };

  const handleNewSearch = async (query: string) => {
    // Create a completely new search
    const formData = new FormData();
    formData.set('query', query);
    
    // Submit search and load results in one call, get the search ID
    const { searchId: newSearchId } = await submitSearchAndLoadResults(
      formData,
      currentSearchField,
      dateRange,
      sortBy,
      yearRange,
      filterType,
      isFilterActive
    );

    // Only navigate if search was successful (searchId is not null)
    if (newSearchId) {
      router.push(`/results/${newSearchId}`);
    }
  };

  return (
    <div className="bg-background">
      <Navbar
        onSearchSubmit={handleUpdateCurrentSearch}
        onNewSearch={handleNewSearch}
        loadingResultIndex={loadingResultIndex}
      />
      {children}
    </div>
  );
} 