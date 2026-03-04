"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SearchHistory } from '@/components/search-history';
import { useUIStore, useSearchHistoryStore } from '@/lib/store';
import { useCurrentSearchFormState } from '@/lib/hooks';
import { restoreFromHistory } from '@/lib/search/actions';
import { useAppToast } from '@/lib/toast';
import { PageHeader } from '@/components/ui/page-header';
import { History } from 'lucide-react';
import type { SearchField } from '@/lib/types/search.types';
import type { DateRange } from 'react-day-picker';

interface HistoryPageProps {
  params: Promise<{ searchId: string }>;
}

export default function HistoryPage({ params }: HistoryPageProps) {
  const router = useRouter();
  const toast = useAppToast();
  const tc = useTranslations('common');
  const th = useTranslations('historyPage');
  const te = useTranslations('errorPages');
  const tcc = useTranslations('commandCenter');
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
    searchField: SearchField,
    dateRange?: DateRange,
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
      toast.validation.failed(te("searchNotFound"));
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
        title={tc("history")}
        description={th("description")}
        icon={History}
        showBackButton={true}
        onBack={handleBackToResults}
        stats={{
          count: searchHistory.length,
          label: tcc("searchPlural"),
          singularLabel: tcc("searchSingular")
        }}
        infoItems={[
          { label: th("infoClickToRevisit"), color: "bg-blue-500" },
          { label: th("infoDownloadUpload"), color: "bg-green-500" },
          { label: th("infoManageArchive"), color: "bg-purple-500" },
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
