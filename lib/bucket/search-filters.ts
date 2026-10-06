import type { SearchParams } from "@/lib/search/types";
import { effectiveSort } from "@/lib/search-params";
import { buildOpenAlexWorksQuery } from "@/lib/openalex/works-query";
import type { OpenAlexWorksQuery } from "@/lib/openalex/search-params";
import type { GetSearchResultsWithFiltersOptions } from "@/lib/search-utils";

/**
 * What a chat or extraction keeps for a search: the query as typed, for its
 * name, and the exact OpenAlex request the results page made, which the
 * server runs as it is.
 */
export type BucketSearchFilters = {
  query: string;
  openAlexQuery: OpenAlexWorksQuery & { sort: string };
};

/** Null when the query is not valid; `options.onWarning` gets the reason. */
export function paramsToBucketSearchFilters(
  params: SearchParams,
  options: GetSearchResultsWithFiltersOptions,
): BucketSearchFilters | null {
  const query = buildOpenAlexWorksQuery(params, options);
  return query ? { query: params.q, openAlexQuery: { ...query, sort: effectiveSort(params) } } : null;
}
