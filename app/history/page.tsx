"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { SearchHistory } from '@/components/search-history';
import { useUIStore, useSearchHistoryStore } from '@/lib/store';
import { useCurrentSearchFormState, useIsMobile } from '@/lib/hooks';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { History } from 'lucide-react';
import { PageWrapper } from '@/components/PageWrapper';

export default function HistoryPage() {
  const router = useRouter();
  const { currentSearchField } = useCurrentSearchFormState();
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
    // With SWR, we just need to navigate to the search result
    // The data will be automatically loaded by the SWR hook
    const { searchHistory } = useSearchHistoryStore.getState();
    const searchResult = searchHistory[index || 0];
    
    if (searchResult?.id) {
      router.push(`/results/${searchResult.id}`);
    } else {
      toast.error('Search not found', {
        description: 'The requested search could not be found in your history.'
      });
    }
  };

  const handleBackToHome = () => {
    router.push('/');
  };

  return (
    <PageWrapper>
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
    </PageWrapper>
  );
} 