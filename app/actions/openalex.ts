"use server";
import { createSearchParameters } from "@/lib/utils";
import type { Works } from "@sickrin/openalex-sdk/dist/src/types/work";
import type { SearchFilters } from "@/lib/types";
import type { QueryErrorDetail } from "@/lib/search/search-error";
import { OQL_FIELD, worksOql } from "@/lib/openalex/oql";
import { fetchOqlWorks } from "@/lib/openalex/oql-works";
import { fetchWorksPage } from "@/lib/openalex/works-page";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import { OpenAlexLimitedError } from "@/lib/openalex/limited";

/**
 * Result of a search action. We return a structured error instead of throwing:
 * thrown error messages are stripped by Next in production builds, so the client
 * could never see the real reason. `status` + `message` travel as plain data and
 * survive serialization. See [[SearchError]] on the client side.
 */
export type SearchActionResult =
  | { ok: true; data: Works }
  | { ok: false; status: number | null; message: string; detail?: QueryErrorDetail };

/** Counts one OpenAlex request against the caller, or the limit as the 429 the search page shows. */
async function spendOne(): Promise<{ ok: false; status: number; message: string } | null> {
  return (await spendOpenAlexRequests()) ? { ok: false, status: 429, message: new OpenAlexLimitedError().message } : null;
}

export async function getSearchResults(
  query: string,
  filters: SearchFilters,
): Promise<SearchActionResult> {
  const limited = await spendOne();
  if (limited) return limited;
  const searchParams = createSearchParameters(query, filters);
  if (filters.searchField === OQL_FIELD) {
    return fetchOqlWorks(worksOql(query, searchParams.filter ?? {}), {
      perPage: searchParams.perPage,
      sort: filters.sortBy,
    });
  }
  return fetchWorksPage(searchParams);
}
