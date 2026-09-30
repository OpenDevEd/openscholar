/**
 * Count-only OpenAlex helper — SERVER SIDE ONLY.
 *
 * Imports the OpenAlex SDK, which itself imports Node's `fs`. Pulling
 * this module into the client bundle will break the Turbopack build
 * (`Module not found: Can't resolve 'fs'`). Every consumer must be
 * a `"use server"` action or an internal action.
 *
 * When the UI needs "how many papers match this filter?" without caring
 * about the actual works, this path sends `per-page=1` and reads back
 * just `meta.count`. The payload is ~200x smaller than a regular search
 * and the SDK response time drops accordingly.
 *
 * Shares `createSearchParameters` with the main search path — the only
 * difference is the `perPageOverride: 1` hint. The client-safe
 * SearchResult → SearchFilters projection lives in `./to-search-filters`.
 */
import client from "@/lib/openalex";
import { createSearchParameters } from "@/lib/utils";
import type { SearchFilters } from "@/lib/types";
import { OQL_FIELD, worksOql } from "./oql";
import { fetchOqlWorks } from "./oql-works";
import { openAlexUrl } from "./request-url";
import type { OpenAlexWorksQuery } from "./search-params";

export async function fetchOpenAlexCount(
  query: string,
  filters: SearchFilters,
): Promise<{ count: number }> {
  const params = createSearchParameters(query, filters, {
    perPageOverride: 1,
  });
  if (filters.searchField === OQL_FIELD) {
    const result = await fetchOqlWorks(worksOql(query, params.filter ?? {}), { perPage: 1 });
    if (!result.ok) throw new Error(`OpenAlex API error: ${result.message}`);
    return { count: result.data.meta.count };
  }
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
 * How many works a stored OpenAlex request finds, asked exactly as stored,
 * as a library source imports it.
 */
async function fetchOpenAlexQueryCount(
  query: OpenAlexWorksQuery,
): Promise<{ count: number }> {
  if (query.oql) {
    const result = await fetchOqlWorks(query.oql, { perPage: 1 });
    if (!result.ok) throw new Error(`OpenAlex API error: ${result.message}`);
    return { count: result.data.meta.count };
  }
  const response = await fetch(openAlexUrl("works", { filter: query.filter || undefined, search: query.search || undefined, "per-page": "1", select: "id" }));
  if (!response.ok) throw new Error(`OpenAlex API error: ${response.status}`);
  const body = (await response.json()) as { meta: { count: number } };
  return { count: body.meta.count };
}

/** OpenAlex requests one list of counts makes at once. */
const COUNT_BATCH = 5;

/** Counts for several stored requests; a count that fails is null so the others still show. */
export async function fetchOpenAlexQueryCounts(
  queries: readonly OpenAlexWorksQuery[],
): Promise<(number | null)[]> {
  const counts: (number | null)[] = [];
  for (let start = 0; start < queries.length; start += COUNT_BATCH) {
    const batch = await Promise.all(
      queries.slice(start, start + COUNT_BATCH).map(async (query) => {
        try {
          return (await fetchOpenAlexQueryCount(query)).count;
        } catch (error) {
          console.warn("OpenAlex count failed:", error instanceof Error ? error.message : error);
          return null;
        }
      }),
    );
    counts.push(...batch);
  }
  return counts;
}
