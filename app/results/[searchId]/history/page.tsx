"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { SearchHistory } from '@/components/search-history';
import { useUIStore, useSearchHistoryStore } from '@/lib/store';
import { useCurrentSearchFormState } from '@/lib/hooks';
import { restoreFromHistory } from '@/lib/search/actions';
import { appToast } from '@/lib/toast';
import { PageHeader } from '@/components/ui/page-header';
import { History } from 'lucide-react';

interface HistoryPageProps {
  params: Promise<{ searchId: string }>;
}

export default function HistoryPage({ params }: HistoryPageProps) {
  const router = useRouter();
  const { currentSearchField } = useCurrentSearchFormState();
  const { loadingResultIndex } = useUIStore();
  const { searchHistory } = useSearchHistoryStore();
  const [searchId, setSearchId] = React.useState<string>('');

  React.useEffect(() => {
    const getParams = async () => {
      const resolvedParams = await params;
      setSearchId(resolvedParams.searchId);
    };
    getParams();
  }, [params]);

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
      appToast.validation.failed("The requested search could not be found in your history.");
    }
  };

  const handleBackToResults = () => {
    if (searchId) {
      // Navigate back to results with full URL params
      const { getSearchResult } = useSearchHistoryStore.getState();
      const entry = getSearchResult(searchId);
      if (entry) {
        router.push(restoreFromHistory(entry));
      } else {
        router.push('/');
      }
    } else {
      router.push('/');
    }
  };

  return (
    <div className="container mx-auto p-6">
      <PageHeader
        title="Search History"
        description="View and manage your previous searches"
        icon={History}
        showBackButton={true}
        onBack={handleBackToResults}
        stats={{
          count: searchHistory.length,
          label: 'Searches',
          singularLabel: 'Search'
        }}
        infoItems={[
          { label: 'Click any search to revisit results', color: 'bg-blue-500' },
          { label: 'Download or upload search data', color: 'bg-green-500' },
          { label: 'Manage your search archive', color: 'bg-purple-500' }
        ]}
      />

      <SearchHistory
        onSearchResults={handleSearchHistoryClick}
        loadingResultIndex={loadingResultIndex}
        currentSearchField={currentSearchField}
        compact={false}
        currentSearchId={searchId}
        hideHeader={true}
      />
    </div>
  );
} 
