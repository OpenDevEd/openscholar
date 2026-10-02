"use client";

import React, { useState } from "react";
import { motion } from "motion/react";
import { useTranslations, useLocale, useFormatter, useNow } from "next-intl";
import {
  Copy,
  Search,
  Trash2,
  BookmarkPlus,
  History,
  Languages,
  X,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipHint,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getIdColor } from "@/lib/format";
import { useSearchHistoryStore, useKeywordExpansionStore } from "@/lib/store";
import type { ViewMode } from "@/lib/types";
import { showConfirmation } from "@/lib/confirmation";
import { useAppToast } from "@/lib/toast";
import { BookmarkForm } from "@/components/command-center";
import { QueryText } from "@/components/ui/query-text";
import { FilterChips } from "@/components/ui/filter-display";
import { languageOptions } from "@/components/language-selector";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation-browser";
import { HistoryQueryExpansion } from "./history-query-expansion";
import { subtleSpring } from "@/lib/animation-config";
import type { SearchResult } from "@/lib/types";
import { useSearchHistoryEntries } from "@/lib/research/history";
import {
  getFieldLabel,
  getSortLabel,
  hasActiveFiltersFromResult,
  type FilterT,
} from "@/lib/filters";

interface HistoryItemProps {
  item: SearchResult;
  index: number;
  viewMode: ViewMode;
  onSearchClick: (item: SearchResult) => void;
  /**
   * The list is choosing a search, not managing history: the open action
   * reads as "use", and saving as a bookmark or deleting are left out.
   */
  pickLabel?: string;
}

export function HistoryItem({
  item,
  index,
  viewMode,
  onSearchClick,
  pickLabel,
  }: HistoryItemProps) {
  const toast = useAppToast();
  const th = useTranslations("historyPage");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const tToast = useTranslations("toast");
  const tp = useTranslations("paperCard");
  const tl = useTranslations("languages");
  const tFilters = useTranslations("searchFilters");
  const locale = useLocale();
  const format = useFormatter();
  const now = useNow();
  const [isBookmarking, setIsBookmarking] = useState(false);
  const [bookmarkName, setBookmarkName] = useState("");
  const [isQueryHistoryOpen, setIsQueryHistoryOpen] = useState(false);

  const { removeSearchResult, searchHistory } = useSearchHistoryStore();
  const { addKeyword, keywords } = useKeywordExpansionStore();

  const idColor = getIdColor(item.id);
  const queryHistoryCount = item.queryHistoryCount;
  const latestQuestion = item.latestQuestion;
  // Read from when the pointer reaches the History button; the history waits for it, so it
  // opens at its full size.
  const [isHistoryWanted, setIsHistoryWanted] = useState(false);
  const history = useSearchHistoryEntries(item, "query", isQueryHistoryOpen || isHistoryWanted);
  const historyButtonProps = {
    onClick: () => setIsQueryHistoryOpen(!isQueryHistoryOpen),
    onPointerEnter: () => setIsHistoryWanted(true),
    onPointerLeave: () => setIsHistoryWanted(false),
    onFocus: () => setIsHistoryWanted(true),
    onBlur: () => setIsHistoryWanted(false),
  };
  const showHistory = isQueryHistoryOpen && queryHistoryCount > 1 && !history.isLoading;
  const historyProps = { queryHistory: history.entries, total: history.total, onLoadOlder: history.hasOlder ? history.loadOlder : undefined };

  // Find the actual index in the full history for deletion
  const actualIndex = searchHistory.findIndex((h) => h.id === item.id);

  // Handlers
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(item.query);
    } catch {
      toast.clipboard.copyFailed(tToast("entityQuery"));
    }
  };

  const handleDelete = () => {
    showConfirmation({
      title: th("deleteSearchEntry"),
      message: th("deleteConfirm"),
      confirmText: tc("delete"),
      cancelText: tc("cancel"),
      onConfirm: () => {
        removeSearchResult(actualIndex);
      },
    });
  };

  const handleBookmarkSubmit = () => {
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

    const { expandedQuery } = validateAndExpandKeywordsSilently(item.query);
    addKeyword(bookmarkName.trim(), expandedQuery);
    setIsBookmarking(false);
    setBookmarkName("");
  };

  const handleBookmarkCancel = () => {
    setIsBookmarking(false);
    setBookmarkName("");
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
          "transition-[background-color,border-color,box-shadow] duration-200"
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
            {format.number(item.count, item.count >= 1000 ? { notation: 'compact', maximumFractionDigits: 1 } : undefined)}
          </div>

          {/* Query text */}
          <div className="flex-1 min-w-0 truncate text-sm">
            <QueryText query={item.query} />
          </div>

          {/* Time ago */}
          <span className="shrink-0 text-xs text-muted-foreground hidden sm:block">
            {format.relativeTime(new Date(item.createdAt), now)}
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
                    {...historyButtonProps}
                  >
                    <History className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{th("queryHistoryCount", { count: queryHistoryCount })}</TooltipContent>
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
              <TooltipContent>{tc("copyQuery")}</TooltipContent>
            </Tooltip>

            {!pickLabel && (
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
                <TooltipContent>{tc("saveAsBookmark")}</TooltipContent>
              </Tooltip>
            )}

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
              <TooltipContent>{pickLabel ?? tc("openSearch")}</TooltipContent>
            </Tooltip>

            {!pickLabel && (
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
                <TooltipContent>{tc("delete")}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Bookmark form */}
        {isBookmarking && (
          <div className="px-3 pb-3">
            <BookmarkForm
              variant="inline"
              bookmarkName={bookmarkName}
              onNameChange={setBookmarkName}
              query={item.query}
              onSubmit={handleBookmarkSubmit}
              onCancel={handleBookmarkCancel}
            />
          </div>
        )}

        {/* Query history expansion */}
        {showHistory && (
          <div className="px-3 pb-3">
            <HistoryQueryExpansion
              {...historyProps}
              currentQuery={item.query}
              searchId={item.id}
              readOnly={Boolean(pickLabel)}
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
          "transition-[background-color,border-color,box-shadow] duration-200"
        )}
      >
        {showHistory ? (
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
                <span className="text-xs font-medium">{th("queryHistory")}</span>
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
                {...historyProps}
                currentQuery={item.query}
                searchId={item.id}
                readOnly={Boolean(pickLabel)}
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
                {th("backToCard")}
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
                {format.number(item.count, item.count >= 1000 ? { notation: 'compact', maximumFractionDigits: 1 } : undefined)}
              </span>
              <span
                className="text-xs ml-1.5 opacity-70"
                style={{ color: idColor.text }}
              >
                {tc("results").toLowerCase()}
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
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{format.relativeTime(new Date(item.createdAt), now)}</span>
                {!isCompact && <span>{getFieldLabel(item.field, tFilters as FilterT)}</span>}
              </div>

              {/* Language */}
              {languageInfo && !isCompact && (
                <div className="flex items-center gap-1.5 mt-1.5 text-xs">
                  <img
                    src={languageInfo.flagUrl}
                    alt={tl(languageInfo.code as never) || languageInfo.name}
                    className="w-4 h-3 rounded-sm object-cover shadow-sm border border-border/30"
                  />
                  <span className="text-muted-foreground">{tl(languageInfo.code as never) || languageInfo.name}</span>
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
                  <TooltipContent>{th("queryHistoryCount", { count: queryHistoryCount })}</TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{tc("copy")}</TooltipContent>
              </Tooltip>

              {!pickLabel && (
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
                  <TooltipContent>{tc("bookmark")}</TooltipContent>
                </Tooltip>
              )}

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
                <TooltipContent>{pickLabel ?? tc("open")}</TooltipContent>
              </Tooltip>

              {!pickLabel && (
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
                  <TooltipContent>{tc("delete")}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </>
        )}

        {/* Bookmark form overlay */}
        {isBookmarking && (
          <BookmarkForm
            variant="overlay"
            bookmarkName={bookmarkName}
            onNameChange={setBookmarkName}
            query={item.query}
            onSubmit={handleBookmarkSubmit}
            onCancel={handleBookmarkCancel}
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
        "transition-[background-color,border-color,box-shadow] duration-200"
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
              {format.number(item.count, item.count >= 1000 ? { notation: 'compact', maximumFractionDigits: 1 } : undefined)}
            </span>
            <span
              className="text-[10px] opacity-70 mt-0.5"
              style={{ color: idColor.text }}
            >
              {tc("results").toLowerCase()}
            </span>
          </div>

          {/* Info section */}
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
            {/* Query */}
            <p className="text-sm font-medium leading-tight break-words line-clamp-3 [overflow-wrap:anywhere]">
              <QueryText query={item.query} />
            </p>

            {/* Research question */}
            {latestQuestion && (
              <TooltipHint label={latestQuestion} onlyWhenClipped>
                <p className="text-xs text-muted-foreground leading-tight truncate">
                  <span className="opacity-60">{tc("questionPrefix")}</span> {latestQuestion}
                </p>
              </TooltipHint>
            )}

            {/* Metadata */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span>{format.relativeTime(new Date(item.createdAt), now)}</span>
              <span>{getFieldLabel(item.field, tFilters as FilterT)}</span>
              {item.sortBy && getSortLabel(item.sortBy, tFilters as FilterT) && (
                <span>{getSortLabel(item.sortBy, tFilters as FilterT)}</span>
              )}
            </div>

            {/* Language */}
            <div className="flex items-center gap-1.5 text-xs">
              {languageInfo ? (
                <>
                  <img
                    src={languageInfo.flagUrl}
                    alt={tl(languageInfo.code as never) || languageInfo.name}
                    className="w-4 h-3 rounded-sm object-cover shadow-sm border border-border/30"
                  />
                  <span className="text-foreground">{tl(languageInfo.code as never) || languageInfo.name}</span>
                </>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Languages className="h-3 w-3" />
                  <span className="italic">{tp("languageNotSet")}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Bookmark form */}
        {isBookmarking && (
          <div className="mt-4">
            <BookmarkForm
              variant="inline"
              bookmarkName={bookmarkName}
              onNameChange={setBookmarkName}
              query={item.query}
              onSubmit={handleBookmarkSubmit}
              onCancel={handleBookmarkCancel}
            />
          </div>
        )}

        {/* Footer: Filters + History + Actions */}
        <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-border/40">
          {/* Left: Filters */}
          <div className="min-w-0 flex-1 overflow-x-auto scrollbar-hover mask-r-from-[calc(100%-2rem)]">
            {/* Scope and sort are in the header already. */}
            {hasActiveFiltersFromResult(item) && (
              <FilterChips filters={{ ...item, field: undefined, sortBy: undefined }} singleLine />
            )}
          </div>

          {/* Right: History toggle + Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {queryHistoryCount > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1 text-muted-foreground hover:text-foreground"
                {...historyButtonProps}
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
              <TooltipContent>{tc("copyQuery")}</TooltipContent>
            </Tooltip>

            {!pickLabel && (
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
                <TooltipContent>{tc("saveAsBookmark")}</TooltipContent>
              </Tooltip>
            )}

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
              <TooltipContent>{pickLabel ?? tc("openSearch")}</TooltipContent>
            </Tooltip>

            {!pickLabel && (
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
                <TooltipContent>{tc("delete")}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Query history expansion */}
        {showHistory && (
          <div className="mt-4">
            <HistoryQueryExpansion
              {...historyProps}
              currentQuery={item.query}
              searchId={item.id}
              readOnly={Boolean(pickLabel)}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

