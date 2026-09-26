"use client";

import React, { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { parseAsInteger, useQueryState } from "nuqs";
import { BookOpen } from "lucide-react";
import {
  useKeywordExpansionStore,
  useKeywordExpansionDialogStore,
  useUIStore,
} from "@/lib/store";
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
  return function BookmarkListItem({
    item,
    index,
  }: {
    item: BookmarkEntry;
    index: number;
  }) {
    return (
      <BookmarksItem
        bookmark={item}
        index={index}
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
import { BookmarksAddForm } from "./bookmarks-add-form";
import { BookmarksSaveBanner } from "./bookmarks-save-banner";
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
  const [currentPage, setCurrentPage] = useQueryState(
    "page",
    parseAsInteger.withDefault(1).withOptions({ scroll: true }),
  );

  const {
    keywords,
    updateKeyword,
    removeKeyword,
    clearKeywords,
    importKeywords,
  } = useKeywordExpansionStore();
  const { suggestedQuery } = useKeywordExpansionDialogStore();
  // Bookmarks and view settings are saved in the browser; wait for them rather than flash an empty list.
  const listReady = usePersistedStoreReady(useKeywordExpansionStore);
  const settingsReady = usePersistedStoreReady(useUIStore);
  const ready = listReady && settingsReady;
  const {
    bookmarkViewMode,
    setBookmarkViewMode,
    bookmarkSortBy,
    setBookmarkSortBy,
  } = useUIStore();

  // Convert keywords object to array
  const bookmarksArray: BookmarkEntry[] = useMemo(() => {
    return Object.entries(keywords).map(([name, data]) => ({
      name,
      expansion: data.expansion,
      createdAt: data.createdAt,
    }));
  }, [keywords]);

  // Filter bookmarks
  const filteredBookmarks = useMemo(() => {
    if (!searchFilter.trim()) return bookmarksArray;
    const query = searchFilter.toLowerCase();
    return bookmarksArray.filter((bookmark) => {
      const matchesName = bookmark.name.toLowerCase().includes(query);
      const matchesExpansion = bookmark.expansion.toLowerCase().includes(query);
      return matchesName || matchesExpansion;
    });
  }, [bookmarksArray, searchFilter]);

  // Sort bookmarks
  const sortedBookmarks = useMemo(() => {
    const sorted = [...filteredBookmarks];
    switch (bookmarkSortBy) {
      case "oldest":
        return sorted.sort((a, b) => a.createdAt - b.createdAt);
      case "alpha":
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case "alpha-desc":
        return sorted.sort((a, b) => b.name.localeCompare(a.name));
      case "recent":
      default:
        return sorted.sort((a, b) => b.createdAt - a.createdAt);
    }
  }, [filteredBookmarks, bookmarkSortBy]);

  // Pagination
  const totalPages = Math.ceil(
    sortedBookmarks.length / COMMAND_CENTER_ITEMS_PER_PAGE,
  );
  const paginatedBookmarks = useMemo(() => {
    const start = (currentPage - 1) * COMMAND_CENTER_ITEMS_PER_PAGE;
    return sortedBookmarks.slice(start, start + COMMAND_CENTER_ITEMS_PER_PAGE);
  }, [sortedBookmarks, currentPage]);

  // Reset to page 1 when filter changes
  React.useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages, setCurrentPage]);

  // Handlers
  const handleEdit = (name: string) => setEditingBookmark(name);
  const handleSaveEdit = (name: string, newExpansion: string) => {
    updateKeyword(name, newExpansion);
    setEditingBookmark(null);
  };
  const handleCancelEdit = () => setEditingBookmark(null);
  const handleDelete = (name: string) => {
    const deletedBookmark = keywords[name];

    // Track bookmark deletion event
    posthog.capture("bookmark_deleted", {
      bookmark_name: name,
      expansion_length: deletedBookmark?.expansion?.length || 0,
      remaining_bookmarks: Object.keys(keywords).length - 1,
    });

    removeKeyword(name);
    if (editingBookmark === name) setEditingBookmark(null);
  };

  // Download handlers
  const handleDownloadJSON = () => {
    try {
      const data = Object.entries(keywords).map(([name, bookmark]) => ({
        name,
        expansion: bookmark.expansion,
        createdAt: bookmark.createdAt,
      }));
      downloadAsFile(JSON.stringify(data, null, 2), "bookmarks.json", "json");
    } catch {
      toast.io.downloadFailed(tToast("entityJson"));
    }
  };

  const handleDownloadCSV = async () => {
    try {
      const data = Object.entries(keywords).map(([name, bookmark]) => ({
        name,
        expansion: bookmark.expansion,
        createdAt: new Date(bookmark.createdAt).toISOString(),
      }));
      const csv = await jsonToCSV(data);
      downloadAsFile(csv, "bookmarks.csv", "csv");
    } catch {
      toast.io.downloadFailed(tToast("entityCsv"));
    }
  };

  const handleUploadJSON = async () => {
    try {
      const file = await triggerFileUpload(".json");
      const data = await uploadFile(file);
      importKeywords(data);
    } catch (error) {
      toast.io.uploadFailed(tToast("entityJson"), error);
    }
  };

  const handleUploadCSV = async () => {
    try {
      const file = await triggerFileUpload(".csv");
      const data = await uploadFile(file);
      importKeywords(data);
    } catch (error) {
      toast.io.uploadFailed(tToast("entityCsv"), error);
    }
  };

  const handleClearAll = () => {
    showConfirmation({
      title: tb("clearAllBookmarksTitle"),
      message: tb("clearAllBookmarksConfirm", { count: bookmarksArray.length }),
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
      actions={<CommandCenterFileActions
        onDownloadJSON={handleDownloadJSON}
        onDownloadCSV={handleDownloadCSV}
        onUploadJSON={handleUploadJSON}
        onUploadCSV={handleUploadCSV}
        onClearAll={handleClearAll}
        clearTooltip={tb("clearAllBookmarks")}
        totalCount={bookmarksArray.length}
      />}
    >
      {/* Save Current Search Banner */}
      {suggestedQuery && <BookmarksSaveBanner />}

      {/* Add Form */}
      <BookmarksAddForm />


      {/* List */}
      <div className="p-4 md:p-6">
        {!ready ? <ListLoading label={tc("loading")} /> : <CommandCenterList
          items={paginatedBookmarks}
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
        {totalPages > 1 && (
          <CommandCenterPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={sortedBookmarks.length}
            itemsPerPage={COMMAND_CENTER_ITEMS_PER_PAGE}
            itemLabel={tcc("bookmarksLabel")}
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
  return <LibraryPageShell icon={BookOpen} title={tc("bookmarks")} {...controls}>{children}</LibraryPageShell>;
}

export function BookmarksLoading() {
  const tc = useTranslations("common");
  return <BookmarksPageFrame><ListLoading label={tc("loading")} /></BookmarksPageFrame>;
}
