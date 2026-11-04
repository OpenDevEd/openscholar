"use server";

import { fetchOpenAlexCount, fetchOpenAlexQueryCounts } from "@/lib/openalex/count";
import type { OpenAlexWorksQuery } from "@/lib/openalex/search-params";
import type { SearchFilters } from "@/lib/types";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import type { OpenAlexLimited } from "@/lib/openalex/limited";
import { activeSearchSource } from "@/lib/search/active-source";

/**
 * Server-side wrapper around `fetchOpenAlexCount`. Exists as a Server
 * Action so the polite-pool mailto header stays on the server and the
 * SDK's retry config isn't shipped to the client.
 */
export async function searchOpenAlexCount(
  query: string,
  filters: SearchFilters,
  /** Asks OpenAlex whatever the site's source is, for a community's source dialog. */
  onOpenAlex?: boolean,
): Promise<{ count: number } | OpenAlexLimited> {
  const source = onOpenAlex ? "openalex" : await activeSearchSource();
  return (await spendOpenAlexRequests(1, source)) ?? (await fetchOpenAlexCount(query, filters, source));
}

/** Counts of a community's approved source queries, in one call. These are what it imports from OpenAlex, so OpenAlex counts them. */
export async function countOpenAlexQueries(
  queries: OpenAlexWorksQuery[],
): Promise<(number | null)[] | OpenAlexLimited> {
  const counted = queries.slice(0, 100);
  return (await spendOpenAlexRequests(counted.length)) ?? (await fetchOpenAlexQueryCounts(counted));
}
