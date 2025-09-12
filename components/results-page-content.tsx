"use client";

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Navbar } from './navbar';
import { SearchSidebar } from './search-sidebar';
import { ResultsList } from './results-list';
import { useUIStore } from '@/lib/store';
import {
  submitSearchAndLoadResults,
  updateCurrentSearch,
  downloadItem,
  downloadEssentialItem,
  downloadAll,
  openFocusMode,
} from '@/lib/search-actions';
import { FocusMode } from '@/components/ui/focus-mode';
import { Eye } from 'lucide-react';
import { DownloadMenu } from './download-menu';
import { useIsMobile, useEffectiveSearchId, useCurrentSearchFormState, useSearchResults } from '@/lib/hooks';
import { isDateFilterActive } from '@/lib/utils';
import { validateAndExpandKeywordsSilently } from '@/lib/keyword-validation';

interface ResultsPageContentProps {
  searchId?: string;
}

export default function ResultsPageContent({ searchId }: ResultsPageContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const hasAttemptedLoad = React.useRef(false);

  const {
    currentSearchField,
    dateRange,
    sortBy,
    filterType,
    yearRange,
    isYearRangeEnabled,
  } = useCurrentSearchFormState();

  // Computed filter active state
  const isFilterActive = isDateFilterActive(dateRange, yearRange, filterType, isYearRangeEnabled);

  const effectiveSearchId = useEffectiveSearchId();

  const {
    isFocusModeOpen,
    loadingResultIndex,
  } = useUIStore();

  const {
    results,
    totalCount,
    originalQuery: currentQuery,
    searchState,
    isLoading,
    isValidating,
    isLoadingResults,
  } = useSearchResults();

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
              currentQuery={currentQuery}
              onBackToHome={handleBackToHome}
            />
          </main>
        </div>
      </div>

      <FocusMode
        isOpen={isFocusModeOpen}
        onClose={() => useUIStore.getState().setIsFocusModeOpen(false)}
        papers={results}
        onDownloadItem={(item, format) => downloadItem(item, format, searchState)}
        onDownloadEssentialItem={(item, format) => downloadEssentialItem(item, format, searchState)}
      />
    </>
  );
} 