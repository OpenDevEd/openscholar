"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { ResultsList } from './results-list';
import {
  downloadItem,
  downloadEssentialItem,
  downloadAll,
} from '@/lib/search-actions';
import { useSearch } from '@/lib/search';
import { SearchSidebar } from './search-sidebar';
import { TwoColumnLayout } from './layout/two-column-layout';
import { ContentScrollArea } from './layout/content-scroll-area';
import { useFilterSidebarOptional } from './filter-sidebar-provider';
import { PageWrapper } from './PageWrapper';

interface ResultsPageContentProps {
  searchId?: string;
}

export default function ResultsPageContent({ searchId }: ResultsPageContentProps) {
  const router = useRouter();

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

  const filterSidebar = useFilterSidebarOptional();
  const isFilterSidebarVisible = filterSidebar && !filterSidebar.isMobile && !filterSidebar.isCollapsed;
  const filterSidebarWidth = `${filterSidebar?.currentWidth || 320}px`;

  return (
    <PageWrapper>
      <TwoColumnLayout
        leftColumn={<SearchSidebar mode="panel" />}
        rightColumn={
          <ContentScrollArea>
            <div className="py-6 px-4 md:px-6">
            <main className="w-full">
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
          </ContentScrollArea>
        }
        leftColumnWidth={filterSidebarWidth}
        className="h-full"
      />
    </PageWrapper>
  );
}
