import { getPaths } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import { DEFAULT_SEARCH_PARAMS, parseSearchParamsFromUrl, paramsToFilters } from "@/lib/search-params";
import type { SearchParams } from "@/lib/search";
import { prepareOpenAlexSearch } from "@/lib/search-utils";
import { createSearchParameters } from "@/lib/utils";
import type { OpenAlexQuery, OpenAlexSourceEntry } from "./configuration/sources";

/** Pagination and display settings do not change which records a source imports. */
export function sameOpenAlexSourceSearch(left: SearchParams, right: SearchParams): boolean {
  const definition = (params: SearchParams) => ({
    ...params, page: 1, sort: DEFAULT_SEARCH_PARAMS.sort, rmin: 0, rmax: 5, rated: false, lang: null,
  });
  return JSON.stringify(definition(left)) === JSON.stringify(definition(right));
}

/**
 * What OpenAlex is asked for an import, with the same query expansion, dates
 * and serialization as live search. Saved as it is, so the library asks the
 * same thing on every update whatever the search code later becomes.
 */
export function buildOpenAlexSourceQuery(params: SearchParams): OpenAlexQuery | null {
  const prepared = prepareOpenAlexSearch({ query: params.q, filters: paramsToFilters(params) });
  if (prepared.finalApiQuery === null) return null;
  const request = createSearchParameters(prepared.finalApiQuery, {
    ...prepared.effectiveFilters,
    citesItemId: prepared.effectiveCitesItemId ?? prepared.effectiveFilters.citesItemId,
    relatedToItemId: prepared.effectiveRelatedToItemId ?? prepared.effectiveFilters.relatedToItemId,
  });
  const filter = Object.entries(getPaths(request.filter ?? {}))
    .map(([key, values]) => `${key}:${Array.isArray(values) ? values.join("|") : values}`)
    .join(",");
  return request.search || filter
    ? { ...(request.search ? { search: request.search } : {}), ...(filter ? { filter } : {}) }
    : null;
}

/** A source keeps the search it was made from, so reopening it restores every control. */
export function readOpenAlexSourceSearch(source: OpenAlexSourceEntry | null): SearchParams {
  if (!source) return { ...DEFAULT_SEARCH_PARAMS };
  return parseSearchParamsFromUrl(new URLSearchParams(source.settings.searchUrl.split("?")[1] ?? ""));
}

export function sourceSearchHistoryId(source: OpenAlexSourceEntry | null): string | null {
  return source?.settings.searchUrl.match(/^\/results\/([A-Za-z0-9-]+)(?:\?|$)/)?.[1] ?? null;
}
