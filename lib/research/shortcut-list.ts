"use client";

import { useMemo } from "react";
import { useStore } from "zustand";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { shortcutSortName } from "@/lib/query-shortcuts";
import { localKeywordExpansionStore } from "@/lib/store";
import type { BookmarkSortBy } from "@/lib/types";
import { useResearchSession } from "./reads";
import { usePagedRecords } from "./paged-records";

/** A shortcut as the Bookmarks page lists it. */
export type ListedShortcut = { name: string; expansion: string; createdAt: number };

// By name as the account orders it, so both lists read the same.
const byName = (a: ListedShortcut, b: ListedShortcut) => (shortcutSortName(a.name) < shortcutSortName(b.name) ? -1 : shortcutSortName(a.name) > shortcutSortName(b.name) ? 1 : 0);
const LOCAL_ORDER: Record<BookmarkSortBy, (a: ListedShortcut, b: ListedShortcut) => number> = {
  recent: (a, b) => b.createdAt - a.createdAt,
  oldest: (a, b) => a.createdAt - b.createdAt,
  alpha: byName,
  "alpha-desc": (a, b) => byName(b, a),
};

/** How many shortcuts the person has; undefined while the account's count loads. */
export function useShortcutCount() {
  const accountId = useResearchSession()?.accountId;
  const { data: count } = useProtectedQuery(api.research.records.countShortcuts, accountId ? { accountId } : "skip");
  const local = useStore(localKeywordExpansionStore, (state) => Object.keys(state.keywords).length);
  return accountId ? count : local;
}

/**
 * A page of query shortcuts, stepped with previous and next: from this browser signed out,
 * and from the account signed in, where only the page shown is read (#420). With `text`,
 * only shortcuts whose name or expansion contain it.
 */
export function useShortcutList({ sort, text = "", pageSize }: { sort: BookmarkSortBy; text?: string; pageSize: number }) {
  const session = useResearchSession();
  const accountId = session?.accountId;
  const match = useDebouncedValue(text.trim(), 300);
  const remote = useCursorPage(api.research.records.listedShortcuts, accountId ? { accountId, sort, text: match || undefined } : "skip", pageSize);
  const { data: count } = useProtectedQuery(api.research.records.countShortcuts, accountId ? { accountId } : "skip");
  const remoteItems = useMemo(() => remote.items.map(({ shorthand, ...shortcut }): ListedShortcut => ({ name: shorthand, ...shortcut })), [remote.items]);

  const keywords = useStore(localKeywordExpansionStore, (state) => state.keywords);
  const local = useMemo(() => {
    if (accountId) return [];
    const needle = text.trim().toLowerCase();
    return Object.entries(keywords)
      .map(([name, shortcut]): ListedShortcut => ({ name, ...shortcut }))
      .filter((shortcut) => !needle || shortcut.name.toLowerCase().includes(needle) || shortcut.expansion.toLowerCase().includes(needle))
      .sort(LOCAL_ORDER[sort]);
  }, [accountId, keywords, text, sort]);

  return usePagedRecords({
    remote: accountId ? { ...remote, items: remoteItems } : null,
    count,
    counted: !match,
    local,
    localCount: Object.keys(keywords).length,
    localKey: JSON.stringify([sort, text.trim().toLowerCase()]),
    pageSize,
  });
}
