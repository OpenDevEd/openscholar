"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useConvex, usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { QueryHistoryEntry, QuestionHistoryEntry, SearchResult } from "../types";

/** History entries read at once; a longer history reads more as it's scrolled or stepped through. */
const HISTORY_PAGE = 25;
/** Most entries the server returns in one page. */
const HISTORY_PAGE_MAX = 100;

type Kind = "query" | "question";
type Entry<K extends Kind> = K extends "query" ? QueryHistoryEntry : QuestionHistoryEntry;
type Row = { text: string; field?: QueryHistoryEntry["field"]; timestamp: string };

function toEntry<K extends Kind>(kind: K, row: Row) {
  return (kind === "query" ? { query: row.text, field: row.field, timestamp: row.timestamp } : { question: row.text, timestamp: row.timestamp }) as Entry<K>;
}

/**
 * A search's earlier queries or research questions, oldest first (#354). A signed-out
 * visitor's search keeps them in this browser; an account's are read from the server,
 * newest first, a page at a time, only while `enabled`, so lists never load them. The first
 * page holds at least `minimum` entries, as many as when the hook mounted, up to 100.
 */
export function useSearchHistoryEntries<K extends Kind>(search: SearchResult | null | undefined, kind: K, enabled = true, minimum = 0) {
  const { userId } = useAuth();
  const convex = useConvex();
  const [firstPage] = useState(() => Math.min(HISTORY_PAGE_MAX, Math.max(HISTORY_PAGE, minimum)));
  const local = (kind === "query" ? search?.queryHistory : search?.questionHistory) as Entry<K>[] | undefined;
  const remote = usePaginatedQuery(
    api.research.records.searchHistory,
    search && userId && !local && enabled ? { accountId: userId, id: search.id, kind } : "skip",
    { initialNumItems: firstPage },
  );
  const entries = useMemo(() => local ?? [...remote.results].reverse().map((row) => toEntry(kind, row)), [local, remote.results, kind]);
  const total = kind === "query" ? (search?.queryHistoryCount ?? 0) : (search?.questionCount ?? 0);
  return {
    entries,
    /** All of the search's entries, loaded or not. */
    total,
    isLoading: !local && remote.status === "LoadingFirstPage",
    hasOlder: !local && remote.status === "CanLoadMore",
    loadOlder: () => remote.status === "CanLoadMore" && remote.loadMore(HISTORY_PAGE),
    /**
     * The entry `stepsBack` steps before the newest, read from the server now if `entries`
     * doesn't reach it yet; `entries` then reads on toward it. Undefined if there's none.
     */
    readAt: async (stepsBack: number): Promise<Entry<K> | undefined> => {
      if (local) return local[local.length - 1 - stepsBack];
      if (!search || !userId) return undefined;
      if (remote.status === "CanLoadMore") remote.loadMore(HISTORY_PAGE_MAX);
      for (let cursor: string | null = null, skipped = 0; ;) {
        const page: { page: Row[]; isDone: boolean; continueCursor: string } = await convex.query(api.research.records.searchHistory, { accountId: userId, id: search.id, kind, paginationOpts: { cursor, numItems: HISTORY_PAGE_MAX } });
        if (stepsBack - skipped < page.page.length) return toEntry(kind, page.page[stepsBack - skipped]);
        if (page.isDone) return undefined;
        skipped += page.page.length;
        cursor = page.continueCursor;
      }
    },
  };
}
