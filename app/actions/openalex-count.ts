"use server";

import { fetchOpenAlexCount } from "@/lib/openalex/count";
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
