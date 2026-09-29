/**
 * Fresh OpenAlex `meta.count` for a stored history entry.
 *
 * The cache key is `["openalex-count", <filter-hash>]` — two distinct
 * history entries whose filters canonicalise to the same shape land on
 * the same SWR cache slot, so toggling either row costs at most one
 * round-trip per 60s window.
 *
 *  - `dedupingInterval: 60_000`  — bumped from the search provider's
 *    5 s because count refreshes are opt-in (the user clicks into a
 *    chip popover); we don't want rapid toggling to hammer the API.
 *  - `revalidateOnFocus/Reconnect/IfStale: false` — counts don't
 *    update themselves; user-driven refresh only.
 *  - `keepPreviousData: true`     — stepper renders the cached number
 *    while a fresh fetch is in flight; P7 §5h failure matrix.
 */
"use client";

import useSWR from "swr";
import { hashSearchFilters } from "@/lib/openalex/filter-hash";
import { countOpenAlexQuery, searchOpenAlexCount } from "@/app/actions/openalex-count";
import type { OpenAlexWorksQuery } from "@/lib/openalex/search-params";
import { toSearchFilters } from "@/lib/openalex/to-search-filters";
import type { SearchResult } from "@/lib/types";

const COUNT_OPTIONS = {
  revalidateIfStale: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 60_000,
  keepPreviousData: true,
  errorRetryCount: 2,
  errorRetryInterval: 1000,
};

type UseHistoryCountResult = {
  count: number | undefined;
  isLoading: boolean;
  error: Error | undefined;
  refresh: () => Promise<number | undefined>;
};

export function useHistoryCount(
  entry: SearchResult | null,
): UseHistoryCountResult {
  const key = entry
    ? (["openalex-count", hashSearchFilters(entry)] as const)
    : null;

  const { data, error, isLoading, mutate } = useSWR<number>(
    key,
    async () => {
      if (!entry) throw new Error("useHistoryCount: missing entry");
      const { count } = await searchOpenAlexCount(
        entry.query,
        toSearchFilters(entry),
      );
      return count;
    },
    COUNT_OPTIONS,
  );

  return {
    count: data,
    isLoading,
    error: error as Error | undefined,
    refresh: () => mutate(),
  };
}

/** How many works a stored request finds, such as a library source's approved query; cached like the history counts. */
export function useOpenAlexQueryCount(query: OpenAlexWorksQuery): number | undefined {
  const { data } = useSWR<number>(
    ["openalex-query-count", query.oql ?? "", query.filter ?? "", query.search ?? ""],
    async () => (await countOpenAlexQuery(query)).count,
    // An edited query never shows the count of the one before it, and a failed count shows none.
    // A cached count refreshes on the next visit, at most once a minute per query.
    { ...COUNT_OPTIONS, keepPreviousData: false, revalidateIfStale: true },
  );
  return data;
}
