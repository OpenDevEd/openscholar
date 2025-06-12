"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { SearchHistory } from '@/components/search-history';
import { useSearchFormStore, useUIStore, useSearchHistoryStore } from '@/lib/store';
import { handleSearchHistoryClick as sharedHandleSearchHistoryClick } from '@/lib/search-actions';
import { PageHeader } from '@/components/ui/page-header';
import { History } from 'lucide-react';
import { useIsMobile } from '@/lib/hooks';

export default function HistoryPage() {
  const router = useRouter();
  const { currentSearchField } = useSearchFormStore();
  const { loadingResultIndex } = useUIStore();
  const { searchHistory } = useSearchHistoryStore();
  const isMobile = useIsMobile();

  const handleSearchHistoryClick = async (
    query: string,
    searchField: any,
    dateRange?: any,
    sortBy?: string,
    yearRange?: [number, number],
    filterType?: "date" | "year",
    index?: number
  ) => {
    const newSearchId = await sharedHandleSearchHistoryClick(
      query,
      searchField,
      dateRange,
      sortBy,
      yearRange,
      filterType,
      index
    );
    
    // Only navigate if loading was successful (searchId is not null)
    if (newSearchId) {
      router.push(`/results/${newSearchId}`);
    }
  };

  const handleBackToHome = () => {
    router.push('/');
  };

  return (
    <div className="bg-background">
      <div className="container mx-auto p-4 sm:p-6">
        <PageHeader
          title="Search History"
          description="View and manage your previous searches"
          icon={History}
          showBackButton={true}
          onBack={handleBackToHome}
          stats={{
            count: searchHistory.length,
            label: 'Searches',
            singularLabel: 'Search'
          }}
          infoItems={!isMobile ? [
            { label: 'Click any search to revisit results', color: 'bg-blue-500' },
            { label: 'Download or upload search data', color: 'bg-green-500' },
            { label: 'Manage your search archive', color: 'bg-purple-500' }
          ] : undefined}
        />

        <SearchHistory
          onSearchResults={handleSearchHistoryClick}
          loadingResultIndex={loadingResultIndex}
          currentSearchField={currentSearchField}
          compact={isMobile}
          currentSearchId=""
          hideHeader={true}
        />
      </div>
    </div>
  );
} 