"use client";
"use no memo"; // createHistoryListItem + Date.now in posthog handler

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { parseAsInteger, useQueryState } from "nuqs";
import { Clock, Search, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useSearchHistoryStore, useUIStore } from "@/lib/store";
import { restoreFromHistory } from "@/lib/search/actions";
import {
  jsonToCSV,
  downloadAsFile,
  uploadFile,
  triggerFileUpload,
} from "@/lib/utils";
import { showConfirmation } from "@/lib/confirmation";
import { useAppToast } from "@/lib/toast";
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
import type { ViewMode } from "@/lib/types";

function createHistoryListItem(
  viewMode: ViewMode,
  onSearchClick: (item: SearchResult) => void
) {
  return function HistoryListItem({
    item,
    index,
  }: {
    item: SearchResult;
    index: number;
  }) {
    return (
      <HistoryItem
        item={item}
        index={index}
        viewMode={viewMode}
        onSearchClick={onSearchClick}
      />
    );
  };
}
import posthog from "posthog-js";

export function HistoryCommandCenter() {
  const toast = useAppToast();
  const th = useTranslations("historyPage");
  const tc = useTranslations("common");
  const tcc = useTranslations("commandCenter");
  const tToast = useTranslations("toast");

  const SORT_OPTIONS: { value: HistorySortBy; label: string }[] = [
    { value: "recent", label: tc("recent") },
    { value: "oldest", label: tc("oldest") },
    { value: "most", label: th("mostResults") },
    { value: "least", label: th("leastResults") },
  ];
  const router = useRouter();
  const [searchFilter, setSearchFilter] = useState("");
  const [currentPage, setCurrentPage] = useQueryState(
    "page",
    parseAsInteger.withDefault(1).withOptions({ scroll: true }),
  );

  const { searchHistory, clearSearchHistory, importSearchHistory } =
    useSearchHistoryStore();
  const {
    historyViewMode,
    setHistoryViewMode,
    historySortBy,
    setHistorySortBy,
  } = useUIStore();

  // Filter history
  const filteredHistory = useMemo(() => {
    if (!searchFilter.trim()) return searchHistory;
    const query = searchFilter.toLowerCase();
    return searchHistory.filter((item) => {
      const matchesQuery = item.query?.toLowerCase().includes(query);
      const matchesQuestion = item.questionHistory?.some((q) =>
        q.question?.toLowerCase().includes(query),
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
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      case "most":
        return sorted.sort((a, b) => (b.count || 0) - (a.count || 0));
      case "least":
        return sorted.sort((a, b) => (a.count || 0) - (b.count || 0));
      case "recent":
      default:
        return sorted.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
    }
  }, [filteredHistory, historySortBy]);

  // Pagination
  const totalPages = Math.ceil(
    sortedHistory.length / COMMAND_CENTER_ITEMS_PER_PAGE,
  );
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
    // Track history item restored event
    posthog.capture("history_item_restored", {
      query: item.query,
      results_count: item.count || 0,
      has_screening_questions: (item.screeningQuestions?.length || 0) > 0,
      screening_questions_count: item.screeningQuestions?.length || 0,
      history_age_days: Math.floor(
        (Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      ),
    });

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
      downloadAsFile(
        JSON.stringify(data, null, 2),
        "search_history.json",
        "json",
      );
      toast.io.downloadSuccess(data.length, tToast("entitySearchEntries"), tToast("entityJson"));
    } catch {
      toast.io.downloadFailed(tToast("entityJson"));
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
      toast.io.downloadSuccess(data.length, tToast("entitySearchEntries"), tToast("entityCsv"));
    } catch {
      toast.io.downloadFailed(tToast("entityCsv"));
    }
  };

  const handleUploadJSON = async () => {
    try {
      const file = await triggerFileUpload(".json");
      const data = await uploadFile(file);
      const importedCount = importSearchHistory(data);
      if (importedCount > 0) {
        toast.io.uploadSuccess(importedCount, tToast("entitySearchEntries"));
      } else {
        toast.io.uploadNoValid(tToast("entitySearchEntries"));
      }
    } catch (error) {
      toast.io.uploadFailed(tToast("entityJson"), error);
    }
  };

  const handleUploadCSV = async () => {
    try {
      const file = await triggerFileUpload(".csv");
      const data = await uploadFile(file);
      const importedCount = importSearchHistory(data);
      if (importedCount > 0) {
        toast.io.uploadSuccess(importedCount, tToast("entitySearchEntries"));
      } else {
        toast.io.uploadNoValid(tToast("entitySearchEntries"));
      }
    } catch (error) {
      toast.io.uploadFailed(tToast("entityCsv"), error);
    }
  };

  const handleClearAll = () => {
    showConfirmation({
      title: th("clearAllHistoryTitle"),
      message: th("clearAllHistoryConfirm", { count: searchHistory.length }),
      confirmText: tc("clearAll"),
      cancelText: tc("cancel"),
      onConfirm: () => {
        clearSearchHistory();
        toast.entity.cleared(tToast("entitySearchHistory"), searchHistory.length);
      },
    });
  };

  return (
    <CommandCenterContainer>
      {/* Header */}
      <CommandCenterHeader
        icon={Clock}
        title={tc("searchHistory")}
        description={th("description")}
        count={sortedHistory.length}
        singular={tcc("searchSingular")}
        plural={tcc("searchPlural")}
        countLabel={tcc("searchCount", { count: sortedHistory.length })}
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
        placeholder={th("searchPlaceholder")}
        onDownloadJSON={handleDownloadJSON}
        onDownloadCSV={handleDownloadCSV}
        onUploadJSON={handleUploadJSON}
        onUploadCSV={handleUploadCSV}
        onClearAll={handleClearAll}
        clearTooltip={th("clearAllHistory")}
        totalCount={searchHistory.length}
      />

      {/* List */}
      <div className="p-4 md:p-6">
        <CommandCenterList
          items={paginatedHistory}
          viewMode={historyViewMode}
          keyExtractor={(item) => item.id}
          emptyIcon={Clock}
          emptyTitle={th("noHistoryYet")}
          emptyDescription={th("noHistoryDescription")}
          emptyAction={
            <Button asChild className="gap-2">
              <Link href="/">
                <Search className="h-4 w-4" />
                {th("startSearch")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          }
          hasFilter={!!searchFilter.trim()}
          onClearFilter={() => setSearchFilter("")}
          ItemComponent={createHistoryListItem(
            historyViewMode,
            handleSearchClick
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
            itemLabel={tcc("searchesLabel")}
          />
        )}
      </div>
    </CommandCenterContainer>
  );
}
