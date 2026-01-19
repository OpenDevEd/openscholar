"use client";

import React, { useState, useMemo } from "react";
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
import { toasts } from "@/lib/toast-utils";
import { COMMAND_CENTER_ITEMS_PER_PAGE } from "@/lib/constants/view-modes";
import type { BookmarkSortBy } from "@/lib/types";
import {
  CommandCenterContainer,
  CommandCenterHeader,
  CommandCenterToolbar,
  CommandCenterList,
  CommandCenterPagination,
} from "@/components/command-center";
import { BookmarksItem } from "./bookmarks-item";
import { BookmarksAddForm } from "./bookmarks-add-form";
import { BookmarksSaveBanner } from "./bookmarks-save-banner";
import { BookmarksGuide } from "./bookmarks-guide";

export interface BookmarkEntry {
  name: string;
  expansion: string;
  createdAt: number;
}

const SORT_OPTIONS: { value: BookmarkSortBy; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "oldest", label: "Oldest" },
  { value: "alpha", label: "A → Z" },
  { value: "alpha-desc", label: "Z → A" },
];

export function BookmarksCommandCenter() {
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
      toasts.download.success(data.length, "bookmarks", "JSON");
    } catch {
      toasts.download.error("JSON");
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
      toasts.download.success(data.length, "bookmarks", "CSV");
    } catch {
      toasts.download.error("CSV");
    }
  };

  const handleUploadJSON = async () => {
    try {
      const file = await triggerFileUpload(".json");
      const data = await uploadFile(file);
      const importedCount = importKeywords(data);
      if (importedCount > 0) {
        toasts.upload.success(importedCount, "bookmarks");
      } else {
        toasts.upload.noValid("bookmarks");
      }
    } catch (error) {
      toasts.upload.error(error);
    }
  };

  const handleUploadCSV = async () => {
    try {
      const file = await triggerFileUpload(".csv");
      const data = await uploadFile(file);
      const importedCount = importKeywords(data);
      if (importedCount > 0) {
        toasts.upload.success(importedCount, "bookmarks");
      } else {
        toasts.upload.noValid("bookmarks");
      }
    } catch (error) {
      toasts.upload.error(error);
    }
  };

  const handleClearAll = () => {
    showConfirmation({
      title: "Clear All Bookmarks",
      message: `Are you sure you want to delete all ${bookmarksArray.length} bookmarks? This action cannot be undone.`,
      confirmText: "Clear All",
      onConfirm: () => {
        clearKeywords();
        toasts.bookmarks.cleared();
      },
    });
  };

  return (
    <CommandCenterContainer>
      {/* Header */}
      <CommandCenterHeader
        icon={BookOpen}
        title="Bookmarks"
        description="Create shortcuts for commonly used search terms"
        count={sortedBookmarks.length}
        singular="bookmark"
        plural="bookmarks"
      />

      {/* Save Current Search Banner */}
      {suggestedQuery && <BookmarksSaveBanner />}

      {/* Add Form */}
      <BookmarksAddForm />

      {/* Toolbar */}
      <CommandCenterToolbar
        viewMode={bookmarkViewMode}
        onViewModeChange={setBookmarkViewMode}
        sortOptions={SORT_OPTIONS}
        currentSort={bookmarkSortBy}
        onSortChange={setBookmarkSortBy}
        searchFilter={searchFilter}
        onSearchChange={setSearchFilter}
        placeholder="Search bookmarks..."
        onDownloadJSON={handleDownloadJSON}
        onDownloadCSV={handleDownloadCSV}
        onUploadJSON={handleUploadJSON}
        onUploadCSV={handleUploadCSV}
        onClearAll={handleClearAll}
        clearTooltip="Clear all bookmarks"
        totalCount={bookmarksArray.length}
      />

      {/* List */}
      <div className="p-4 md:p-6">
        <CommandCenterList
          items={paginatedBookmarks}
          viewMode={bookmarkViewMode}
          keyExtractor={(bookmark) => bookmark.name}
          emptyIcon={BookOpen}
          emptyTitle="No bookmarks yet"
          emptyDescription="Add your first bookmark using the form above."
          hasFilter={!!searchFilter.trim()}
          onClearFilter={() => setSearchFilter("")}
          renderItem={(bookmark, index) => (
            <BookmarksItem
              bookmark={bookmark}
              index={index}
              viewMode={bookmarkViewMode}
              isEditing={editingBookmark === bookmark.name}
              onEdit={() => handleEdit(bookmark.name)}
              onSaveEdit={(newExpansion) =>
                handleSaveEdit(bookmark.name, newExpansion)
              }
              onCancelEdit={handleCancelEdit}
              onDelete={() => handleDelete(bookmark.name)}
            />
          )}
        />

        {/* Pagination */}
        {totalPages > 1 && (
          <CommandCenterPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={sortedBookmarks.length}
            itemsPerPage={COMMAND_CENTER_ITEMS_PER_PAGE}
            itemLabel="bookmarks"
          />
        )}

        {/* Usage Guide */}
        <BookmarksGuide />
      </div>
    </CommandCenterContainer>
  );
}
