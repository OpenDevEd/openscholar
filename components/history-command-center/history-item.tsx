"use client";

import { useState, type ReactNode } from "react";
import { OQL_FIELD } from "@/lib/openalex/oql";
import { useTranslations, useFormatter, useNow } from "next-intl";
import { Copy, Trash2, BookmarkPlus, History, AiIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSearchHistoryStore } from "@/lib/store";
import type { SearchResult, ViewMode } from "@/lib/types";
import { showConfirmation } from "@/lib/confirmation";
import { useAppToast } from "@/lib/toast";
import { BookmarkForm, bookmarkable } from "@/components/command-center";
import { Entry, EntryAction, EntryAside, EntryTile, ENTRY_OPEN, FullTextToggle, isGrid, isRoomy } from "@/components/command-center/entry";
import { useFullText } from "@/components/evidence-libraries/configuration/disclosure-button";
import { QueryText } from "@/components/ui/query-text";
import { FilterChips } from "@/components/ui/filter-display";
import { languageOptions } from "@/components/language-selector";
import { useSearchHistoryEntries } from "@/lib/research/history";
import { QueryVersions } from "./query-versions";

interface HistoryItemProps {
  item: SearchResult;
  viewMode: ViewMode;
  onSearchClick: (item: SearchResult) => void;
  /** The list is choosing a search, not managing history: saving as a bookmark and deleting are left out. */
  choosing?: boolean;
  /** In an organization, who ran it. */
  runBy?: ReactNode;
  /** Whether the person may delete it: in an organization, whoever ran it and its admins may (#651). */
  canDelete?: boolean;
}

export function HistoryItem({ item, viewMode, onSearchClick, choosing = false, runBy, canDelete = true }: HistoryItemProps) {
  const toast = useAppToast();
  const th = useTranslations("historyPage");
  const tc = useTranslations("common");
  const tToast = useTranslations("toast");
  const tl = useTranslations("languages");
  const format = useFormatter();
  const now = useNow();
  const [isBookmarking, setIsBookmarking] = useState(false);
  const [isQueryHistoryOpen, setIsQueryHistoryOpen] = useState(false);
  // Read from when the pointer reaches the versions button; the list waits for it, so it
  // opens at its full size.
  const [isHistoryWanted, setIsHistoryWanted] = useState(false);
  const history = useSearchHistoryEntries(item, "query", isQueryHistoryOpen || isHistoryWanted);
  const removeSearchResult = useSearchHistoryStore((state) => state.removeSearchResult);
  const queryText = useFullText<HTMLButtonElement>(`${viewMode}|${item.query}`);

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
        if (useSearchHistoryStore.getState().removeSearchResult !== removeSearchResult) {
          toast.validation.failed(tToast("accountChanged"));
          return;
        }
        removeSearchResult(item.id);
      },
    });
  };

  const languageInfo = item.language ? languageOptions.find((l) => l.code === item.language) : null;
  const detailed = viewMode === "list-detail";
  const roomy = isRoomy(viewMode);
  const openSearch = () => onSearchClick(item);

  // The result count, in the colour the search also has as a tab in the sidebar.
  const count = (
    <EntryTile
      id={item.id}
      role="img"
      aria-label={`${format.number(item.count)} ${tc("results").toLowerCase()}`}
      className={roomy ? "h-12 w-[4.5rem] flex-col px-0 text-base leading-none" : "w-14 px-0"}
    >
      {format.number(item.count, item.count >= 1000 ? { notation: "compact", maximumFractionDigits: 1 } : undefined)}
      {roomy && <span className="mt-1 text-3xs font-normal">{tc("results").toLowerCase()}</span>}
    </EntryTile>
  );

  // The query, cut to `clamp` until it is asked for in full.
  const open = (clamp: string, shape?: string) => (
    <button ref={queryText.ref} type="button" className={cn(ENTRY_OPEN, shape, !queryText.expanded && clamp)} onClick={openSearch}>
      <QueryText query={item.query} oql={item.field === OQL_FIELD} />
    </button>
  );

  // Sits above the entry's hit area so its full text can show when clipped; a click still opens.
  const question = item.latestQuestion ? (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <AiIcon size={14} className="size-3.5 shrink-0" />
      <TooltipHint label={item.latestQuestion} onlyWhenClipped>
        <span className="relative z-10 truncate" onClick={openSearch}>{item.latestQuestion}</span>
      </TooltipHint>
    </p>
  ) : null;

  // How many queries the search has had; opens them.
  const versions = item.queryHistoryCount > 1 ? (
    <Popover open={isQueryHistoryOpen && !history.isLoading} onOpenChange={(next) => !next && setIsQueryHistoryOpen(false)}>
      <TooltipHint label={th("queryHistory")}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={th("queryHistory")}
            className="relative z-10 inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
            // Toggled here, not by the popover: it isn't open yet while the queries load, and a second click must still cancel.
            onClick={(event) => {
              event.preventDefault();
              setIsQueryHistoryOpen(!isQueryHistoryOpen);
            }}
            onPointerEnter={() => setIsHistoryWanted(true)}
            onPointerLeave={() => setIsHistoryWanted(false)}
            onFocus={() => setIsHistoryWanted(true)}
            onBlur={() => setIsHistoryWanted(false)}
          >
            <History aria-hidden className="size-3.5" />
            {item.queryHistoryCount}
          </button>
        </PopoverTrigger>
      </TooltipHint>
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="w-[min(36rem,calc(100vw-2rem))] overflow-hidden p-0"
        // Focus the list itself, not its first action, so no row looks pointed at on opening.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
      >
        <QueryVersions
          similarTo={item.similarTo}
          queryHistory={history.entries}
          total={history.total}
          onLoadOlder={history.hasOlder ? history.loadOlder : undefined}
          searchId={item.id}
          readOnly={choosing}
        />
      </PopoverContent>
    </Popover>
  ) : null;

  const chips = (
    <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
      <FullTextToggle text={queryText} className="-ms-1.5" />
      {versions}
      {languageInfo && (
        <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-secondary px-2 text-xs text-secondary-foreground">
          <img src={languageInfo.flagUrl} alt="" className="h-3 w-4 rounded-sm border border-border-subtle object-cover" />
          {tl(languageInfo.code as never) || languageInfo.name}
        </span>
      )}
      <FilterChips filters={item} className="contents" />
    </div>
  );

  const aside = (className?: string) => (
    <EntryAside
      className={className}
      meta={
        <time dateTime={item.createdAt} className={cn(viewMode === "list-simple" && "max-sm:hidden")}>
          {format.relativeTime(new Date(item.createdAt), now)}
        </time>
      }
    >
      <EntryAction label={tc("copyQuery")} icon={Copy} onClick={handleCopy} />
      {!choosing && bookmarkable(item.query, item.field, item.similarTo) && (
        <Popover open={isBookmarking} onOpenChange={setIsBookmarking}>
          <PopoverTrigger asChild>
            <EntryAction label={tc("saveAsBookmark")} icon={BookmarkPlus} />
          </PopoverTrigger>
          <PopoverContent align="end" collisionPadding={16} className="w-80 p-2">
            <BookmarkForm query={item.query} onDone={() => setIsBookmarking(false)} />
          </PopoverContent>
        </Popover>
      )}
      {!choosing && canDelete && <EntryAction label={tc("delete")} icon={Trash2} danger onClick={handleDelete} />}
    </EntryAside>
  );

  return (
    // In the one-line view everything lines up on the query's first line, also when the query is shown in full.
    <Entry viewMode={viewMode} active={isBookmarking || isQueryHistoryOpen} className={cn(viewMode === "list-simple" && "items-start")}>
      {isGrid(viewMode) ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {count}
            {!roomy && versions}
            <span className="flex-1" />
            {runBy}
            {aside()}
          </div>
          {open(roomy ? "line-clamp-3" : "line-clamp-2")}
          {!roomy && <FullTextToggle text={queryText} className="-ms-1.5 self-start" />}
          {roomy && question}
          {roomy && chips}
        </>
      ) : detailed ? (
        <>
          {count}
          <div className="min-w-0 flex-1 space-y-1.5">
            {open("line-clamp-2")}
            {question}
            {chips}
          </div>
          {runBy ? <span className="flex shrink-0 self-start">{runBy}</span> : null}
          {/* Beside the query's first line; on a narrow screen, a line of its own under the text. */}
          {aside("h-7 self-start max-sm:basis-full max-sm:flex-row-reverse max-sm:justify-between max-sm:ps-[5.25rem]")}
        </>
      ) : (
        <>
          {count}
          <span className="min-w-0">{open("truncate", "block w-full py-1")}</span>
          <FullTextToggle text={queryText} iconOnly className="mt-0.5" />
          {versions && <span className="mt-0.5 flex">{versions}</span>}
          <span className="flex-1" />
          {runBy ? <span className="flex shrink-0 self-start">{runBy}</span> : null}
          {aside("h-7")}
        </>
      )}
    </Entry>
  );
}
