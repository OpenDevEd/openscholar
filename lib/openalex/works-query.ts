import { paramsToFilters } from "@/lib/search-params";
import type { SearchParams } from "@/lib/search/types";
import { prepareOpenAlexSearch, type GetSearchResultsWithFiltersOptions } from "@/lib/search-utils";
import { createSearchParameters } from "@/lib/utils";
import type { OpenAlexWorksQuery } from "./search-params";
import { filterPaths, OQL_FIELD, worksOql } from "./oql";

/**
 * The exact request the results page makes for these params: the same keyword
 * expansion, country focus, review terms, dates and filters. Anything that runs
 * a search elsewhere stores this instead of rebuilding it. Null when the query
 * is not valid, where the results page shows the reason instead.
 */
export function buildOpenAlexWorksQuery(
  params: SearchParams,
  options: GetSearchResultsWithFiltersOptions,
): OpenAlexWorksQuery | null {
  const prepared = prepareOpenAlexSearch({ query: params.q, filters: paramsToFilters(params) }, options);
  if (prepared.finalApiQuery === null) return null;
  const request = createSearchParameters(prepared.finalApiQuery, {
    ...prepared.effectiveFilters,
    citesItemId: prepared.effectiveCitesItemId ?? prepared.effectiveFilters.citesItemId,
    relatedToItemId: prepared.effectiveRelatedToItemId ?? prepared.effectiveFilters.relatedToItemId,
  });
  if (params.field === OQL_FIELD) return { oql: worksOql(prepared.finalApiQuery, request.filter ?? {}) };
  const filter = Object.entries(filterPaths(request.filter ?? {}))
    .map(([key, values]) => `${key}:${values.join("|")}`)
    .join(",");
  return { ...(request.search ? { search: request.search } : {}), ...(filter ? { filter } : {}) };
}
