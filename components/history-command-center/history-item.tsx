"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Copy,
  Search,
  Trash2,
  BookmarkPlus,
  History,
  Languages,
  Check,
  X,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatNumber, formatTimeAgo, getIdColor } from "@/lib/format";
import { useSearchHistoryStore, useKeywordExpansionStore, ViewMode } from "@/lib/store";
import { showConfirmation } from "@/lib/confirmation";
import { toast } from "sonner";
import { QueryText } from "@/components/ui/query-text";
import { HistoryFilterBadges } from "@/components/ui/filter-display";
import { languageOptions } from "@/components/language-selector";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";
import { HistoryQueryExpansion } from "./history-query-expansion";
import { subtleSpring } from "./index";
import type { SearchResult } from "@/lib/types";

// Helper functions
function getFieldLabel(field?: string): string {
  const labels: Record<string, string> = {
    title: "Title",
    abstract: "Abstract",
    title_and_abstract: "Title + Abstract",
    fulltext: "Full Text",
    raw: "Raw Query",
  };
  return labels[field || ""] || "All Fields";
}

function hasActiveFilters(result: SearchResult): boolean {
  return !!(
    result.yearRange ||
    result.dateRange ||
    (result.selectedRegions && result.selectedRegions.length > 0) ||
    (result.selectedCountryFocus && result.selectedCountryFocus.length > 0) ||
    result.citesItemId ||
    result.citedByItemId ||
    result.relatedToItemId ||
    result.ratingRange ||
    result.reviewFilter ||
    result.onlyRatedPapers
  );
}

interface HistoryItemProps {
  item: SearchResult;
  index: number;
  viewMode: ViewMode;
  onSearchClick: (item: SearchResult) => void;
}

export function HistoryItem({
  item,
  index,
  viewMode,
  onSearchClick,
}: HistoryItemProps) {
  const [isBookmarking, setIsBookmarking] = useState(false);
  const [bookmarkName, setBookmarkName] = useState("");
  const [isQueryHistoryOpen, setIsQueryHistoryOpen] = useState(false);

  const { removeSearchResult, searchHistory } = useSearchHistoryStore();
  const { addKeyword, keywords } = useKeywordExpansionStore();

  const idColor = getIdColor(item.id);
  const queryHistoryCount = item.queryHistory?.length || 0;
  const latestQuestion = item.questionHistory?.[item.questionHistory.length - 1]?.question;

  // Find the actual index in the full history for deletion
  const actualIndex = searchHistory.findIndex((h) => h.id === item.id);

  // Handlers
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(item.query);
      toast.success("Query copied to clipboard");
    } catch {
      toast.success("Query copied to clipboard");
    }
  };

  const handleDelete = () => {
    const truncatedQuery =
      item.query.length > 50 ? item.query.substring(0, 50) + "..." : item.query;
    showConfirmation({
      title: "Delete Search Entry",
      message: `Are you sure you want to delete "${truncatedQuery}"?`,
      confirmText: "Delete",
      onConfirm: () => {
        removeSearchResult(actualIndex);
        toast.success("Search entry deleted");
      },
    });
  };

  const handleBookmarkSubmit = () => {
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

    const { expandedQuery } = validateAndExpandKeywordsSilently(item.query);
    addKeyword(bookmarkName.trim(), expandedQuery);
    toast.success(`Saved as bookmark "${bookmarkName}"`);
    setIsBookmarking(false);
    setBookmarkName("");
  };

  const handleBookmarkKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleBookmarkSubmit();
    if (e.key === "Escape") {
      setIsBookmarking(false);
      setBookmarkName("");
    }
  };

  // Get language info
  const languageInfo = item.language
    ? languageOptions.find((l) => l.code === item.language)
    : null;

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
          "transition-all duration-200"
        )}
      >
        {/* Main row */}
        <div className="flex items-center gap-3 px-3 py-2.5">
          {/* Result count badge - compact */}
          <div
            className={cn(
              "shrink-0 px-2 py-1 rounded-md text-xs font-semibold tabular-nums"
            )}
            style={{
              backgroundColor: idColor.bg,
              color: idColor.text,
              border: `1px solid ${idColor.border}`,
            }}
          >
            {formatNumber(item.count)}
          </div>

          {/* Query text */}
          <div className="flex-1 min-w-0 truncate text-sm">
            <QueryText query={item.query} />
          </div>

          {/* Time ago */}
          <span className="shrink-0 text-xs text-muted-foreground hidden sm:block">
            {formatTimeAgo(item.createdAt)}
          </span>

          {/* Actions - always visible */}
          <div className="flex items-center gap-0.5 shrink-0">
            {queryHistoryCount > 1 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-7 w-7",
                      isQueryHistoryOpen && "bg-muted text-foreground"
                    )}
                    onClick={() => setIsQueryHistoryOpen(!isQueryHistoryOpen)}
                  >
                    <History className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Query history ({queryHistoryCount})</TooltipContent>
              </Tooltip>
            )}

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
              <TooltipContent>Copy query</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setIsBookmarking(true)}
                >
                  <BookmarkPlus className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save as bookmark</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onSearchClick(item)}
                >
                  <Search className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open search</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:text-destructive"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Bookmark form */}
        {isBookmarking && (
          <div className="px-3 pb-3">
            <BookmarkForm
              bookmarkName={bookmarkName}
              setBookmarkName={setBookmarkName}
              query={item.query}
              onSubmit={handleBookmarkSubmit}
              onCancel={() => {
                setIsBookmarking(false);
                setBookmarkName("");
              }}
              onKeyDown={handleBookmarkKeyDown}
            />
          </div>
        )}

        {/* Query history expansion */}
        {isQueryHistoryOpen && queryHistoryCount > 1 && (
          <div className="px-3 pb-3">
            <HistoryQueryExpansion
              queryHistory={item.queryHistory}
              currentQuery={item.query}
              searchId={item.id}
            />
          </div>
        )}
      </motion.div>
    );
  }

  if (viewMode === "grid-2" || viewMode === "grid-3") {
    const isCompact = viewMode === "grid-3";
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...subtleSpring, delay: index * 0.03 }}
        whileHover={isQueryHistoryOpen ? undefined : { y: -2 }}
        className={cn(
          "group relative flex flex-col rounded-xl overflow-hidden",
          "bg-card/50 dark:bg-card/40",
          "border border-border/40",
          "hover:border-border/60 hover:shadow-md",
          "transition-all duration-200"
        )}
      >
        {isQueryHistoryOpen && queryHistoryCount > 1 ? (
          /* Mini-page view: header + scrollable history */
          <>
            {/* Mini-page header */}
            <div
              className={cn(
                "flex items-center justify-between px-3 py-2 border-b border-border/30",
                "bg-muted/30"
              )}
            >
              <div className="flex items-center gap-2">
                <History className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">Query History</span>
                <span className="text-xs text-muted-foreground">
                  ({queryHistoryCount})
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setIsQueryHistoryOpen(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Scrollable history content */}
            <div className="flex-1 overflow-y-auto">
              <HistoryQueryExpansion
                queryHistory={item.queryHistory}
                currentQuery={item.query}
                searchId={item.id}
                hideHeader
              />
            </div>

            {/* Back button footer */}
            <div
              className={cn(
                "flex items-center justify-center gap-1 px-2 py-2 border-t border-border/30",
                "bg-muted/20"
              )}
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-3 gap-1.5 text-xs"
                onClick={() => setIsQueryHistoryOpen(false)}
              >
                <ChevronLeft className="h-3 w-3" />
                Back to card
              </Button>
            </div>
          </>
        ) : (
          /* Normal card view */
          <>
            {/* Top colored section with count */}
            <div
              className={cn(
                "flex items-center justify-center py-4",
                isCompact ? "py-3" : "py-5"
              )}
              style={{ backgroundColor: idColor.bg }}
            >
              <span
                className={cn(
                  "font-bold tabular-nums",
                  isCompact ? "text-xl" : "text-2xl"
                )}
                style={{ color: idColor.text }}
              >
                {formatNumber(item.count)}
              </span>
              <span
                className="text-xs ml-1.5 opacity-70"
                style={{ color: idColor.text }}
              >
                results
              </span>
            </div>

            {/* Content */}
            <div className={cn("flex-1 p-3", isCompact ? "p-2.5" : "p-3")}>
              {/* Query */}
              <p
                className={cn(
                  "font-medium leading-snug mb-2",
                  isCompact
                    ? "text-xs line-clamp-2"
                    : "text-sm line-clamp-3"
                )}
              >
                <QueryText query={item.query} />
              </p>

              {/* Metadata */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{formatTimeAgo(item.createdAt)}</span>
                {!isCompact && (
                  <>
                    <span className="opacity-40">•</span>
                    <span>{getFieldLabel(item.field)}</span>
                  </>
                )}
              </div>

              {/* Language */}
              {languageInfo && !isCompact && (
                <div className="flex items-center gap-1.5 mt-1.5 text-xs">
                  <img
                    src={languageInfo.flagUrl}
                    alt={languageInfo.name}
                    className="w-4 h-3 rounded-sm object-cover shadow-sm border border-border/30"
                  />
                  <span className="text-muted-foreground">{languageInfo.name}</span>
                </div>
              )}
            </div>

            {/* Actions footer */}
            <div
              className={cn(
                "flex items-center justify-center gap-1 px-2 py-2 border-t border-border/30",
                "bg-muted/20"
              )}
            >
              {queryHistoryCount > 1 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setIsQueryHistoryOpen(true)}
                    >
                      <History className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>History ({queryHistoryCount})</TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
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
                    onClick={() => setIsBookmarking(true)}
                  >
                    <BookmarkPlus className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Bookmark</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onSearchClick(item)}
                  >
                    <Search className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:text-destructive"
                    onClick={handleDelete}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            </div>
          </>
        )}

        {/* Bookmark form overlay */}
        {isBookmarking && (
          <BookmarkOverlay
            bookmarkName={bookmarkName}
            setBookmarkName={setBookmarkName}
            query={item.query}
            onSubmit={handleBookmarkSubmit}
            onCancel={() => {
              setIsBookmarking(false);
              setBookmarkName("");
            }}
            onKeyDown={handleBookmarkKeyDown}
          />
        )}
      </motion.div>
    );
  }

  // list-detail (default) - full detailed view
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
        "transition-all duration-200"
      )}
    >
      <div className="p-4">
        {/* Main content row */}
        <div className="flex gap-4">
          {/* Result count block */}
          <div
            className={cn(
              "shrink-0 flex flex-col items-center justify-center px-4 py-3 rounded-lg min-w-[80px]"
            )}
            style={{
              backgroundColor: idColor.bg,
              border: `1px solid ${idColor.border}`,
            }}
          >
            <span
              className="text-xl font-bold tabular-nums leading-none"
              style={{ color: idColor.text }}
            >
              {formatNumber(item.count)}
            </span>
            <span
              className="text-[10px] opacity-70 mt-0.5"
              style={{ color: idColor.text }}
            >
              results
            </span>
          </div>

          {/* Info section */}
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
            {/* Query */}
            <p className="text-sm font-medium leading-tight break-words">
              <QueryText query={item.query} />
            </p>

            {/* Research question */}
            {latestQuestion && (
              <p
                className="text-xs text-muted-foreground leading-tight truncate"
                title={latestQuestion}
              >
                <span className="opacity-60">Q:</span> {latestQuestion}
              </p>
            )}

            {/* Metadata */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span>{formatTimeAgo(item.createdAt)}</span>
              <span className="opacity-40">•</span>
              <span>{getFieldLabel(item.field)}</span>
              {item.sortBy && (
                <>
                  <span className="opacity-40">•</span>
                  <span className="capitalize">{item.sortBy}</span>
                </>
              )}
            </div>

            {/* Language */}
            <div className="flex items-center gap-1.5 text-xs">
              {languageInfo ? (
                <>
                  <img
                    src={languageInfo.flagUrl}
                    alt={languageInfo.name}
                    className="w-4 h-3 rounded-sm object-cover shadow-sm border border-border/30"
                  />
                  <span className="text-foreground">{languageInfo.name}</span>
                </>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Languages className="h-3 w-3" />
                  <span className="italic">Language not set</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Bookmark form */}
        {isBookmarking && (
          <div className="mt-4">
            <BookmarkForm
              bookmarkName={bookmarkName}
              setBookmarkName={setBookmarkName}
              query={item.query}
              onSubmit={handleBookmarkSubmit}
              onCancel={() => {
                setIsBookmarking(false);
                setBookmarkName("");
              }}
              onKeyDown={handleBookmarkKeyDown}
            />
          </div>
        )}

        {/* Footer: Filters + History + Actions */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/40">
          {/* Left: Filters */}
          <div className="flex-1 overflow-x-auto scrollbar-hover">
            {hasActiveFilters(item) && (
              <HistoryFilterBadges result={item} variant="compact" />
            )}
          </div>

          {/* Right: History toggle + Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {queryHistoryCount > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => setIsQueryHistoryOpen(!isQueryHistoryOpen)}
              >
                <History className="h-3 w-3" />
                <span className="text-xs">{queryHistoryCount}</span>
              </Button>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
                  <Copy className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy query</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setIsBookmarking(true)}
                >
                  <BookmarkPlus className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save as bookmark</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onSearchClick(item)}
                >
                  <Search className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open search</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:text-destructive"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Query history expansion */}
        {isQueryHistoryOpen && queryHistoryCount > 1 && (
          <div className="mt-4">
            <HistoryQueryExpansion
              queryHistory={item.queryHistory}
              currentQuery={item.query}
              searchId={item.id}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

// Bookmark form component for list-detail view
function BookmarkForm({
  bookmarkName,
  setBookmarkName,
  query,
  onSubmit,
  onCancel,
  onKeyDown,
}: {
  bookmarkName: string;
  setBookmarkName: (name: string) => void;
  query: string;
  onSubmit: () => void;
  onCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const { expandedQuery } = validateAndExpandKeywordsSilently(query);

  return (
    <div className="space-y-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
        <BookmarkPlus className="h-4 w-4" />
        <span className="text-sm font-medium">Save as Bookmark</span>
      </div>

      <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
        Use the format &quot;bookmark...&quot; in your search to expand automatically.
      </p>

      <div className="text-xs text-amber-700 dark:text-amber-300 font-mono break-all p-2 rounded border border-amber-200 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/50">
        &quot;{expandedQuery}&quot;
      </div>

      <Input
        placeholder="Enter bookmark name (e.g., ai-research)"
        value={bookmarkName}
        onChange={(e) => setBookmarkName(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        className="text-sm bg-background border-amber-200 dark:border-amber-800 focus:border-amber-400"
      />

      <p className="text-xs text-amber-600 dark:text-amber-400">
        Letters, numbers, and dashes only. No spaces.
      </p>

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={!bookmarkName.trim()}
          className="bg-amber-600 hover:bg-amber-700 text-white"
        >
          <Check className="h-3 w-3 mr-1" />
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// Bookmark overlay for grid views
function BookmarkOverlay({
  bookmarkName,
  setBookmarkName,
  query,
  onSubmit,
  onCancel,
  onKeyDown,
}: {
  bookmarkName: string;
  setBookmarkName: (name: string) => void;
  query: string;
  onSubmit: () => void;
  onCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const { expandedQuery } = validateAndExpandKeywordsSilently(query);

  return (
    <div className="absolute inset-0 bg-background/95 backdrop-blur-sm flex flex-col p-3 z-10 overflow-y-auto">
      <div className="flex-1 flex flex-col space-y-2.5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-600">
            <BookmarkPlus className="h-4 w-4" />
            <span className="text-sm font-medium">Save as Bookmark</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={onCancel}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Explanation */}
        <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
          Use &quot;bookmark...&quot; in search to expand automatically.
        </p>

        {/* Expanded query preview */}
        <div className="text-xs text-amber-700 dark:text-amber-300 font-mono break-all p-2 rounded border border-amber-200 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/50 max-h-20 overflow-y-auto">
          &quot;{expandedQuery}&quot;
        </div>

        {/* Input */}
        <Input
          placeholder="Enter bookmark name (e.g., ai-research)"
          value={bookmarkName}
          onChange={(e) => setBookmarkName(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
          className="text-sm h-8 bg-background border-amber-200 dark:border-amber-800 focus:border-amber-400"
        />

        {/* Validation hint */}
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Letters, numbers, and dashes only. No spaces.
        </p>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={!bookmarkName.trim()}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            <Check className="h-3 w-3 mr-1" />
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
