"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { useConvex } from "convex/react";
import { BookOpen, BookmarksIcon } from "@/components/icons";
import {
  localKeywordExpansionStore,
  useKeywordExpansionStore,
  useUIStore,
} from "@/lib/store";
import { downloadExport } from "@/lib/export";
import {
  jsonToCSV,
  downloadAsFile,
  triggerFileUpload,
  uploadFile,
} from "@/lib/utils";
import { showConfirmation } from "@/lib/confirmation";
import { useAppToast } from "@/lib/toast";
import { COMMAND_CENTER_ITEMS_PER_PAGE } from "@/lib/constants/view-modes";
import type { BookmarkSortBy } from "@/lib/types";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { ListLoading } from "@/components/evidence-libraries/list-controls";
import { usePersistedStoreReady } from "@/lib/use-persisted-store-ready";
import { useResearchStatus } from "@/lib/research/provider";
import { useResearchSession } from "@/lib/research/reads";
import { useShortcutList } from "@/lib/research/shortcut-list";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { CommandCenterFileActions, CommandCenterFilters } from "@/components/command-center/command-center-toolbar";
import { ViewModeSwitch } from "@/components/view-mode-toggle";
import { CommandCenterList } from "@/components/command-center/command-center-list";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { BookmarksItem } from "./bookmarks-item";
import type { ViewMode } from "@/lib/types";

function createBookmarkListItem(
  viewMode: ViewMode,
  editingBookmark: string | null,
  onEdit: (name: string) => void,
  onSaveEdit: (name: string, newExpansion: string) => void,
  onCancelEdit: () => void,
  onDelete: (name: string) => void
) {
  return function BookmarkListItem({ item }: { item: BookmarkEntry }) {
    return (
      <BookmarksItem
        bookmark={item}
        viewMode={viewMode}
        isEditing={editingBookmark === item.name}
        onEdit={() => onEdit(item.name)}
        onSaveEdit={(newExpansion) => onSaveEdit(item.name, newExpansion)}
        onCancelEdit={onCancelEdit}
        onDelete={() => onDelete(item.name)}
      />
    );
  };
}
import { NewBookmarkDialog } from "./new-bookmark-dialog";
import { BookmarksGuide } from "./bookmarks-guide";
import posthog from "posthog-js";
import type { BookmarkEntry } from "./types";

export type { BookmarkEntry } from "./types";

export function BookmarksCommandCenter() {
  const toast = useAppToast();
  const tb = useTranslations("bookmarksPage");
  const tc = useTranslations("common");
  const tcc = useTranslations("commandCenter");
  const tToast = useTranslations("toast");

  const SORT_OPTIONS: { value: BookmarkSortBy; label: string }[] = [
    { value: "recent", label: tc("recent") },
    { value: "oldest", label: tc("oldest") },
    { value: "alpha", label: tc("aToZ") },
    { value: "alpha-desc", label: tc("zToA") },
  ];
  const [searchFilter, setSearchFilter] = useState("");
  const [editingBookmark, setEditingBookmark] = useState<string | null>(null);
  const convex = useConvex();
  const account = useResearchSession();

  const updateKeyword = useKeywordExpansionStore((state) => state.updateKeyword);
  const removeKeyword = useKeywordExpansionStore((state) => state.removeKeyword);
  const clearKeywords = useKeywordExpansionStore((state) => state.clearKeywords);
  const importKeywords = useKeywordExpansionStore((state) => state.importKeywords);
  // Bookmarks and view settings are saved in the browser; wait for them rather than flash an empty list.
  const { ready: listReady, error, retry } = useResearchStatus();
  const settingsReady = usePersistedStoreReady(useUIStore);
  const {
    bookmarkViewMode,
    setBookmarkViewMode,
    bookmarkSortBy,
    setBookmarkSortBy,
  } = useUIStore();
  // Read a page at a time: the page number can't be jumped to, so it stays out of the URL.
  const bookmarks = useShortcutList({ sort: bookmarkSortBy, text: searchFilter, pageSize: COMMAND_CENTER_ITEMS_PER_PAGE });
  const ready = listReady && settingsReady && !bookmarks.isLoading;
  const step = (to: () => void) => () => {
    to();
    window.scrollTo({ top: 0 });
  };

  // Handlers
  const handleEdit = (name: string) => setEditingBookmark(name);
  const handleSaveEdit = (name: string, newExpansion: string) => {
    const bookmark = bookmarks.items.find((item) => item.name === name);
    if (bookmark) updateKeyword(name, newExpansion, bookmark.createdAt);
    setEditingBookmark(null);
  };
  const handleCancelEdit = () => setEditingBookmark(null);
  const handleDelete = (name: string) => {
    // Track bookmark deletion event
    posthog.capture("bookmark_deleted", {
      bookmark_name: name,
      expansion_length: bookmarks.items.find((item) => item.name === name)?.expansion.length || 0,
      remaining_bookmarks: (bookmarks.count ?? 1) - 1,
    });

    removeKeyword(name);
    if (editingBookmark === name) setEditingBookmark(null);
  };

  // An account's bookmarks are written by the server, a page at a time; this browser's are all here.
  const download = async (format: "json" | "csv") => {
    try {
      if (account) return await downloadExport(convex, { kind: "shortcuts" }, format);
      const data = Object.entries(localKeywordExpansionStore.getState().keywords).map(([name, bookmark]) => ({
        name,
        expansion: bookmark.expansion,
        createdAt: format === "json" ? bookmark.createdAt : new Date(bookmark.createdAt).toISOString(),
      }));
      downloadAsFile(format === "json" ? JSON.stringify(data, null, 2) : jsonToCSV(data), `bookmarks.${format}`, format);
    } catch (error) {
      console.error(`[Bookmarks] Failed to export as ${format}:`, error);
      toast.io.downloadFailed(tToast(format === "json" ? "entityJson" : "entityCsv"));
    }
  };

  const handleUploadJSON = async () => {
    try {
      const file = await triggerFileUpload(".json");
      const data = await uploadFile(file);
      await importKeywords(data);
    } catch (error) {
      toast.io.uploadFailed(tToast("entityJson"), error);
    }
  };

  const handleUploadCSV = async () => {
    try {
      const file = await triggerFileUpload(".csv");
      const data = await uploadFile(file);
      await importKeywords(data);
    } catch (error) {
      toast.io.uploadFailed(tToast("entityCsv"), error);
    }
  };

  const handleClearAll = () => {
    showConfirmation({
      title: tb("clearAllBookmarksTitle"),
      message: tb("clearAllBookmarksConfirm", { count: bookmarks.count ?? 0 }),
      confirmText: tc("clearAll"),
      cancelText: tc("cancel"),
      onConfirm: () => {
        clearKeywords();
      },
    });
  };

  return (
    <BookmarksPageFrame
      tabs={<ViewModeSwitch value={bookmarkViewMode} onChange={setBookmarkViewMode} />}
      filters={<CommandCenterFilters
        sortOptions={SORT_OPTIONS}
        currentSort={bookmarkSortBy}
        onSortChange={setBookmarkSortBy}
        searchFilter={searchFilter}
        onSearchChange={setSearchFilter}
        placeholder={tb("searchPlaceholder")}
      />}
      actions={<>
        <NewBookmarkDialog />
        <CommandCenterFileActions
        onDownloadJSON={() => void download("json")}
        onDownloadCSV={() => download("csv")}
        onUploadJSON={handleUploadJSON}
        onUploadCSV={handleUploadCSV}
        onClearAll={handleClearAll}
        clearTooltip={tb("clearAllBookmarks")}
        totalCount={bookmarks.count}
      />
      </>}
    >


      <div>
        {!ready ? error ? <AuthStatePanel variant="sync_error_retry" onRetry={retry} /> : <ListLoading label={tc("loading")} /> : <CommandCenterList
          items={bookmarks.items}
          viewMode={bookmarkViewMode}
          keyExtractor={(bookmark) => bookmark.name}
          emptyIcon={BookOpen}
          emptyTitle={tb("noBookmarksYet")}
          emptyDescription={tb("addFirstBookmark")}
          hasFilter={!!searchFilter.trim()}
          onClearFilter={() => setSearchFilter("")}
          ItemComponent={createBookmarkListItem(
            bookmarkViewMode,
            editingBookmark,
            handleEdit,
            handleSaveEdit,
            handleCancelEdit,
            handleDelete
          )}
        />}

        {/* Pagination */}
        {ready && bookmarks.hasPages && (
          <CommandCenterPagination
            className="border-t border-border-subtle p-4"
            currentPage={bookmarks.page}
            itemLabel={tcc("bookmarksLabel")}
            steps={{
              canPrevious: bookmarks.canPrevious,
              canNext: bookmarks.canNext,
              onPrevious: step(bookmarks.previous),
              onNext: step(bookmarks.next),
              offset: bookmarks.offset,
              shown: bookmarks.items.length,
              total: bookmarks.total,
              pageCount: bookmarks.pageCount,
            }}
          />
        )}

        {/* Usage Guide */}
        <BookmarksGuide />
      </div>
    </BookmarksPageFrame>
  );
}

/** The bookmarks page's frame, shared with its loading state so nothing moves when it loads. */
export function BookmarksPageFrame({ children, ...controls }: { children: React.ReactNode; tabs?: React.ReactNode; filters?: React.ReactNode; actions?: React.ReactNode }) {
  const tc = useTranslations("common");
  return <LibraryPageShell icon={BookmarksIcon} title={tc("bookmarks")} {...controls}>{children}</LibraryPageShell>;
}

export function BookmarksLoading() {
  const tc = useTranslations("common");
  return <BookmarksPageFrame><ListLoading label={tc("loading")} /></BookmarksPageFrame>;
}
