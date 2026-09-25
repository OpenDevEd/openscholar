import { paramsToFilters } from "@/lib/search-params";
import type { SearchParams } from "@/lib/search";
import { prepareOpenAlexSearch, type GetSearchResultsWithFiltersOptions } from "@/lib/search-utils";
import { createSearchParameters } from "@/lib/utils";
import type { OpenAlexWorksQuery } from "./search-params";

/**
 * Nested filters as OpenAlex paths, `{topics: {id: "T1"}}` to `topics.id: ["T1"]`.
 * Same output as the SDK's `getPaths`, whose module also loads its HTTP client.
 */
function filterPaths(value: object, path: string[] = [], result: Record<string, unknown[]> = {}) {
  for (const [key, item] of Object.entries(value)) {
    const next = [...path, key];
    for (const entry of Array.isArray(item) ? item : [item]) {
      if (typeof entry === "object" && entry !== null) filterPaths(entry, next, result);
      else (result[next.join(".")] ??= []).push(entry);
    }
  }
  return result;
}

/**
 * The exact request the results page makes for these params: the same keyword
 * expansion, country focus, review terms, dates and filters. Anything that runs
 * a search elsewhere stores this instead of rebuilding it. Null when the query
 * is not valid, where the results page shows the reason instead.
 */
export function buildOpenAlexWorksQuery(
  params: SearchParams,
  options?: GetSearchResultsWithFiltersOptions,
): OpenAlexWorksQuery | null {
  const prepared = prepareOpenAlexSearch({ query: params.q, filters: paramsToFilters(params) }, options);
  if (prepared.finalApiQuery === null) return null;
  const request = createSearchParameters(prepared.finalApiQuery, {
    ...prepared.effectiveFilters,
    citesItemId: prepared.effectiveCitesItemId ?? prepared.effectiveFilters.citesItemId,
    relatedToItemId: prepared.effectiveRelatedToItemId ?? prepared.effectiveFilters.relatedToItemId,
  });
  const filter = Object.entries(filterPaths(request.filter ?? {}))
    .map(([key, values]) => `${key}:${values.join("|")}`)
    .join(",");
  return { ...(request.search ? { search: request.search } : {}), ...(filter ? { filter } : {}) };
}
