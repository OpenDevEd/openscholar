"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { formatDistanceToNow } from "date-fns";
import {
  Copy,
  BookmarkPlus,
  Search,
  Trash2,
  Check,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSearchHistoryStore, useKeywordExpansionStore } from "@/lib/store";
import { toast } from "sonner";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { subtleSpring } from "@/lib/animation-config";
import type { QueryHistoryEntry } from "@/lib/types";

interface HistoryQueryExpansionProps {
  queryHistory: QueryHistoryEntry[];
  currentQuery: string;
  searchId: string;
  onQuerySelect?: (query: string) => void;
  hideHeader?: boolean;
}

export function HistoryQueryExpansion({
  queryHistory,
  currentQuery,
  searchId,
  onQuerySelect,
  hideHeader = false,
}: HistoryQueryExpansionProps) {
  const [bookmarkingIndex, setBookmarkingIndex] = useState<number | null>(null);
  const [bookmarkName, setBookmarkName] = useState("");

  const { updateSearchResult, getSearchResult } = useSearchHistoryStore();
  const { addKeyword, keywords } = useKeywordExpansionStore();

  if (!queryHistory || queryHistory.length <= 1) {
    return null;
  }

  const handleCopy = async (query: string) => {
    try {
      await navigator.clipboard.writeText(query);
      toast.success("Query copied to clipboard");
    } catch {
      toast.success("Query copied to clipboard");
    }
  };

  const handleDeleteEntry = (queryIndex: number) => {
    const searchResult = getSearchResult(searchId);
    if (!searchResult) return;

    const updatedQueryHistory = searchResult.queryHistory.filter(
      (_, index) => index !== queryIndex
    );

    updateSearchResult(searchId, {
      queryHistory: updatedQueryHistory,
    });

    toast.success("Query entry removed");
  };

  const handleBookmarkSubmit = (query: string) => {
    if (!bookmarkName.trim()) {
      toast.error("Bookmark name is required");
      return;
    }
    if (!/^[a-zA-Z0-9-]+$/.test(bookmarkName.trim())) {
      toast.error("Only letters, numbers, and dashes allowed");
      return;
    }
    if (keywords[bookmarkName]) {
      toast.error(`Bookmark "${bookmarkName}" already exists`);
      return;
    }

    const { expandedQuery } = validateAndExpandKeywordsSilently(query);
    addKeyword(bookmarkName.trim(), expandedQuery);
    toast.success(`Saved as bookmark "${bookmarkName}"`);
    setBookmarkingIndex(null);
    setBookmarkName("");
  };

  const handleBookmarkKeyDown = (e: React.KeyboardEvent, query: string) => {
    if (e.key === "Enter") handleBookmarkSubmit(query);
    if (e.key === "Escape") {
      setBookmarkingIndex(null);
      setBookmarkName("");
    }
  };

  // Reverse to show most recent first
  const reversedHistory = [...queryHistory].reverse();

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={subtleSpring}
      className="overflow-hidden"
    >
      <div
        className={cn(
          "rounded-lg overflow-hidden",
          "bg-muted/30 dark:bg-muted/20",
          "border border-border/50"
        )}
      >
        {/* Header */}
        {!hideHeader && (
          <div className="px-3 py-2 border-b border-border/40 bg-muted/40">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>Query History ({queryHistory.length})</span>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="max-h-64 overflow-y-auto">
          {reversedHistory.map((entry, index) => {
            const isCurrent = index === 0;
            const originalIndex = queryHistory.length - 1 - index;
            const date = new Date(entry.timestamp);
            const timeAgo = formatDistanceToNow(date, { addSuffix: true });
            const canDelete = !isCurrent;
            const isBookmarking = bookmarkingIndex === originalIndex;

            return (
              <div
                key={`${entry.timestamp}-${index}`}
                className={cn(
                  "relative border-b border-border/30 last:border-b-0",
                  isCurrent && "bg-primary/5"
                )}
              >
                {/* Current indicator bar */}
                {isCurrent && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
                )}

                <AnimatePresence mode="wait">
                  {isBookmarking ? (
                    <motion.div
                      key="bookmark-form"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="p-3"
                    >
                      <div className="flex items-center gap-2 text-amber-600 mb-2">
                        <BookmarkPlus className="h-4 w-4" />
                        <span className="text-sm font-medium">
                          Save as Bookmark
                        </span>
                      </div>
                      <Input
                        placeholder="bookmark-name"
                        value={bookmarkName}
                        onChange={(e) => setBookmarkName(e.target.value)}
                        onKeyDown={(e) => handleBookmarkKeyDown(e, entry.query)}
                        autoFocus
                        className="text-sm h-8 mb-2"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleBookmarkSubmit(entry.query)}
                          disabled={!bookmarkName.trim()}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setBookmarkingIndex(null);
                            setBookmarkName("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="content"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="p-3 pl-4"
                    >
                      <div className="flex items-start gap-3">
                        {/* Timeline indicator */}
                        <div className="shrink-0 mt-1.5">
                          <div
                            className={cn(
                              "w-2 h-2 rounded-full",
                              isCurrent
                                ? "bg-primary ring-2 ring-primary/30"
                                : "bg-muted-foreground/40"
                            )}
                          />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          {/* Query */}
                          <p
                            className={cn(
                              "text-sm font-mono break-all mb-1",
                              isCurrent
                                ? "text-primary font-medium"
                                : "text-foreground"
                            )}
                          >
                            {entry.query}
                          </p>

                          {/* Timestamp */}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{timeAgo}</span>
                            <span className="opacity-40">•</span>
                            <span>
                              {date.toLocaleDateString()}{" "}
                              {date.toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            {isCurrent && (
                              <>
                                <span className="opacity-40">•</span>
                                <span className="text-primary font-medium">
                                  Current
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleCopy(entry.query)}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Copy</TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setBookmarkingIndex(originalIndex)}
                              >
                                <BookmarkPlus className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Bookmark</TooltipContent>
                          </Tooltip>

                          {!isCurrent && onQuerySelect && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => onQuerySelect(entry.query)}
                                >
                                  <Search className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Use this query</TooltipContent>
                            </Tooltip>
                          )}

                          {canDelete && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 hover:text-destructive"
                                  onClick={() => handleDeleteEntry(originalIndex)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Remove</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
