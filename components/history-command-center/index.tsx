"use client";
"use no memo"; // Date.now in posthog handler

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useConvex } from "convex/react";
import { Clock, Search, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { localSearchHistoryStore, useSearchHistoryStore, useUIStore } from "@/lib/store";
import { restoreFromHistory } from "@/lib/search/actions";
import {
  jsonToCSV,
  downloadAsFile,
  uploadFile,
  triggerFileUpload,
} from "@/lib/utils";
import { downloadExport } from "@/lib/export";
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
import { usePreloadSearch, useResearchSession, useResearchStatus } from "@/lib/research/provider";
import { useSearchList } from "@/lib/research/search-list";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";

import posthog from "posthog-js";

interface HistoryCommandCenterProps {
  /**
   * Turns the page into a chooser: picking a search hands it to the caller
   * instead of opening it, and the import, export and clear-all tools are
   * left out.
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
  const convex = useConvex();
  const account = useResearchSession();
  const preloadSearch = usePreloadSearch();
  const [searchFilter, setSearchFilter] = useState("");

  const clearSearchHistory = useSearchHistoryStore((state) => state.clearSearchHistory);
  const importSearchHistory = useSearchHistoryStore((state) => state.importSearchHistory);
  const { ready: listReady, error, retry } = useResearchStatus();
  const settingsReady = usePersistedStoreReady(useUIStore);
  const {
    historyViewMode,
    setHistoryViewMode,
    historySortBy,
    setHistorySortBy,
  } = useUIStore();
  // Read a page at a time: the page number can't be jumped to, so it stays out of the URL.
  const history = useSearchList({ sort: historySortBy, text: searchFilter, pageSize: COMMAND_CENTER_ITEMS_PER_PAGE, excludeId: pick?.excludeId });
  const ready = listReady && settingsReady && !history.isLoading;
  // The page's own steps go back to its top; a chooser stays where its host put it.
  const step = (to: () => void) => () => {
    to();
    if (!pick) window.scrollTo({ top: 0 });
  };

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

    preloadSearch(item);
    router.push(restoreFromHistory(item));
  };

  // An account's history is written by the server, a page at a time; this browser's is all here.
  const download = async (format: "json" | "csv") => {
    try {
      if (account) return await downloadExport(convex, { kind: "history" }, format);
      const data = localSearchHistoryStore.getState().searchHistory.map((item) => {
        const { expandedQuery } = validateAndExpandKeywordsSilently(item.query);
        return {
          search_query: expandedQuery,
          count: item.count,
          field: item.field,
        };
      });
      downloadAsFile(format === "json" ? JSON.stringify(data, null, 2) : jsonToCSV(data), `search_history.${format}`, format);
    } catch (error) {
      console.error(`[History] Failed to export as ${format}:`, error);
      toast.io.downloadFailed(tToast(format === "json" ? "entityJson" : "entityCsv"));
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
      message: th("clearAllHistoryConfirm", { count: history.count ?? 0 }),
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
        items={history.items}
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
      {ready && history.hasPages && (
        <CommandCenterPagination
          currentPage={history.page}
          itemLabel={tcc("searchesLabel")}
          steps={{
            canPrevious: history.canPrevious,
            canNext: history.canNext,
            onPrevious: step(history.previous),
            onNext: step(history.next),
            offset: history.offset,
            shown: history.items.length,
            total: history.total,
            pageCount: history.pageCount,
          }}
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
      onDownloadJSON={() => void download("json")}
      onDownloadCSV={() => download("csv")}
      onUploadJSON={handleUploadJSON}
      onUploadCSV={handleUploadCSV}
      onClearAll={handleClearAll}
      clearTooltip={th("clearAllHistory")}
      totalCount={history.count}
    />}
  >{list}</HistoryPageFrame>;
}

/** The history page's frame, shared with its loading state so nothing moves when it loads. */
export function HistoryPageFrame({ children, ...controls }: { children: React.ReactNode; tabs?: React.ReactNode; filters?: React.ReactNode; actions?: React.ReactNode }) {
  const tc = useTranslations("common");
  return <LibraryPageShell icon={Clock} title={tc("searchHistory")} {...controls}>{children}</LibraryPageShell>;
}

export function HistoryLoading() {
  const tc = useTranslations("common");
  return <HistoryPageFrame><ListLoading label={tc("loading")} /></HistoryPageFrame>;
}
