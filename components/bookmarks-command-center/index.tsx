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
import { appToast } from "@/lib/toast";
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
import posthog from "posthog-js";

export interface BookmarkEntry {
  name: string;
  expansion: string;
  createdAt: number;
}

export function BookmarksCommandCenter() {
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
    appToast.entity.deleted(tToast("entityBookmark"), name);
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
      appToast.io.downloadSuccess(data.length, tToast("entityBookmarks"), tToast("entityJson"));
    } catch {
      appToast.io.downloadFailed(tToast("entityJson"));
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
      appToast.io.downloadSuccess(data.length, tToast("entityBookmarks"), tToast("entityCsv"));
    } catch {
      appToast.io.downloadFailed(tToast("entityCsv"));
    }
  };

  const handleUploadJSON = async () => {
    try {
      const file = await triggerFileUpload(".json");
      const data = await uploadFile(file);
      const importedCount = importKeywords(data);
      if (importedCount > 0) {
        appToast.io.uploadSuccess(importedCount, tToast("entityBookmarks"));
      } else {
        appToast.io.uploadNoValid(tToast("entityBookmarks"));
      }
    } catch (error) {
      appToast.io.uploadFailed(tToast("entityJson"), error);
    }
  };

  const handleUploadCSV = async () => {
    try {
      const file = await triggerFileUpload(".csv");
      const data = await uploadFile(file);
      const importedCount = importKeywords(data);
      if (importedCount > 0) {
        appToast.io.uploadSuccess(importedCount, tToast("entityBookmarks"));
      } else {
        appToast.io.uploadNoValid(tToast("entityBookmarks"));
      }
    } catch (error) {
      appToast.io.uploadFailed(tToast("entityCsv"), error);
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
        appToast.entity.cleared(tToast("entityBookmarks"), bookmarksArray.length);
      },
    });
  };

  return (
    <CommandCenterContainer>
      {/* Header */}
      <CommandCenterHeader
        icon={BookOpen}
        title={tc("bookmarks")}
        description={tb("description")}
        count={sortedBookmarks.length}
        singular={tcc("bookmarkSingular")}
        plural={tcc("bookmarkPlural")}
        countLabel={tcc("bookmarkCount", { count: sortedBookmarks.length })}
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
        placeholder={tb("searchPlaceholder")}
        onDownloadJSON={handleDownloadJSON}
        onDownloadCSV={handleDownloadCSV}
        onUploadJSON={handleUploadJSON}
        onUploadCSV={handleUploadCSV}
        onClearAll={handleClearAll}
        clearTooltip={tb("clearAllBookmarks")}
        totalCount={bookmarksArray.length}
      />

      {/* List */}
      <div className="p-4 md:p-6">
        <CommandCenterList
          items={paginatedBookmarks}
          viewMode={bookmarkViewMode}
          keyExtractor={(bookmark) => bookmark.name}
          emptyIcon={BookOpen}
          emptyTitle={tb("noBookmarksYet")}
          emptyDescription={tb("addFirstBookmark")}
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
            itemLabel={tcc("bookmarksLabel")}
          />
        )}

        {/* Usage Guide */}
        <BookmarksGuide />
      </div>
    </CommandCenterContainer>
  );
}
