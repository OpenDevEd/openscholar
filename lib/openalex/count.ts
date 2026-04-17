/**
 * Count-only OpenAlex helper.
 *
 * When the UI needs "how many papers match this filter?" without caring
 * about the actual works, this path sends `per-page=1` and reads back
 * just `meta.count`. The payload is ~200x smaller than a regular search
 * and the SDK response time drops accordingly.
 *
 * Shares `createSearchParameters` with the main search path — the only
 * difference is the `perPageOverride: 1` hint. No other branching, no
 * duplicated filter-assembly logic.
 */
import client from "@/lib/openalex";
import { createSearchParameters } from "@/lib/utils";
import type { SearchFilters, SearchResult } from "@/lib/types";

export async function fetchOpenAlexCount(
  query: string,
  filters: SearchFilters,
): Promise<{ count: number }> {
  const params = createSearchParameters(query, filters, {
    perPageOverride: 1,
  });
  try {
    const response = await client.works(params);
    return { count: response.meta.count };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(`OpenAlex API error: ${message}`);
  }
}

/**
 * Projects a stored `SearchResult` history entry down to the
 * `SearchFilters` shape consumed by `createSearchParameters`. Fields
 * that don't feed the OpenAlex request (id, timestamps, count,
 * screening state, queryHistory) are dropped.
 */
export function toSearchFilters(entry: SearchResult): SearchFilters {
  return {
    searchField: entry.field,
    sortBy: entry.sortBy ?? "relevance_score:desc",
    filterType: entry.filterType ?? "year",
    yearRange: entry.yearRange,
    isYearRangeEnabled: entry.isYearRangeEnabled,
    dateRange: entry.dateRange,
    ratingRange: entry.ratingRange,
    onlyRatedPapers: entry.onlyRatedPapers,
    selectedRegions: entry.selectedRegions ?? [],
    selectedCountryFocus: entry.selectedCountryFocus ?? [],
    citesItemId: entry.citesItemId ?? "",
    citedByItemId: entry.citedByItemId ?? "",
    relatedToItemId: entry.relatedToItemId ?? "",
    reviewFilter: entry.reviewFilter ?? false,
  };
}
