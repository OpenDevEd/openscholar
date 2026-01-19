"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { parseAsInteger, useQueryState } from "nuqs";
import { Clock, Search, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useSearchHistoryStore, useUIStore } from "@/lib/store";
import { restoreFromHistory } from "@/lib/search/actions";
import { jsonToCSV, downloadAsFile, uploadFile, triggerFileUpload } from "@/lib/utils";
import { showConfirmation } from "@/lib/confirmation";
import { toasts } from "@/lib/toast-utils";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { COMMAND_CENTER_ITEMS_PER_PAGE } from "@/lib/constants/view-modes";
import type { SearchResult, HistorySortBy } from "@/lib/types";
import {
  CommandCenterContainer,
  CommandCenterHeader,
  CommandCenterToolbar,
  CommandCenterList,
  CommandCenterPagination,
} from "@/components/command-center";
import { HistoryItem } from "./history-item";

const SORT_OPTIONS: { value: HistorySortBy; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "oldest", label: "Oldest" },
  { value: "most", label: "Most Results" },
  { value: "least", label: "Least Results" },
];

export function HistoryCommandCenter() {
  const router = useRouter();
  const [searchFilter, setSearchFilter] = useState("");
  const [currentPage, setCurrentPage] = useQueryState(
    "page",
    parseAsInteger.withDefault(1)
  );

  const { searchHistory, clearSearchHistory, importSearchHistory } = useSearchHistoryStore();
  const { historyViewMode, setHistoryViewMode, historySortBy, setHistorySortBy } = useUIStore();

  // Filter history
  const filteredHistory = useMemo(() => {
    if (!searchFilter.trim()) return searchHistory;
    const query = searchFilter.toLowerCase();
    return searchHistory.filter((item) => {
      const matchesQuery = item.query?.toLowerCase().includes(query);
      const matchesQuestion = item.questionHistory?.some((q) =>
        q.question?.toLowerCase().includes(query)
      );
      return matchesQuery || matchesQuestion;
    });
  }, [searchHistory, searchFilter]);

  // Sort history
  const sortedHistory = useMemo(() => {
    const sorted = [...filteredHistory];
    switch (historySortBy) {
      case "oldest":
        return sorted.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      case "most":
        return sorted.sort((a, b) => (b.count || 0) - (a.count || 0));
      case "least":
        return sorted.sort((a, b) => (a.count || 0) - (b.count || 0));
      case "recent":
      default:
        return sorted.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    }
  }, [filteredHistory, historySortBy]);

  // Pagination
  const totalPages = Math.ceil(sortedHistory.length / COMMAND_CENTER_ITEMS_PER_PAGE);
  const paginatedHistory = useMemo(() => {
    const start = (currentPage - 1) * COMMAND_CENTER_ITEMS_PER_PAGE;
    return sortedHistory.slice(start, start + COMMAND_CENTER_ITEMS_PER_PAGE);
  }, [sortedHistory, currentPage]);

  // Reset to page 1 when filter changes
  React.useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages, setCurrentPage]);

  // Handlers
  const handleSearchClick = (item: SearchResult) => {
    router.push(restoreFromHistory(item));
  };

  // Download handlers
  const handleDownloadJSON = () => {
    try {
      const data = searchHistory.map((item) => {
        const { expandedQuery } = validateAndExpandKeywordsSilently(item.query);
        return {
          search_query: expandedQuery,
          count: item.count,
          field: item.field,
        };
      });
      downloadAsFile(JSON.stringify(data, null, 2), "search_history.json", "json");
      toasts.download.success(data.length, "search entries", "JSON");
    } catch {
      toasts.download.error("JSON");
    }
  };

  const handleDownloadCSV = async () => {
    try {
      const data = searchHistory.map((item) => {
        const { expandedQuery } = validateAndExpandKeywordsSilently(item.query);
        return {
          search_query: expandedQuery,
          count: item.count,
          field: item.field,
        };
      });
      const csv = await jsonToCSV(data);
      downloadAsFile(csv, "search_history.csv", "csv");
      toasts.download.success(data.length, "search entries", "CSV");
    } catch {
      toasts.download.error("CSV");
    }
  };

  const handleUploadJSON = async () => {
    try {
      const file = await triggerFileUpload(".json");
      const data = await uploadFile(file);
      const importedCount = importSearchHistory(data);
      if (importedCount > 0) {
        toasts.upload.success(importedCount, "search entries");
      } else {
        toasts.upload.noValid("search entries");
      }
    } catch (error) {
      toasts.upload.error(error);
    }
  };

  const handleUploadCSV = async () => {
    try {
      const file = await triggerFileUpload(".csv");
      const data = await uploadFile(file);
      const importedCount = importSearchHistory(data);
      if (importedCount > 0) {
        toasts.upload.success(importedCount, "search entries");
      } else {
        toasts.upload.noValid("search entries");
      }
    } catch (error) {
      toasts.upload.error(error);
    }
  };

  const handleClearAll = () => {
    showConfirmation({
      title: "Clear All Search History",
      message: `Are you sure you want to delete all ${searchHistory.length} search entries? This action cannot be undone.`,
      confirmText: "Clear All",
      onConfirm: () => {
        clearSearchHistory();
        toasts.history.cleared();
      },
    });
  };

  return (
    <CommandCenterContainer>
      {/* Header */}
      <CommandCenterHeader
        icon={Clock}
        title="Search History"
        description="View and revisit your previous searches"
        count={sortedHistory.length}
        singular="search"
        plural="searches"
      />

      {/* Toolbar */}
      <CommandCenterToolbar
        viewMode={historyViewMode}
        onViewModeChange={setHistoryViewMode}
        sortOptions={SORT_OPTIONS}
        currentSort={historySortBy}
        onSortChange={setHistorySortBy}
        searchFilter={searchFilter}
        onSearchChange={setSearchFilter}
        placeholder="Search your history..."
        onDownloadJSON={handleDownloadJSON}
        onDownloadCSV={handleDownloadCSV}
        onUploadJSON={handleUploadJSON}
        onUploadCSV={handleUploadCSV}
        onClearAll={handleClearAll}
        clearTooltip="Clear all history"
        totalCount={searchHistory.length}
      />

      {/* List */}
      <div className="p-4 md:p-6">
        <CommandCenterList
          items={paginatedHistory}
          viewMode={historyViewMode}
          keyExtractor={(item) => item.id}
          emptyIcon={Clock}
          emptyTitle="No search history yet"
          emptyDescription="Start searching for academic papers and your search history will appear here."
          emptyAction={
            <Button asChild className="gap-2">
              <Link href="/">
                <Search className="h-4 w-4" />
                Start a Search
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          }
          hasFilter={!!searchFilter.trim()}
          onClearFilter={() => setSearchFilter("")}
          renderItem={(item, index) => (
            <HistoryItem
              item={item}
              index={index}
              viewMode={historyViewMode}
              onSearchClick={handleSearchClick}
            />
          )}
        />

        {/* Pagination */}
        {totalPages > 1 && (
          <CommandCenterPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={sortedHistory.length}
            itemsPerPage={COMMAND_CENTER_ITEMS_PER_PAGE}
            itemLabel="searches"
          />
        )}
      </div>
    </CommandCenterContainer>
  );
}
