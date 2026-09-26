"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslations, useLocale, useFormatter, useNow } from "next-intl";
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
import { useAppToast } from "@/lib/toast";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { subtleSpring } from "@/lib/animation-config";
import type { QueryHistoryEntry } from "@/lib/types";

interface HistoryQueryExpansionProps {
  queryHistory: QueryHistoryEntry[];
  currentQuery: string;
  searchId: string;
  onQuerySelect?: (query: string) => void;
  hideHeader?: boolean;
  readOnly?: boolean;
}

export function HistoryQueryExpansion({
  queryHistory,
  currentQuery,
  searchId,
  onQuerySelect,
  hideHeader = false,
  readOnly = false,
}: HistoryQueryExpansionProps) {
  const toast = useAppToast();
  const th = useTranslations("historyPage");
  const tc = useTranslations("common");
  const tAcc = useTranslations("accessibility");
  const tv = useTranslations("validation");
  const tToast = useTranslations("toast");
  const locale = useLocale();
  const format = useFormatter();
  const now = useNow();
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
    } catch {
      toast.clipboard.copyFailed(tToast("entityQuery"));
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

  };

  const handleBookmarkSubmit = (query: string) => {
    if (!bookmarkName.trim()) {
      toast.validation.failed(tv("bookmarkNameRequired"));
      return;
    }
    if (!/^[a-zA-Z0-9-]+$/.test(bookmarkName.trim())) {
      toast.validation.failed(tv("bookmarkNameFormat"));
      return;
    }
    if (keywords[bookmarkName]) {
      toast.validation.failed(tv("bookmarkNameExists", { name: bookmarkName }));
      return;
    }

    const { expandedQuery } = validateAndExpandKeywordsSilently(query);
    addKeyword(bookmarkName.trim(), expandedQuery);
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
              <span>{th("queryHistoryCount", { count: queryHistory.length })}</span>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="max-h-64 overflow-y-auto">
          {reversedHistory.map((entry, index) => {
            const isCurrent = index === 0;
            const originalIndex = queryHistory.length - 1 - index;
            const date = new Date(entry.timestamp);
            const timeAgo = format.relativeTime(date, now);
            const canDelete = !isCurrent && !readOnly;
            const isBookmarking = bookmarkingIndex === originalIndex;

            return (
              <div
                key={`${entry.timestamp}-${entry.query}`}
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
                          {tc("saveAsBookmark")}
                        </span>
                      </div>
                      <Input
                        placeholder={th("bookmarkNamePlaceholder")}
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
                          {tc("save")}
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
                          {tc("cancel")}
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
                        <div className="shrink-0 mt-0.5">
                          <Search
                            aria-hidden
                            className={cn("size-3.5", isCurrent ? "text-primary" : "text-muted-foreground/60")}
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
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{timeAgo}</span>
                            <span>
                              {format.dateTime(date, { dateStyle: "short", timeStyle: "short" })}
                            </span>
                            {isCurrent && (
                              <span className="text-primary font-medium">
                                {th("current")}
                              </span>
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
                            <TooltipContent>{tc("copy")}</TooltipContent>
                          </Tooltip>

                          {!readOnly && (
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
                              <TooltipContent>{tc("bookmark")}</TooltipContent>
                            </Tooltip>
                          )}

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
                              <TooltipContent>{tAcc("useThisQuery")}</TooltipContent>
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
                              <TooltipContent>{tc("remove")}</TooltipContent>
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
