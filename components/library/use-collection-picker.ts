"use client";

import { useState, type UIEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedPaginatedQuery } from "@/lib/auth/use-auth-query";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";

/** Collections a picker reads at a time. */
const PICKER_PAGE_SIZE = 20;
/** How close to the bottom of the list, in pixels, the next page starts loading. */
const LOAD_AHEAD_PX = 80;

/**
 * A collection picker's list: searched by name on the server and read a page at a time
 * as the list scrolls. Given a paper, each collection says whether the paper is in it.
 */
export function useCollectionPicker({ enabled = true, libraryItemId }: { enabled?: boolean; libraryItemId?: Id<"libraryItems"> } = {}) {
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 300);
  const list = useProtectedPaginatedQuery(
    api.library.collections.listCollections,
    enabled ? { search: search || undefined, libraryItemId } : "skip",
    { initialNumItems: PICKER_PAGE_SIZE },
  );
  const onScroll = (event: UIEvent<HTMLElement>) => {
    const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
    if (list.status === "CanLoadMore" && scrollHeight - scrollTop - clientHeight < LOAD_AHEAD_PX) list.loadMore(PICKER_PAGE_SIZE);
  };
  return {
    query,
    setQuery,
    /** The search the list shows, once typing settles. */
    search,
    collections: list.results,
    isLoading: list.isInitialLoading,
    onScroll,
  };
}
