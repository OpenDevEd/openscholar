"use client";

import { Button } from "@/components/ui/button";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Eye } from "lucide-react";
import dynamic from "next/dynamic";
import { formatDateRange, getFieldLabel } from "@/lib/utils";
import { sortOptions } from "@/lib/constants";
import { FocusMode } from "@/components/ui/focus-mode";
import { SearchForm } from "@/components/search-form";
import { SearchHistory } from "@/components/search-history";
import { ResultsList } from "@/components/results-list";
import { DownloadMenu } from "@/components/download-menu";
import { useSearchFormStore, useUIStore, useResultsStore } from "@/lib/store";
import {
  submitSearch,
  loadSearchResults,
  downloadItem,
  downloadEssentialItem,
  downloadAll,
  openFocusMode,
  closeFocusMode,
} from "@/lib/search-actions";

function PageContent() {
  // Zustand stores
  const {
    currentSearchField,
    dateRange,
    sortBy,
    filterType,
    yearRange,
    isFilterActive,
  } = useSearchFormStore();

  const {
    isDialogOpen,
    loadingResultIndex,
    isLoading,
    isFocusModeOpen,
    setIsDialogOpen,
  } = useUIStore();

  const {
    results,
    currentQuery,
    resultsSearchField,
    resultsDateRange,
    resultsYearRange,
  } = useResultsStore();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
      const formData = new FormData(e.currentTarget);
    await submitSearch(
      formData,
      currentSearchField,
      dateRange,
      sortBy,
      yearRange,
        filterType,
      isFilterActive
    );
  };

  return (
        <main className="min-h-screen p-4 md:p-8 bg-background">
      <div className="w-full space-y-6">
        <SearchForm onSubmit={handleSubmit} isLoading={isLoading} />

        <SearchHistory
          onSearchResults={loadSearchResults}
          loadingResultIndex={loadingResultIndex}
          currentSearchField={currentSearchField}
        />
      </div>

      <ResponsiveModal 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen}
        title={`Search Results for "${currentQuery}" in ${getFieldLabel(
          resultsSearchField
        )}`}
        searchQuery={currentQuery}
        searchField={getFieldLabel(resultsSearchField)}
        resultCount={results.length}
        dateRange={formatDateRange(resultsDateRange, resultsYearRange)}
        sortBy={
          sortOptions.find((opt) => opt.value === sortBy)?.label || "Relevance"
        }
        headerActions={
          results.length > 0 ? (
          <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={openFocusMode}>
              <Eye className="h-4 w-4 mr-2" />
              Focus Mode
            </Button>
              <DownloadMenu
                variant="button"
                size="sm"
                onDownloadJSON={() => downloadAll("json")}
                onDownloadCSV={() => downloadAll("csv")}
                onDownloadEssentialJSON={() => downloadAll("json", true)}
                onDownloadEssentialCSV={() => downloadAll("csv", true)}
              />
            </div>
          ) : undefined
        }
      >
        <ResultsList
          onDownloadItem={downloadItem}
          onDownloadEssentialItem={downloadEssentialItem}
          onOpenFocusMode={openFocusMode}
        />
      </ResponsiveModal>

      <FocusMode
        isOpen={isFocusModeOpen}
        onClose={closeFocusMode}
        papers={results}
        onDownloadItem={downloadItem}
        onDownloadEssentialItem={downloadEssentialItem}
      />
    </main>
  );
}

export default dynamic(() => Promise.resolve(PageContent), { ssr: false });
