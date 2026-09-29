"use server";

import { fetchOpenAlexCount, fetchOpenAlexQueryCount } from "@/lib/openalex/count";
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

/** The count of a stored request, such as a library source's approved query. */
export async function countOpenAlexQuery(
  query: OpenAlexWorksQuery,
): Promise<{ count: number }> {
  return await fetchOpenAlexQueryCount(query);
}
