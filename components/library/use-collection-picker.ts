"use client";

import { useState, type UIEvent } from "react";
import { api } from "@/convex/_generated/api";
import { useProtectedPaginatedQuery, useProtectedStreamPaginatedQuery } from "@/lib/auth/use-auth-query";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";

/** Collections a picker reads at a time. */
const PICKER_PAGE_SIZE = 20;
/** How close to the bottom of the list, in pixels, the next page starts loading. */
const LOAD_AHEAD_PX = 80;

/**
 * A collection picker's list: searched by name on the server and read a page at a time
 * as the list scrolls. Given a paper's OpenAlex ID, each collection says whether the paper is in it.
 * `shared` holds the collections other workspaces shared with the person to edit (#653), which
 * come after their own: there are none in an organization.
 */
export function useCollectionPicker({ enabled = true, openalexId }: { enabled?: boolean; openalexId?: string } = {}) {
  const workspaceId = useWorkspace();
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 300);
  const args = inWorkspace(workspaceId, enabled ? { search: search || undefined, openalexId } : "skip");
  const list = useProtectedPaginatedQuery(api.library.collections.listCollections, args, { initialNumItems: PICKER_PAGE_SIZE });
  // Paged with a stream on the server, whose pages hold their place only under this hook.
  const shared = useProtectedStreamPaginatedQuery(api.sharing.shared.editableCollections, args, { initialNumItems: PICKER_PAGE_SIZE });
  const onScroll = (event: UIEvent<HTMLElement>) => {
    const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight >= LOAD_AHEAD_PX) return;
    // The person's own first, then the shared ones under them.
    const next = [list, shared].find((one) => one.status !== "Exhausted");
    if (next?.status === "CanLoadMore") next.loadMore(PICKER_PAGE_SIZE);
  };
  return {
    query,
    setQuery,
    /** The search the list shows, once typing settles. */
    search,
    collections: list.results,
    shared: shared.results,
    // Both lists come together, so the shared ones don't arrive under a list already shown.
    isLoading: list.isInitialLoading || shared.isInitialLoading,
    onScroll,
  };
}
