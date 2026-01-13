"use client";

import React, { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { SearchHistory } from '@/components/search-history';
import { useUIStore, useSearchHistoryStore } from '@/lib/store';
import { useCurrentSearchFormState, useIsMobile } from '@/lib/hooks';
import { restoreFromHistory } from '@/lib/search/actions';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { History, Loader2 } from 'lucide-react';
import { PageWrapper } from '@/components/PageWrapper';

function HistoryPageContent() {
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
    // Navigate to the search result with full URL params
    const { searchHistory } = useSearchHistoryStore.getState();
    const searchResult = searchHistory[index || 0];
    
    if (searchResult) {
      router.push(restoreFromHistory(searchResult));
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

function HistoryPageFallback() {
  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    </PageWrapper>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<HistoryPageFallback />}>
      <HistoryPageContent />
    </Suspense>
  );
}