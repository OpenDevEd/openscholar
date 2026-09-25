import { getPaths } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import { DEFAULT_SEARCH_PARAMS, parseSearchParamsFromUrl, paramsToFilters } from "@/lib/search-params";
import type { ImportQuery } from "@/components/evidence-libraries/configuration/sections/openalex-import-model";
import { buildOpenAlexImportRequest, EMPTY_IMPORT_EXTRAS } from "./openalex-import-request";
import type { OpenAlexQuery, OpenAlexSourceEntry } from "./configuration/sources";

/** Pagination and display settings do not change which records a source imports. */
export function sameOpenAlexSourceSearch(left: ImportQuery, right: ImportQuery): boolean {
  const definition = ({ params, extras }: ImportQuery) => ({
    params: { ...params, page: 1, sort: DEFAULT_SEARCH_PARAMS.sort, rmin: 0, rmax: 5, rated: false, lang: null },
    extras,
  });
  return JSON.stringify(definition(left)) === JSON.stringify(definition(right));
}

/** Use the same query expansion, dates and provider serialization as live search. */
export function buildOpenAlexSourceQuery(query: ImportQuery): OpenAlexQuery | null {
  const request = buildOpenAlexImportRequest(query.params.q, paramsToFilters(query.params), query.extras);
  if (!request) return null;
  const filter = Object.entries(getPaths(request.filter))
    .map(([key, values]) => `${key}:${Array.isArray(values) ? values.join("|") : values}`)
    .join(",");
  return request.search || filter ? {
    ...(request.search ? { search: request.search } : {}),
    ...(filter ? { filter } : {}),
  } : null;
}

/** A quoted search phrase can contain commas and colons without starting a filter. */
function filterClauses(filter: string): string[] {
  const clauses: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < filter.length; index++) {
    if (filter[index] === "\\") { index++; continue; }
    if (filter[index] === '\"') quoted = !quoted;
    if (!quoted && filter[index] === "," && /^[a-z_][a-z_.]*:/.test(filter.slice(index + 1))) {
      clauses.push(filter.slice(start, index));
      start = index + 1;
    }
  }
  clauses.push(filter.slice(start));
  return clauses;
}

/** Provider-only sources can still be opened without discarding their filters. */
export function parseOpenAlexSourceQuery(query: OpenAlexQuery): ImportQuery {
  const result: ImportQuery = {
    params: { ...DEFAULT_SEARCH_PARAMS },
    extras: { ...EMPTY_IMPORT_EXTRAS, additionalFilters: {} },
  };
  if (query.search) {
    result.params.q = query.search;
    result.params.field = "all";
  }
  for (const clause of filterClauses(query.filter ?? "")) {
    const separator = clause.indexOf(":");
    if (separator < 1) continue;
    const key = clause.slice(0, separator);
    const value = clause.slice(separator + 1);
    const scoped = key.match(/^(title_and_abstract|title|abstract|fulltext|display_name)\.search(?:\.exact)?$/);
    if (scoped) {
      result.params.field = scoped[1];
      result.params.q = value;
    } else if (key === "publication_year" && /^\d{4}-\d{4}$/.test(value)) {
      [result.params.yf, result.params.yt] = value.split("-").map(Number);
    } else if (key === "from_publication_date" || key === "to_publication_date") {
      result.params.ft = "date";
      result.params[key === "from_publication_date" ? "df" : "dt"] = value;
    } else if (key === "authorships.countries") {
      result.params.reg = value.split("|");
    } else if (key === "cites" || key === "cited_by" || key === "related_to") {
      result.params[key === "cited_by" ? "citedBy" : key === "related_to" ? "rel" : "cites"] = value;
    } else if (/^topics(?:\.(domain|field|subfield))?\.id$/.test(key)) {
      const level = key.split(".").length === 3 ? key.split(".")[1] : null;
      result.extras.topicIds = [...result.extras.topicIds, ...value.split("|").map(id => {
        const bare = id.split("/").at(-1)!;
        return level ? `${level}s/${bare}` : bare;
      })];
    } else if (key === "sustainable_development_goals.id") {
      result.extras.sdgs = value.split("|").map(id => id.replace("https://metadata.un.org/sdg/", ""));
    } else if (key === "open_access.is_oa" && value === "true") {
      result.extras.openAccessOnly = true;
    } else {
      result.extras.additionalFilters![key] = value;
    }
  }
  return result;
}

/** Keep the original controls; an expanded provider query cannot recover country focus. */
export function readOpenAlexSourceSearch(source: OpenAlexSourceEntry | null): ImportQuery {
  if (!source) return { params: { ...DEFAULT_SEARCH_PARAMS }, extras: { ...EMPTY_IMPORT_EXTRAS } };
  const query = parseOpenAlexSourceQuery(source.settings.approvedQuery.query);
  if (source.settings.searchUrl) {
    query.params = parseSearchParamsFromUrl(new URLSearchParams(source.settings.searchUrl.split("?")[1] ?? ""));
  }
  return query;
}

export function sourceSearchHistoryId(source: OpenAlexSourceEntry | null): string | null {
  return source?.settings.searchUrl?.match(/^\/results\/([A-Za-z0-9-]+)(?:\?|$)/)?.[1] ?? null;
}
