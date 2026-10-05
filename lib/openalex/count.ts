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
import { OPENALEX_TIMEOUT_MS, openAlexFetch } from "./fetch";
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
  const response = await openAlexFetch(openAlexUrl("works", { filter: query.filter || undefined, search: query.search || undefined, "per-page": "1", select: "id" }), { timeoutMs: OPENALEX_TIMEOUT_MS });
  if (!response.ok) throw new Error(`OpenAlex API error: ${response.status}`);
  const body = (await response.json()) as { meta: { count: number } };
  return { count: body.meta.count };
}

/**
 * How far apart a list's counts are asked for: OpenAlex refuses searches with more than 5
 * boolean operators that arrive together. Measured on 2026-10-05, five counts of one were
 * refused 3 times in 5 at once and 1 time in 15 at 0.1 s apart, which the retry takes up.
 * Counts overlap, so each has a timeout: a list never waits on OpenAlex for longer than one.
 */
const COUNT_GAP_MS = 100;

/** Counts for several stored requests; a count that fails is null so the others still show. */
export async function fetchOpenAlexQueryCounts(
  queries: readonly OpenAlexWorksQuery[],
): Promise<(number | null)[]> {
  return Promise.all(
    queries.map(async (query, i) => {
      await new Promise((resolve) => setTimeout(resolve, i * COUNT_GAP_MS));
      try {
        return (await fetchOpenAlexQueryCount(query)).count;
      } catch (error) {
        console.warn("OpenAlex count failed:", error instanceof Error ? error.message : error);
        return null;
      }
    }),
  );
}
