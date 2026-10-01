"use client";

import { useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { QueryHistoryEntry, QuestionHistoryEntry, SearchResult } from "../types";

/** History entries read at once; a longer history reads more as it's scrolled or stepped through. */
const HISTORY_PAGE = 25;

type Kind = "query" | "question";
type Entry<K extends Kind> = K extends "query" ? QueryHistoryEntry : QuestionHistoryEntry;

/**
 * A search's earlier queries or research questions, oldest first (#354). A signed-out
 * visitor's search keeps them in this browser; an account's are read from the server,
 * newest first, a page at a time, only while `enabled`, so lists never load them.
 */
export function useSearchHistoryEntries<K extends Kind>(search: SearchResult | null | undefined, kind: K, enabled = true) {
  const { userId } = useAuth();
  const local = (kind === "query" ? search?.queryHistory : search?.questionHistory) as Entry<K>[] | undefined;
  const remote = usePaginatedQuery(
    api.research.records.searchHistory,
    search && userId && !local && enabled ? { accountId: userId, id: search.id, kind } : "skip",
    { initialNumItems: HISTORY_PAGE },
  );
  const entries = useMemo(() => {
    if (local) return local;
    return [...remote.results].reverse().map((entry) =>
      (kind === "query" ? { query: entry.text, field: entry.field, timestamp: entry.timestamp } : { question: entry.text, timestamp: entry.timestamp }) as Entry<K>,
    );
  }, [local, remote.results, kind]);
  const total = kind === "query" ? (search?.queryHistoryCount ?? 0) : (search?.questionCount ?? 0);
  return {
    entries,
    /** All of the search's entries, loaded or not. */
    total,
    isLoading: !local && remote.status === "LoadingFirstPage",
    hasOlder: !local && remote.status === "CanLoadMore",
    loadOlder: () => remote.status === "CanLoadMore" && remote.loadMore(HISTORY_PAGE),
  };
}
