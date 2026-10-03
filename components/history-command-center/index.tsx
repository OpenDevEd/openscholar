"use client";
"use no memo"; // Date.now in posthog handler

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { parseAsInteger, useQueryState } from "nuqs";
import { Clock, Search, ArrowRight, HistoryIcon } from "@/components/icons";
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
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation-browser";
import { COMMAND_CENTER_ITEMS_PER_PAGE } from "@/lib/constants/view-modes";
import type { SearchResult, HistorySortBy } from "@/lib/types";
import {
  CommandCenterContainer,
  CommandCenterToolbar,
  CommandCenterList,
  CommandCenterPagination,
} from "@/components/command-center";
import { CommandCenterFileActions, CommandCenterFilters } from "@/components/command-center/command-center-toolbar";
import { ViewModeSwitch } from "@/components/view-mode-toggle";
import { HistoryItem } from "./history-item";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { ListLoading } from "@/components/evidence-libraries/list-controls";
import { usePersistedStoreReady } from "@/lib/use-persisted-store-ready";
import { useResearchStatus } from "@/lib/research/provider";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";

import posthog from "posthog-js";

interface HistoryCommandCenterProps {
  /**
   * Turns the page into a chooser: picking a search hands it to the caller
   * instead of opening it, the page number stays out of the URL, and the
   * import, export and clear-all tools are left out.
   */
  pick?: { label: string; onPick: (item: SearchResult) => void; excludeId?: string };
}

export function HistoryCommandCenter({ pick }: HistoryCommandCenterProps = {}) {
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
  const [urlPage, setUrlPage] = useQueryState(
    "page",
    parseAsInteger.withDefault(1).withOptions({ scroll: true }),
  );
  const [localPage, setLocalPage] = useState(1);
  const currentPage = pick ? localPage : urlPage;
  const setCurrentPage = (page: number) => (pick ? setLocalPage(page) : void setUrlPage(page));

  const { searchHistory: allHistory, clearSearchHistory, importSearchHistory } =
    useSearchHistoryStore();
  const excludeId = pick?.excludeId;
  const searchHistory = useMemo(
    () => (excludeId ? allHistory.filter((item) => item.id !== excludeId) : allHistory),
    [allHistory, excludeId],
  );
  const { ready: listReady, error, retry } = useResearchStatus();
  const settingsReady = usePersistedStoreReady(useUIStore);
  const ready = listReady && settingsReady;
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
      // A search held in this browser has all its questions; an account's keeps their text.
      const matchesQuestion = item.questionHistory
        ? item.questionHistory.some((entry) => entry.question.toLowerCase().includes(query))
        : item.questionText.toLowerCase().includes(query);
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
    if (pick) {
      pick.onPick(item);
      return;
    }
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
    } catch {
      toast.io.downloadFailed(tToast("entityCsv"));
    }
  };

  const handleUploadJSON = async () => {
    try {
      const file = await triggerFileUpload(".json");
      const data = await uploadFile(file);
      importSearchHistory(data);
    } catch (error) {
      toast.io.uploadFailed(tToast("entityJson"), error);
    }
  };

  const handleUploadCSV = async () => {
    try {
      const file = await triggerFileUpload(".csv");
      const data = await uploadFile(file);
      importSearchHistory(data);
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
      },
    });
  };

  const filters = {
    sortOptions: SORT_OPTIONS,
    currentSort: historySortBy,
    onSortChange: setHistorySortBy,
    searchFilter,
    onSearchChange: setSearchFilter,
    placeholder: th("searchPlaceholder"),
  };

  const list = (
    <div className="p-4 md:p-6">
      {!ready ? error ? <AuthStatePanel variant="sync_error_retry" onRetry={retry} /> : <ListLoading label={tc("loading")} /> : <CommandCenterList
        items={paginatedHistory}
        viewMode={historyViewMode}
        keyExtractor={(item) => item.id}
        emptyIcon={Clock}
        emptyTitle={th("noHistoryYet")}
        emptyDescription={th("noHistoryDescription")}
        emptyAction={pick ? undefined : (
          <Button asChild size="sm" className="gap-2">
            <Link href="/">
              <Search className="h-4 w-4" />
              {th("startSearch")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
        hasFilter={!!searchFilter.trim()}
        onClearFilter={() => setSearchFilter("")}
        renderItem={(item, index) => (
          <HistoryItem
            item={item}
            index={index}
            viewMode={historyViewMode}
            onSearchClick={handleSearchClick}
            pickLabel={pick?.label}
          />
        )}
      />}

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
  );

  // A chooser sits in its host's frame with its own toolbar; the page puts its controls in the page bar.
  if (pick) return <CommandCenterContainer><CommandCenterToolbar viewMode={historyViewMode} onViewModeChange={setHistoryViewMode} {...filters} />{list}</CommandCenterContainer>;
  return <HistoryPageFrame
    tabs={<ViewModeSwitch value={historyViewMode} onChange={setHistoryViewMode} />}
    filters={<CommandCenterFilters {...filters} />}
    actions={<CommandCenterFileActions
      onDownloadJSON={handleDownloadJSON}
      onDownloadCSV={handleDownloadCSV}
      onUploadJSON={handleUploadJSON}
      onUploadCSV={handleUploadCSV}
      onClearAll={handleClearAll}
      clearTooltip={th("clearAllHistory")}
      totalCount={searchHistory.length}
    />}
  >{list}</HistoryPageFrame>;
}

/** The history page's frame, shared with its loading state so nothing moves when it loads. */
export function HistoryPageFrame({ children, ...controls }: { children: React.ReactNode; tabs?: React.ReactNode; filters?: React.ReactNode; actions?: React.ReactNode }) {
  const tc = useTranslations("common");
  return <LibraryPageShell icon={HistoryIcon} title={tc("searchHistory")} {...controls}>{children}</LibraryPageShell>;
}

export function HistoryLoading() {
  const tc = useTranslations("common");
  return <HistoryPageFrame><ListLoading label={tc("loading")} /></HistoryPageFrame>;
}
