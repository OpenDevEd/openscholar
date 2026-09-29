"use server";

import { fetchOpenAlexCount, fetchOpenAlexQueryCounts } from "@/lib/openalex/count";
import type { OpenAlexWorksQuery } from "@/lib/openalex/search-params";
import type { SearchFilters } from "@/lib/types";

/**
 * Server-side wrapper around `fetchOpenAlexCount`. Exists as a Server
 * Action so the polite-pool mailto header stays on the server and the
 * SDK's retry config isn't shipped to the client.
 */
export async function searchOpenAlexCount(
  query: string,
  filters: SearchFilters,
): Promise<{ count: number }> {
  return await fetchOpenAlexCount(query, filters);
}

/** Counts of stored requests, such as a library's approved source queries, in one call. */
export async function countOpenAlexQueries(
  queries: OpenAlexWorksQuery[],
): Promise<(number | null)[]> {
  return await fetchOpenAlexQueryCounts(queries.slice(0, 100));
}
