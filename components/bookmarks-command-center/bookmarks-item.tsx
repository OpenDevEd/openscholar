"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Trash2, Pencil, Check, X, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ViewMode } from "@/lib/store";
import { subtleSpring, type BookmarkEntry } from "./index";

interface BookmarksItemProps {
  bookmark: BookmarkEntry;
  index: number;
  viewMode: ViewMode;
  isEditing: boolean;
  onEdit: () => void;
  onSaveEdit: (newExpansion: string) => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

export function BookmarksItem({
  bookmark,
  index,
  viewMode,
  isEditing,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: BookmarksItemProps) {
  const [editValue, setEditValue] = useState(bookmark.expansion);

  const handleSave = () => {
    if (editValue.trim()) {
      onSaveEdit(editValue.trim());
    }
  };

  const handleCancel = () => {
    setEditValue(bookmark.expansion);
    onCancelEdit();
  };

  const handleStartEdit = () => {
    setEditValue(bookmark.expansion);
    onEdit();
  };

  const formattedDate = new Date(bookmark.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Render based on view mode
  if (viewMode === "list-simple") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...subtleSpring, delay: index * 0.03 }}
        className={cn(
          "group flex items-center gap-3 px-4 py-3",
          "bg-card/50 dark:bg-card/40",
          "border border-border/40 rounded-xl",
          "hover:bg-card/70 hover:border-border/60 hover:shadow-sm",
          "transition-all duration-200"
        )}
      >
        {/* Dot indicator */}
        <div className="w-2 h-2 rounded-full bg-primary shrink-0" />

        {/* Name */}
        <span className="font-mono text-sm font-semibold text-foreground shrink-0">
          {bookmark.name}...
        </span>

        {/* Arrow */}
        <span className="text-muted-foreground text-xs shrink-0">→</span>

        {/* Expansion (truncated) */}
        {isEditing ? (
          <div className="flex-1 flex items-center gap-2">
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="h-8 text-sm font-mono"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") handleCancel();
              }}
            />
            <Button size="sm" variant="ghost" onClick={handleSave} className="h-8 w-8 p-0">
              <Check className="h-4 w-4 text-green-600" />
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCancel} className="h-8 w-8 p-0">
              <X className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        ) : (
          <>
            <span className="flex-1 text-sm font-mono text-muted-foreground truncate">
              {bookmark.expansion}
            </span>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleStartEdit}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onDelete}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </>
        )}
      </motion.div>
    );
  }

  if (viewMode === "list-detail") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...subtleSpring, delay: index * 0.03 }}
        className={cn(
          "group p-4",
          "bg-card/50 dark:bg-card/40",
          "border border-border/40 rounded-xl",
          "hover:bg-card/70 hover:border-border/60 hover:shadow-sm",
          "transition-all duration-200"
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Header row */}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
              <span className="font-mono text-sm font-semibold text-foreground">
                {bookmark.name}...
              </span>
              <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                Expands to
              </span>
            </div>

            {/* Expansion */}
            {isEditing ? (
              <div className="pl-5 space-y-3">
                <Textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="min-h-[100px] text-sm font-mono"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={handleSave} className="gap-1.5">
                    <Check className="h-4 w-4" />
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleCancel}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="pl-5">
                <div className="text-sm font-mono text-muted-foreground leading-relaxed break-words bg-muted/20 px-3 py-2 rounded border-l-2 border-primary/20">
                  {bookmark.expansion}
                </div>
              </div>
            )}

            {/* Footer */}
            {!isEditing && (
              <div className="pl-5 mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>Added {formattedDate}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          {!isEditing && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleStartEdit}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onDelete}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  // Grid view (grid-2 and grid-3)
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...subtleSpring, delay: index * 0.03 }}
      className={cn(
        "group flex flex-col",
        "bg-card/50 dark:bg-card/40",
        "border border-border/40 rounded-xl",
        "hover:bg-card/70 hover:border-border/60 hover:shadow-sm",
        "transition-all duration-200",
        "overflow-hidden"
      )}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-primary/5 border-b border-border/30 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
        <span className="font-mono text-sm font-semibold text-foreground truncate">
          {bookmark.name}...
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 p-4">
        {isEditing ? (
          <div className="space-y-3">
            <Textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="min-h-[80px] text-sm font-mono"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSave} className="gap-1.5">
                <Check className="h-4 w-4" />
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm font-mono text-muted-foreground leading-relaxed line-clamp-4">
            {bookmark.expansion}
          </p>
        )}
      </div>

      {/* Footer */}
      {!isEditing && (
        <div className="px-4 py-2 border-t border-border/30 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>{formattedDate}</span>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleStartEdit}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onDelete}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
