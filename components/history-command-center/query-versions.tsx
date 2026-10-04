"use client";

import { useState } from "react";
import { useTranslations, useFormatter, useNow } from "next-intl";
import { BookmarkPlus, Copy, Trash2 } from "@/components/icons";
import { BookmarkForm } from "@/components/command-center";
import { EntryAction, EntryAside } from "@/components/command-center/entry";
import { useSearchHistoryStore } from "@/lib/store";
import { useAppToast } from "@/lib/toast";
import type { QueryHistoryEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The queries a search has had, newest first and numbered in the order they
 * were made; the highest number is the query the search has now.
 */
export function QueryVersions({
  queryHistory,
  total,
  onLoadOlder,
  searchId,
  readOnly = false,
}: {
  /** The newest queries; older ones are read as the list is scrolled to its end. */
  queryHistory: QueryHistoryEntry[];
  total: number;
  onLoadOlder?: () => void;
  searchId: string;
  readOnly?: boolean;
}) {
  const toast = useAppToast();
  const tc = useTranslations("common");
  const tToast = useTranslations("toast");
  const format = useFormatter();
  const now = useNow();
  const [bookmarking, setBookmarking] = useState<string | null>(null);
  const removeQueryHistoryEntry = useSearchHistoryStore((state) => state.removeQueryHistoryEntry);

  const copy = async (query: string) => {
    try {
      await navigator.clipboard.writeText(query);
    } catch {
      toast.clipboard.copyFailed(tToast("entityQuery"));
    }
  };

  return (
    <ol
      className="max-h-80 divide-y divide-border-subtle overflow-y-auto"
      onScroll={onLoadOlder && ((event) => {
        const list = event.currentTarget;
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 48) onLoadOlder();
      })}
    >
      {[...queryHistory].reverse().map((entry, index) => {
        const key = `${entry.timestamp}-${entry.query}`;
        const current = index === 0;
        return (
          <li
            key={key}
            data-entry
            data-active={bookmarking === key || undefined}
            aria-current={current || undefined}
            className="group/entry relative flex items-start gap-3 px-3 py-2.5"
          >
            <span
              aria-hidden
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-medium tabular-nums",
                current ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
              )}
            >
              {total - index}
            </span>
            {bookmarking === key ? (
              <BookmarkForm query={entry.query} onDone={() => setBookmarking(null)} className="flex-1" />
            ) : (
              <>
                <p className="min-w-0 flex-1 py-0.5 text-sm [overflow-wrap:anywhere]">{entry.query}</p>
                <EntryAside meta={<time dateTime={entry.timestamp}>{format.relativeTime(new Date(entry.timestamp), now)}</time>} className="h-6">
                  <EntryAction label={tc("copyQuery")} icon={Copy} onClick={() => void copy(entry.query)} />
                  {!readOnly && <EntryAction label={tc("saveAsBookmark")} icon={BookmarkPlus} onClick={() => setBookmarking(key)} />}
                  {!readOnly && !current && <EntryAction label={tc("delete")} icon={Trash2} danger onClick={() => removeQueryHistoryEntry(searchId, entry)} />}
                </EntryAside>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
