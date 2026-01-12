"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { SearchSidebar } from './search-sidebar';
import { ResultsList } from './results-list';
import {
  downloadItem,
  downloadEssentialItem,
  downloadAll,
} from '@/lib/search-actions';
import { useIsMobile } from '@/lib/hooks';
import { useSearch } from '@/lib/search';

interface ResultsPageContentProps {
  searchId?: string;
}

export default function ResultsPageContent({ searchId }: ResultsPageContentProps) {
  const router = useRouter();
  const isMobile = useIsMobile();

  // Use the new search context
  const {
    params,
    results,
    totalCount,
    isLoading,
    isValidating,
    toSearchFilters,
  } = useSearch();

  const query = params.q;

  // Create a searchState-like object for download functions
  const searchState = React.useMemo(() => {
    const filters = toSearchFilters();
    return {
      query,
      field: filters.searchField,
      dateRange: filters.dateRange,
      yearRange: filters.yearRange,
    };
  }, [query, toSearchFilters]);

  const handleBackToHome = () => {
    router.push('/');
  };

  return (
    <>
      <div className="container mx-auto p-6 pb-0">
        <div className="flex gap-6">
          {/* Desktop Sidebar */}
          <aside className="hidden lg:block flex-shrink-0">
            <SearchSidebar />
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0 relative">
            <ResultsList
              onDownloadItem={(item, format) => downloadItem(item, format, searchState)}
              onDownloadEssentialItem={(item, format) => downloadEssentialItem(item, format, searchState)}
              onDownloadAllJSON={() => downloadAll("json", false, searchState, results)}
              onDownloadAllCSV={() => downloadAll("csv", false, searchState, results)}
              onDownloadAllEssentialJSON={() => downloadAll("json", true, searchState, results)}
              onDownloadAllEssentialCSV={() => downloadAll("csv", true, searchState, results)}
              isLoading={isLoading}
              isValidating={isValidating}
              currentQuery={query}
              onBackToHome={handleBackToHome}
            />
          </main>
        </div>
      </div>
    </>
  );
}
