"use client";

import React, { useState } from "react";
import { useTranslations, useFormatter, useNow } from "next-intl";
import {
  Copy,
  Trash2,
  BookmarkPlus,
  History,
  Wand2,
  X,
  ChevronLeft,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getIdColor } from "@/lib/format";
import { useSearchHistoryStore, useKeywordExpansionStore } from "@/lib/store";
import { shortcutNames } from "@/lib/query-shortcuts";
import type { ViewMode } from "@/lib/types";
import { showConfirmation } from "@/lib/confirmation";
import { useAppToast } from "@/lib/toast";
import { BookmarkForm } from "@/components/command-center";
import { QueryText } from "@/components/ui/query-text";
import { FilterChips } from "@/components/ui/filter-display";
import { languageOptions } from "@/components/language-selector";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation-browser";
import { HistoryQueryExpansion } from "./history-query-expansion";
import type { SearchResult } from "@/lib/types";
import { useSearchHistoryEntries } from "@/lib/research/history";

interface HistoryItemProps {
  item: SearchResult;
  viewMode: ViewMode;
  onSearchClick: (item: SearchResult) => void;
  /**
   * The list is choosing a search, not managing history: the open action
   * reads as "use", and saving as a bookmark or deleting are left out.
   */
  pickLabel?: string;
}

// An entry's actions take the place of its time while the entry is pointed at or
// focused, so nothing moves and no space sits empty. A touch screen has no
// pointer to wait for, so it shows both.
const TIME_YIELDS = "transition-opacity group-hover/entry:opacity-0 [@media(hover:hover)]:group-focus-within/entry:opacity-0";
const ACTIONS_APPEAR = "transition-opacity [@media(hover:hover)]:absolute [@media(hover:hover)]:right-0 [@media(hover:hover)]:[[data-entry]:not(:hover,:focus-within)_&]:opacity-0";
// The query is the entry's open control; its hit area covers the whole entry.
const OPEN = "rounded-sm text-left outline-none after:absolute after:inset-0 focus-visible:after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring";

export function HistoryItem({ item, viewMode, onSearchClick, pickLabel }: HistoryItemProps) {
  const toast = useAppToast();
  const th = useTranslations("historyPage");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const tToast = useTranslations("toast");
  const tl = useTranslations("languages");
  const format = useFormatter();
  const now = useNow();
  const [isBookmarking, setIsBookmarking] = useState(false);
  const [bookmarkName, setBookmarkName] = useState("");
  const [isQueryHistoryOpen, setIsQueryHistoryOpen] = useState(false);

  const removeSearchResult = useSearchHistoryStore((state) => state.removeSearchResult);
  const addKeyword = useKeywordExpansionStore((state) => state.addKeyword);

  const idColor = getIdColor(item.id);
  const queryHistoryCount = item.queryHistoryCount;
  const latestQuestion = item.latestQuestion;
  // Read from when the pointer reaches the versions button; the history waits for it, so it
  // opens at its full size.
  const [isHistoryWanted, setIsHistoryWanted] = useState(false);
  const history = useSearchHistoryEntries(item, "query", isQueryHistoryOpen || isHistoryWanted);
  const showHistory = isQueryHistoryOpen && queryHistoryCount > 1 && !history.isLoading;
  const historyProps = { queryHistory: history.entries, total: history.total, onLoadOlder: history.hasOlder ? history.loadOlder : undefined };

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
        removeSearchResult(item.id);
      },
    });
  };

  const handleBookmarkSubmit = async () => {
    if (!bookmarkName.trim()) {
      toast.validation.failed(tv("bookmarkNameRequired"));
      return;
    }
    if (!/^[a-zA-Z0-9-]+$/.test(bookmarkName.trim())) {
      toast.validation.failed(tv("bookmarkNameFormat"));
      return;
    }
    // An account looks up the name, to say whether it's taken, and the shortcuts the query names.
    try {
      await useKeywordExpansionStore.getState().ensureShortcuts([bookmarkName.trim(), ...shortcutNames(item.query)]);
    } catch {
      return;
    }
    if (useKeywordExpansionStore.getState().keywords[bookmarkName.trim()]) {
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

  const languageInfo = item.language ? languageOptions.find((l) => l.code === item.language) : null;
  const detailed = viewMode === "list-detail";
  const grid = viewMode === "grid-2" || viewMode === "grid-3";
  const roomy = detailed || viewMode === "grid-2";
  const compactCount = format.number(item.count, item.count >= 1000 ? { notation: "compact", maximumFractionDigits: 1 } : undefined);

  // The result count, in the colour the search also has as a tab in the sidebar.
  const count = (
    <span
      role="img"
      aria-label={`${format.number(item.count)} ${tc("results").toLowerCase()}`}
      className={cn(
        "flex shrink-0 flex-col items-center justify-center rounded-lg border font-semibold tabular-nums",
        roomy ? "h-12 w-[4.5rem] text-base leading-none" : "h-7 w-14 text-xs",
      )}
      style={{ backgroundColor: idColor.bg, color: idColor.text, borderColor: idColor.border }}
    >
      {compactCount}
      {roomy && <span className="mt-1 text-3xs font-normal">{tc("results").toLowerCase()}</span>}
    </span>
  );

  const open = (clamp: string) => (
    <button type="button" className={cn(OPEN, "text-sm font-medium [overflow-wrap:anywhere]", clamp)} onClick={() => onSearchClick(item)}>
      <QueryText query={item.query} />
    </button>
  );


  const question = latestQuestion ? (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Wand2 aria-hidden className="size-3.5 shrink-0" />
      <TooltipHint label={latestQuestion} onlyWhenClipped>
        <span className="relative z-10 truncate">{latestQuestion}</span>
      </TooltipHint>
    </p>
  ) : null;

  // How many queries the search has had; opens them.
  const versions = queryHistoryCount > 1 ? (
    <TooltipHint label={th("queryHistoryCount", { count: queryHistoryCount })}>
      <button
        type="button"
        aria-expanded={isQueryHistoryOpen}
        className={cn(
          "relative z-10 inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          isQueryHistoryOpen && "bg-accent text-foreground",
        )}
        onClick={() => setIsQueryHistoryOpen(!isQueryHistoryOpen)}
        onPointerEnter={() => setIsHistoryWanted(true)}
        onPointerLeave={() => setIsHistoryWanted(false)}
        onFocus={() => setIsHistoryWanted(true)}
        onBlur={() => setIsHistoryWanted(false)}
      >
        <History aria-hidden className="size-3.5" />
        {queryHistoryCount}
      </button>
    </TooltipHint>
  ) : null;

  const language = languageInfo ? (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-secondary px-2 text-xs text-secondary-foreground">
      <img src={languageInfo.flagUrl} alt="" className="h-3 w-4 rounded-sm border border-border-subtle object-cover" />
      {tl(languageInfo.code as never) || languageInfo.name}
    </span>
  ) : null;

  const action = (label: string, Icon: typeof Copy, onClick: () => void, danger = false) => (
    <TooltipHint label={label}>
      <Button variant="ghost" size="icon" aria-label={label} className={cn("size-7 text-muted-foreground", danger && "hover:text-destructive")} onClick={onClick}>
        <Icon className="size-3.5" />
      </Button>
    </TooltipHint>
  );
  const timeAndActions = (
    <div
      className={cn(
        "relative flex min-w-[5.25rem] shrink-0 items-center justify-end gap-1",
        // Beside the query's first line; on a narrow screen, a line of its own under the text.
        detailed && "h-7 self-start max-sm:basis-full max-sm:flex-row-reverse max-sm:justify-between max-sm:pl-[5.25rem]",
      )}
    >
      <div className={cn("z-10 flex items-center", ACTIONS_APPEAR)}>
      {action(tc("copyQuery"), Copy, handleCopy)}
      {!pickLabel && action(tc("saveAsBookmark"), BookmarkPlus, () => setIsBookmarking(true))}
      {!pickLabel && action(tc("delete"), Trash2, handleDelete, true)}
      </div>
      <time dateTime={item.createdAt} className={cn("whitespace-nowrap text-xs tabular-nums text-muted-foreground", TIME_YIELDS, viewMode === "list-simple" && "max-sm:hidden")}>
        {format.relativeTime(new Date(item.createdAt), now)}
      </time>
    </div>
  );

  const bookmarkForm = (
    <BookmarkForm
      variant={grid ? "overlay" : "inline"}
      bookmarkName={bookmarkName}
      onNameChange={setBookmarkName}
      query={item.query}
      onSubmit={handleBookmarkSubmit}
      onCancel={handleBookmarkCancel}
    />
  );
  const queryHistory = (
    <HistoryQueryExpansion
      {...historyProps}
      currentQuery={item.query}
      searchId={item.id}
      readOnly={Boolean(pickLabel)}
      hideHeader={grid}
    />
  );

  if (grid) {
    return (
      <div className="fade-enter h-full">
        <div data-entry className="group/entry relative flex h-full flex-col overflow-hidden rounded-2xl border border-border-subtle bg-inset transition-colors hover:bg-muted">
          {showHistory ? (
            <>
              <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
                <span className="flex items-center gap-2 text-xs font-medium">
                  <History aria-hidden className="size-3.5 text-muted-foreground" />
                  {th("queryHistory")}
                  <span className="tabular-nums text-muted-foreground">{queryHistoryCount}</span>
                </span>
                <Button variant="ghost" size="icon" aria-label={th("backToCard")} className="size-6" onClick={() => setIsQueryHistoryOpen(false)}>
                  <X className="size-3.5" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto">{queryHistory}</div>
              <div className="flex justify-center border-t border-border-subtle p-2">
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-3 text-xs" onClick={() => setIsQueryHistoryOpen(false)}>
                  <ChevronLeft className="size-3" />
                  {th("backToCard")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className={cn("flex flex-1 flex-col", roomy ? "gap-2.5 p-4" : "gap-2 p-3")}>
                <div className="flex items-center gap-2">
                  {count}
                  {!roomy && versions}
                  <span className="flex-1" />
                  {timeAndActions}
                </div>
                {open(roomy ? "line-clamp-3" : "line-clamp-2")}
                {roomy && question}
                {roomy && (
                  <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
                    {versions}
                    {language}
                    <FilterChips filters={item} className="contents" />
                  </div>
                )}
              </div>
            </>
          )}
          {isBookmarking && bookmarkForm}
        </div>
      </div>
    );
  }

  return (
    <div className="fade-enter">
      <div data-entry className={cn("group/entry relative flex gap-3 px-4 transition-colors hover:bg-muted", detailed ? "flex-wrap py-4 sm:flex-nowrap" : "items-center py-2.5")}>
        {count}
        {detailed ? (
          <div className="min-w-0 flex-1 space-y-1.5">
            {open("line-clamp-2 block")}
            {question}
            <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
              {versions}
              {language}
              <FilterChips filters={item} className="contents" />
            </div>
          </div>
        ) : (
          <>
            <span className="min-w-0">{open("block w-full truncate")}</span>
            {versions}
            <span className="flex-1" />
          </>
        )}
        {timeAndActions}
      </div>
      {(isBookmarking || showHistory) && (
        <div className="space-y-3 px-4 pb-4">
          {isBookmarking && bookmarkForm}
          {showHistory && queryHistory}
        </div>
      )}
    </div>
  );
}
