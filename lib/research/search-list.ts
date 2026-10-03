"use client";

import { useMemo, useState } from "react";
import { useStore } from "zustand";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { localSearchHistoryStore } from "@/lib/store";
import type { SearchResult } from "@/lib/types";
import type { ListedSort } from "./records";
import { restoreSearch } from "./records";
import { useResearchSession } from "./provider";

/** One search in this browser matching the history page's search text: its query or a question asked of it. */
function matchesLocally(item: SearchResult, text: string) {
  return (
    item.query?.toLowerCase().includes(text) ||
    (item.questionHistory
      ? item.questionHistory.some((entry) => entry.question.toLowerCase().includes(text))
      : item.questionText.toLowerCase().includes(text))
  );
}

const byTime = (item: SearchResult) => new Date(item.createdAt).getTime();
const LOCAL_ORDER: Record<ListedSort, (a: SearchResult, b: SearchResult) => number> = {
  recent: (a, b) => byTime(b) - byTime(a),
  oldest: (a, b) => byTime(a) - byTime(b),
  most: (a, b) => (b.count || 0) - (a.count || 0),
  least: (a, b) => (a.count || 0) - (b.count || 0),
};

/**
 * A page of saved searches, stepped with previous and next: from this browser signed out,
 * and from the account signed in, where only the page shown is read (#420). With `text`,
 * only searches whose query or questions contain it; the account's matches aren't counted,
 * so `total` and `pageCount` are undefined. `count` is every search the person has, whatever
 * the text. The account's searches come without screening answers.
 */
export function useSearchList({ sort, text = "", pageSize, excludeId }: { sort: ListedSort; text?: string; pageSize: number; excludeId?: string }) {
  const session = useResearchSession();
  const accountId = session?.accountId;
  const match = useDebouncedValue(text.trim(), 300);
  const remote = useCursorPage(api.research.records.listedSearches, accountId ? { accountId, sort, text: match || undefined, exclude: excludeId } : "skip", pageSize);
  const { data: count } = useProtectedQuery(api.research.records.countSearches, accountId ? { accountId } : "skip");

  const localHistory = useStore(localSearchHistoryStore, (state) => state.searchHistory);
  const localKey = JSON.stringify([sort, text.trim().toLowerCase(), excludeId]);
  const [localPage, setLocalPage] = useState({ key: localKey, page: 1 });
  const local = useMemo(() => {
    if (accountId) return [];
    const needle = text.trim().toLowerCase();
    return localHistory.filter((item) => item.id !== excludeId && (!needle || matchesLocally(item, needle))).sort(LOCAL_ORDER[sort]);
  }, [accountId, localHistory, text, excludeId, sort]);
  const remoteItems = useMemo(() => remote.items.map((item) => restoreSearch({ ...item, screeningResponses: [] })), [remote.items]);

  if (accountId) {
    const all = count === undefined ? undefined : Math.max(0, count - (excludeId ? 1 : 0));
    // A page still catching up with a deletion can hold more than the count says; the total never reads below it.
    const total = match || all === undefined ? undefined : Math.max(all, remote.offset + remoteItems.length);
    return {
      items: remoteItems,
      count: all,
      total,
      page: remote.page,
      pageCount: total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize)),
      offset: remote.offset,
      canPrevious: remote.canPrevious,
      canNext: remote.canNext,
      hasPages: remote.hasPages,
      isLoading: remote.isLoading,
      isStale: remote.isStale,
      previous: remote.previous,
      next: remote.next,
    };
  }

  const pageCount = Math.max(1, Math.ceil(local.length / pageSize));
  const page = Math.min(localPage.key === localKey ? localPage.page : 1, pageCount);
  const offset = (page - 1) * pageSize;
  return {
    items: local.slice(offset, offset + pageSize),
    count: localHistory.length - (excludeId && localHistory.some((item) => item.id === excludeId) ? 1 : 0),
    total: local.length,
    page,
    pageCount,
    offset,
    canPrevious: page > 1,
    canNext: page < pageCount,
    hasPages: pageCount > 1,
    isLoading: false,
    isStale: false,
    previous: () => setLocalPage({ key: localKey, page: Math.max(1, page - 1) }),
    next: () => setLocalPage({ key: localKey, page: Math.min(pageCount, page + 1) }),
  };
}
