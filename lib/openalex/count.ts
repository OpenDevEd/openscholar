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
