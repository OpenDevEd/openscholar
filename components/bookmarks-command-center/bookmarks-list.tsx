"use client";

import React from "react";
import { motion } from "framer-motion";
import { BookOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ViewMode } from "@/lib/types";
import { BookmarksItem } from "./bookmarks-item";
import { subtleSpring } from "@/lib/animation-config";
import { type BookmarkEntry } from "./index";

interface BookmarksListProps {
  items: BookmarkEntry[];
  viewMode: ViewMode;
  editingBookmark: string | null;
  onEdit: (name: string) => void;
  onSaveEdit: (name: string, newExpansion: string) => void;
  onCancelEdit: () => void;
  onDelete: (name: string) => void;
  hasFilter: boolean;
  onClearFilter: () => void;
}

export function BookmarksList({
  items,
  viewMode,
  editingBookmark,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  hasFilter,
  onClearFilter,
}: BookmarksListProps) {
  // Empty state
  if (items.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={subtleSpring}
        className="flex flex-col items-center justify-center py-16 px-4"
      >
        <div
          className={cn(
            "w-16 h-16 rounded-2xl mb-6",
            "bg-gradient-to-br from-muted/80 to-muted/40",
            "flex items-center justify-center",
            "border border-border/50"
          )}
        >
          {hasFilter ? (
            <Search className="h-7 w-7 text-muted-foreground" />
          ) : (
            <BookOpen className="h-7 w-7 text-muted-foreground" />
          )}
        </div>

        <h3 className="text-lg font-semibold text-foreground mb-2">
          {hasFilter ? "No matches found" : "No bookmarks yet"}
        </h3>

        <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
          {hasFilter
            ? "Try adjusting your search filter to find what you're looking for."
            : "Add your first bookmark using the form above."}
        </p>

        {hasFilter && (
          <Button variant="outline" onClick={onClearFilter} className="gap-2">
            Clear Filter
          </Button>
        )}
      </motion.div>
    );
  }

  // Grid layout classes based on view mode
  const gridClasses: Record<ViewMode, string> = {
    "list-simple": "flex flex-col gap-2",
    "list-detail": "flex flex-col gap-4",
    "grid-2": "grid grid-cols-1 md:grid-cols-2 gap-4",
    "grid-3": "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3",
  };

  return (
    <div className={cn(gridClasses[viewMode])}>
      {items.map((bookmark, index) => (
        <BookmarksItem
          key={bookmark.name}
          bookmark={bookmark}
          index={index}
          viewMode={viewMode}
          isEditing={editingBookmark === bookmark.name}
          onEdit={() => onEdit(bookmark.name)}
          onSaveEdit={(newExpansion: string) => onSaveEdit(bookmark.name, newExpansion)}
          onCancelEdit={onCancelEdit}
          onDelete={() => onDelete(bookmark.name)}
        />
      ))}
    </div>
  );
}
