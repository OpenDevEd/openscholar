"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ResultsList } from "./results-list";
import {
  downloadItem,
  downloadEssentialItem,
  downloadAll,
} from "@/lib/search-actions";
import { useAppToast } from "@/lib/toast";
import { useSearch } from "@/lib/search";
import { PageWrapper } from "./PageWrapper";
import { useTranslations } from "next-intl";
import { SidebarLayout } from "@/components/shared/sidebar-layout";
import { SearchFilterSidebar } from "./search-filter-sidebar";

interface ResultsPageContentProps {
  searchId?: string;
}

export default function ResultsPageContent({
  searchId,
}: ResultsPageContentProps) {
  const tToast = useTranslations("toast");
  const toast = useAppToast();
  const downloadLabels = {
    item: tToast("entityItem"),
    essentialItem: tToast("entityEssentialItem"),
    results: tToast("entityResults"),
  };
  const router = useRouter();

  // Use the new search context
  const {
    params,
    results,
    totalCount,
    isLoading,
    isValidating,
    toSearchFilters,
    oql,
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
      searchId,
      oql,
    };
  }, [query, searchId, toSearchFilters, oql]);

  const handleBackToHome = () => {
    router.push("/");
  };

  return (
    <SidebarLayout sidebar={<SearchFilterSidebar />}>
      <PageWrapper>
        <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
          <main className="w-full">
            <ResultsList
              onDownloadItem={(item, format) =>
                downloadItem(item, format, toast, searchState, downloadLabels)
              }
              onDownloadEssentialItem={(item, format) =>
                downloadEssentialItem(item, format, toast, searchState, downloadLabels)
              }
              onDownloadAllJSON={() =>
                downloadAll("json", toast, false, searchState, results, downloadLabels)
              }
              onDownloadAllCSV={() =>
                downloadAll("csv", toast, false, searchState, results, downloadLabels)
              }
              onDownloadAllEssentialJSON={() =>
                downloadAll("json", toast, true, searchState, results, downloadLabels)
              }
              onDownloadAllEssentialCSV={() =>
                downloadAll("csv", toast, true, searchState, results, downloadLabels)
              }
              isLoading={isLoading}
              isValidating={isValidating}
              currentQuery={query}
              onBackToHome={handleBackToHome}
            />
          </main>
        </div>
      </PageWrapper>
    </SidebarLayout>
  );
}
