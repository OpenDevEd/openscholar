/**
 * Pure projection from a stored `SearchResult` history entry to the
 * `SearchFilters` shape consumed by `createSearchParameters`.
 *
 * Lives in its own file (rather than alongside `fetchOpenAlexCount`)
 * because the count helper imports the OpenAlex SDK (which depends on
 * Node's `fs`) and cannot be pulled into a client bundle. This
 * mapper is client-safe — called from `useHistoryCount` to build the
 * server-action payload.
 */
import type { SearchFilters, SearchResult } from "@/lib/types";

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
