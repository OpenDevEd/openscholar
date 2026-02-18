"use client";

import React, { useState } from "react";
import { useTranslations, useLocale, useFormatter, useNow } from "next-intl";
import { Search, Copy, BookmarkPlus, Trash2, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchHistoryBookmarkForm } from "@/components/search-history-bookmark-form";
import { cn } from "@/lib/utils";

export interface QueryHistoryDisplayProps {
  queryHistory: { query: string; timestamp: string }[];
  currentQuery: string;
  searchId?: string;
  onQuerySelect?: (searchId: string, query: string) => void;
  onCopyQuery?: (query: string) => void;
  onDeleteQueryEntry?: (searchId: string, queryIndex: number) => void;
  initiallyExpanded?: boolean;
}

export function QueryHistoryDisplay({
  queryHistory,
  currentQuery,
  searchId,
  onQuerySelect,
  onCopyQuery,
  onDeleteQueryEntry,
  initiallyExpanded = false,
}: QueryHistoryDisplayProps) {
  const t = useTranslations();
  const ta = useTranslations("accessibility");
  const th = useTranslations("historyPage");
  const format = useFormatter();
  const now = useNow();
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const [bookmarkingQueryIndex, setBookmarkingQueryIndex] = useState<number | null>(null);

  if (!queryHistory || queryHistory.length <= 1) {
    return null;
  }

  const handleQueryClick = (query: string) => {
    if (onQuerySelect && searchId && query !== currentQuery) {
      onQuerySelect(searchId, query);
    }
  };

  const handleQueryBookmarkClick = (queryIndex: number) => {
    setBookmarkingQueryIndex(queryIndex);
  };

  const handleQueryBookmarkCancel = () => {
    setBookmarkingQueryIndex(null);
  };

  const renderEntry = (entry: { query: string; timestamp: string }, index: number) => {
    const isMostRecent = index === 0;
    const originalIndex = queryHistory.length - 1 - index;
    const date = new Date(entry.timestamp);
    const timeAgo = format.relativeTime(date, now);
    const isClickable = onQuerySelect && searchId && entry.query !== currentQuery;
    const canDelete = !isMostRecent;

    return (
      <div
        key={`${entry.query}-${entry.timestamp}`}
        className={cn(
          "rounded-lg border overflow-hidden",
          isMostRecent ? "bg-primary/5 border-primary/30" : "bg-card border-border/60"
        )}
      >
        {isMostRecent && <div className="h-1 bg-primary" />}

        {bookmarkingQueryIndex === originalIndex ? (
          <div className="p-3">
            <SearchHistoryBookmarkForm
              query={entry.query}
              onSubmit={() => setBookmarkingQueryIndex(null)}
              onCancel={handleQueryBookmarkCancel}
              variant="compact"
            />
          </div>
        ) : (
          <div>
            <div className="p-3">
              <div className="flex items-start gap-2">
                <Search
                  className={cn(
                    "h-4 w-4 mt-0.5 flex-shrink-0",
                    isMostRecent ? "text-primary" : "text-muted-foreground"
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="mb-1">
                    <p
                      className={cn(
                        "text-sm font-mono break-all",
                        isMostRecent ? "text-primary font-medium" : "text-foreground"
                      )}
                    >
                      {entry.query}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{timeAgo}</span>
                    <span>•</span>
                    <span>{format.dateTime(date, { dateStyle: "short", timeStyle: "short" })}</span>
                  </div>
                </div>
                <div className="hidden md:flex items-center gap-1 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onCopyQuery?.(entry.query)}
                    title={ta("copyQuery")}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleQueryBookmarkClick(originalIndex)}
                    title={ta("saveAsBookmark")}
                  >
                    <BookmarkPlus className="h-3 w-3" />
                  </Button>
                  {isClickable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleQueryClick(entry.query)}
                      title={ta("searchWithQuery")}
                    >
                      <Search className="h-3 w-3" />
                    </Button>
                  )}
                  {canDelete && onDeleteQueryEntry && searchId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => onDeleteQueryEntry(searchId, originalIndex)}
                      title={ta("removeFromHistory")}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className="md:hidden border-t bg-muted/30 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => onCopyQuery?.(entry.query)}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    {t("common.copy")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => handleQueryBookmarkClick(originalIndex)}
                  >
                    <BookmarkPlus className="h-3 w-3 mr-1" />
                    {t("common.save")}
                  </Button>
                </div>
                <div className="flex gap-2">
                  {isClickable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => handleQueryClick(entry.query)}
                    >
                      <Search className="h-3 w-3 mr-1" />
                      {ta("switchQuery")}
                    </Button>
                  )}
                  {canDelete && onDeleteQueryEntry && searchId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => onDeleteQueryEntry(searchId, originalIndex)}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      {t("common.delete")}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (initiallyExpanded) {
    return (
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {queryHistory.slice().reverse().map((entry, index) => renderEntry(entry, index))}
      </div>
    );
  }

  return (
    <div className="mt-2 border-t pt-2">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {th("queryHistoryCount", { count: queryHistory.length })}
      </button>
      {isExpanded && (
        <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
          {queryHistory.slice().reverse().map((entry, index) => renderEntry(entry, index))}
        </div>
      )}
    </div>
  );
}
