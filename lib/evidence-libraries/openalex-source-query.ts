import { DEFAULT_SEARCH_PARAMS, parseSearchParamsFromUrl } from "@/lib/search-params";
import { serializeSearchParams } from "@/lib/search-params/parsers";
import type { SearchParams } from "@/lib/search";
import { buildOpenAlexWorksQuery } from "@/lib/openalex/works-query";
import type { OpenAlexQuery, OpenAlexSourceEntry } from "./configuration/sources";

/** Pagination and display settings do not change which records a source imports. */
export function sameOpenAlexSourceSearch(left: SearchParams, right: SearchParams): boolean {
  const definition = (params: SearchParams) => ({
    ...params, page: 1, sort: DEFAULT_SEARCH_PARAMS.sort, rmin: 0, rmax: 5, rated: false, lang: null,
  });
  return JSON.stringify(definition(left)) === JSON.stringify(definition(right));
}

/**
 * Leaving out retracted works narrows nothing, however the clause is grouped
 * or spelled. new-el's source schema applies the same rule.
 */
function narrowsOql(oql: string | undefined): boolean {
  const where = oql?.match(/^works\s+where\s+([\s\S]+)$/i)?.[1];
  return Boolean(
    where
      ?.toLowerCase()
      .replace(/[()\s]+/g, " ")
      .split(/\band\b/)
      .map((clause) => clause.trim())
      .some((clause) => clause && !/^(is_)?retracted is false$/.test(clause)),
  );
}

/**
 * What OpenAlex is asked for an import. Saved as it is, so the library asks the
 * same thing on every update whatever the search code later becomes.
 */
export function buildOpenAlexSourceQuery(params: SearchParams): OpenAlexQuery | null {
  // Leaving out retracted works is on by default and narrows nothing on its own,
  // so a search must still have its own query or filter to be imported.
  const narrowing = buildOpenAlexWorksQuery({ ...params, retracted: true });
  if (!narrowing?.search && !narrowing?.filter && !narrowsOql(narrowing?.oql)) return null;
  return buildOpenAlexWorksQuery(params);
}

/**
 * The search a source reopens with. It is saved in the configuration, not used
 * as a browser address, so an OQL query stays in it.
 */
export function openAlexSourceSearchUrl(searchId: string, params: SearchParams): string {
  return serializeSearchParams(`/results/${searchId}`, params);
}

/** A source keeps the search it was made from, so reopening it restores every control. */
export function readOpenAlexSourceSearch(source: OpenAlexSourceEntry | null): SearchParams {
  if (!source) return { ...DEFAULT_SEARCH_PARAMS };
  return parseSearchParamsFromUrl(new URLSearchParams(source.settings.searchUrl.split("?")[1] ?? ""));
}

export function sourceSearchHistoryId(source: OpenAlexSourceEntry | null): string | null {
  return source?.settings.searchUrl.match(/^\/results\/([A-Za-z0-9-]+)(?:\?|$)/)?.[1] ?? null;
}
