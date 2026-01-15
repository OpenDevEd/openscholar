"use client";

import React, { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useKeywordExpansionStore, useKeywordExpansionDialogStore, useUIStore } from "@/lib/store";
import { BookmarkData } from "@/lib/types";
import { BookmarksHeader } from "./bookmarks-header";
import { BookmarksToolbar } from "./bookmarks-toolbar";
import { BookmarksList } from "./bookmarks-list";
import { BookmarksAddForm } from "./bookmarks-add-form";
import { BookmarksSaveBanner } from "./bookmarks-save-banner";
import { BookmarksGuide } from "./bookmarks-guide";

// Spring animation configs matching sidebar/search-command-center
export const commandCenterSpring = {
  type: "spring" as const,
  stiffness: 500,
  damping: 35,
  mass: 0.8,
};

export const subtleSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
  mass: 0.6,
};

export interface BookmarkEntry {
  name: string;
  expansion: string;
  createdAt: number;
}

export function BookmarksCommandCenter() {
  const [searchFilter, setSearchFilter] = useState("");
  const [editingBookmark, setEditingBookmark] = useState<string | null>(null);

  const { keywords, updateKeyword, removeKeyword } = useKeywordExpansionStore();
  const { suggestedQuery } = useKeywordExpansionDialogStore();
  const { bookmarkViewMode, bookmarkSortBy } = useUIStore();

  // Convert keywords object to array for easier manipulation
  const bookmarksArray: BookmarkEntry[] = useMemo(() => {
    return Object.entries(keywords).map(([name, data]) => ({
      name,
      expansion: data.expansion,
      createdAt: data.createdAt,
    }));
  }, [keywords]);

  // Filter bookmarks based on search input
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

  // Handlers
  const handleEdit = (name: string) => {
    setEditingBookmark(name);
  };

  const handleSaveEdit = (name: string, newExpansion: string) => {
    updateKeyword(name, newExpansion);
    setEditingBookmark(null);
  };

  const handleCancelEdit = () => {
    setEditingBookmark(null);
  };

  const handleDelete = (name: string) => {
    removeKeyword(name);
    if (editingBookmark === name) {
      setEditingBookmark(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={subtleSpring}
      className={cn(
        "relative rounded-2xl overflow-hidden",
        "bg-background/80 dark:bg-background/60",
        "backdrop-blur-xl backdrop-saturate-150",
        "border border-border/50",
        "shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]"
      )}
    >
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-transparent pointer-events-none" />

      {/* Header */}
      <BookmarksHeader count={sortedBookmarks.length} />

      {/* Save Current Search Banner */}
      {suggestedQuery && (
        <BookmarksSaveBanner />
      )}

      {/* Add Form */}
      <BookmarksAddForm />

      {/* Toolbar */}
      <BookmarksToolbar
        searchFilter={searchFilter}
        onSearchChange={setSearchFilter}
        totalCount={bookmarksArray.length}
      />

      {/* List */}
      <div className="p-4 md:p-6">
        <BookmarksList
          items={sortedBookmarks}
          viewMode={bookmarkViewMode}
          editingBookmark={editingBookmark}
          onEdit={handleEdit}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={handleCancelEdit}
          onDelete={handleDelete}
          hasFilter={!!searchFilter.trim()}
          onClearFilter={() => setSearchFilter("")}
        />

        {/* Usage Guide */}
        <BookmarksGuide />
      </div>
    </motion.div>
  );
}
