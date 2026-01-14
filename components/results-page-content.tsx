"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ResultsList } from "./results-list";
import {
  downloadItem,
  downloadEssentialItem,
  downloadAll,
} from "@/lib/search-actions";
import { useSearch } from "@/lib/search";
import { SearchSidebar } from "./search-sidebar";
import { TwoColumnLayout } from "./layout/two-column-layout";
import { useFilterSidebarOptional } from "./filter-sidebar-provider";
import { PageWrapper } from "./PageWrapper";

interface ResultsPageContentProps {
  searchId?: string;
}

export default function ResultsPageContent({
  searchId,
}: ResultsPageContentProps) {
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
    router.push("/");
  };

  return (
    <div className="flex flex-col flex-1 w-full">
      <TwoColumnLayout
        leftColumn={<SearchSidebar mode="panel" />}
        rightColumn={
          <PageWrapper>
            <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
              <main className="w-full">
                <ResultsList
                  onDownloadItem={(item, format) =>
                    downloadItem(item, format, searchState)
                  }
                  onDownloadEssentialItem={(item, format) =>
                    downloadEssentialItem(item, format, searchState)
                  }
                  onDownloadAllJSON={() =>
                    downloadAll("json", false, searchState, results)
                  }
                  onDownloadAllCSV={() =>
                    downloadAll("csv", false, searchState, results)
                  }
                  onDownloadAllEssentialJSON={() =>
                    downloadAll("json", true, searchState, results)
                  }
                  onDownloadAllEssentialCSV={() =>
                    downloadAll("csv", true, searchState, results)
                  }
                  isLoading={isLoading}
                  isValidating={isValidating}
                  currentQuery={query}
                  onBackToHome={handleBackToHome}
                />
              </main>
            </div>
          </PageWrapper>
        }
      />
    </div>
  );
}
