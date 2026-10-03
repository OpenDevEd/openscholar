"use client";

import React, { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Trash2, Pencil, Check, X, Calendar, Copy, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, createDefaultFilters } from "@/lib/utils";
import { getIdColor } from "@/lib/format";
import { ViewMode } from "@/lib/types";
import { useAppToast } from "@/lib/toast";
import { submitNewSearch } from "@/lib/search/actions";
import { subtleSpring } from "@/lib/animation-config";
import type { BookmarkEntry } from "./types";

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
  const toast = useAppToast();
  const tb = useTranslations("bookmarksPage");
  const tc = useTranslations("common");
  const tToast = useTranslations("toast");
  const format = useFormatter();
  const [editValue, setEditValue] = useState(bookmark.expansion);
  const router = useRouter();
  const idColor = getIdColor(bookmark.name);

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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(bookmark.expansion);
    } catch {
      toast.clipboard.copyFailed(tToast("entityExpansion"));
    }
  };

  const handleUseInSearch = () => {
    // Create search using the bookmark syntax (name...) which will auto-expand
    const query = `${bookmark.name}...`;
    const filters = createDefaultFilters();
    const { url } = submitNewSearch(query, filters);
    router.push(url);
  };

  const formattedDate = format.dateTime(new Date(bookmark.createdAt), {
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
          "group relative flex flex-col rounded-xl",
          "bg-card/40 dark:bg-card/30",
          "border border-border/40",
          "hover:bg-card/70 hover:border-border/60 hover:shadow-sm",
          "transition-[background-color,border-color,box-shadow] duration-200"
        )}
      >
        {/* Main row */}
        <div className="flex items-center gap-3 px-3 py-2.5">
          {/* Colored badge with name */}
          <div
            className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold font-mono"
            style={{
              backgroundColor: idColor.bg,
              color: idColor.text,
              border: `1px solid ${idColor.border}`,
            }}
          >
            {bookmark.name}
          </div>

          {/* Arrow */}
          <span className="text-muted-foreground text-xs shrink-0">→</span>

          {/* Expansion (truncated) */}
          {isEditing ? (
            <div className="flex-1 flex items-center gap-2">
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="h-8 text-sm font-mono border-warning/30 focus:border-warning"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                  if (e.key === "Escape") handleCancel();
                }}
              />
              <Button
                size="sm"
                onClick={handleSave}
                className="h-8 px-2 bg-warning hover:bg-warning/90 text-warning-foreground"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancel}
                className="h-8 px-2 ink-warning hover:bg-warning/15"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <span className="flex-1 text-sm text-muted-foreground truncate">
                {bookmark.expansion}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-0.5 shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={handleCopy}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{tb("copyExpansion")}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={handleUseInSearch}
                    >
                      <Search className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{tb("useInSearchTooltip")}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={handleStartEdit}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{tc("edit")}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:text-destructive"
                      onClick={onDelete}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{tc("delete")}</TooltipContent>
                </Tooltip>
              </div>
            </>
          )}
        </div>
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
          "group relative rounded-xl overflow-hidden",
          "bg-card/50 dark:bg-card/40",
          "border border-border/40",
          "hover:border-border/60 hover:shadow-md",
          "transition-[background-color,border-color,box-shadow] duration-200"
        )}
      >
        <div className="p-4">
          {/* Main content row */}
          <div className="flex gap-4">
            {/* Colored badge block */}
            <div
              className="shrink-0 flex flex-col items-center justify-center px-4 py-3 rounded-lg min-w-[80px]"
              style={{
                backgroundColor: idColor.bg,
                border: `1px solid ${idColor.border}`,
              }}
            >
              <span
                className="text-base font-bold font-mono leading-none"
                style={{ color: idColor.text }}
              >
                {bookmark.name}
              </span>
              <span
                className="text-3xs opacity-70 mt-1"
                style={{ color: idColor.text }}
              >
                {tc("bookmark")}
              </span>
            </div>

            {/* Info section */}
            <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
              {/* Label */}
              <span className="text-xs text-muted-foreground font-medium">
                {tb("expandsTo")}
              </span>

              {/* Expansion */}
              {isEditing ? (
                <div className="flex flex-col gap-3 p-3 rounded-lg bg-warning/10 border border-warning/30">
                  <Textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="min-h-[100px] text-sm font-mono border-warning/30 focus:border-warning"
                    autoFocus
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handleSave}
                      className="gap-1.5 bg-warning hover:bg-warning/90 text-warning-foreground"
                    >
                      <Check className="h-4 w-4" />
                      {tc("save")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleCancel}
                      className="ink-warning hover:bg-warning/15"
                    >
                      {tc("cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed break-words">
                  {bookmark.expansion}
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          {!isEditing && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/40">
              {/* Left: Date */}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>{tb("addedDate", { date: formattedDate })}</span>
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={handleCopy}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{tb("copyExpansion")}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={handleUseInSearch}
                    >
                      <Search className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{tb("useInSearchTooltip")}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={handleStartEdit}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{tc("edit")}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:text-destructive"
                      onClick={onDelete}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{tc("delete")}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  // Grid view (grid-2 and grid-3)
  const isCompact = viewMode === "grid-3";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...subtleSpring, delay: index * 0.03 }}
      whileHover={{ y: -2 }}
      className={cn(
        "group relative flex flex-col rounded-xl overflow-hidden",
        "bg-card/50 dark:bg-card/40",
        "border border-border/40",
        "hover:border-border/60 hover:shadow-md",
        "transition-[background-color,border-color,box-shadow] duration-200"
      )}
    >
      {/* Top colored section with name */}
      <div
        className={cn(
          "flex items-center justify-center",
          isCompact ? "py-3" : "py-4"
        )}
        style={{ backgroundColor: idColor.bg }}
      >
        <span
          className={cn(
            "font-bold font-mono",
            isCompact ? "text-lg" : "text-xl"
          )}
          style={{ color: idColor.text }}
        >
          {bookmark.name}
        </span>
      </div>

      {/* Content */}
      <div className={cn("flex-1", isCompact ? "p-2.5" : "p-3")}>
        {isEditing ? (
          <div className="flex flex-col gap-3 p-2 rounded-lg bg-warning/10 border border-warning/30">
            <Textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="min-h-[80px] text-sm font-mono border-warning/30 focus:border-warning"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                className="gap-1.5 bg-warning hover:bg-warning/90 text-warning-foreground"
              >
                <Check className="h-4 w-4" />
                {tc("save")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancel}
                className="ink-warning hover:bg-warning/15"
              >
                {tc("cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <p
            className={cn(
              "text-muted-foreground leading-relaxed",
              isCompact ? "text-xs line-clamp-3" : "text-sm line-clamp-4"
            )}
          >
            {bookmark.expansion}
          </p>
        )}
      </div>

      {/* Actions footer */}
      {!isEditing && (
        <div
          className={cn(
            "flex items-center justify-between px-2 py-2 border-t border-border/30",
            "bg-muted/20"
          )}
        >
          {/* Left: Date */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>{formattedDate}</span>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleCopy}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{tb("copyExpansion")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleUseInSearch}
                >
                  <Search className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{tb("useInSearchTooltip")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleStartEdit}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{tc("edit")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:text-destructive"
                  onClick={onDelete}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{tc("delete")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
    </motion.div>
  );
}
