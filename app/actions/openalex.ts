"use server";
import { createSearchParameters } from "@/lib/utils";
import client from "@/lib/openalex";
import type { Works } from "@sickrin/openalex-sdk/dist/src/types/work";
import type { SearchFilters } from "@/lib/types";
import type { QueryErrorDetail } from "@/lib/search/search-error";
import { OQL_FIELD, worksOql } from "@/lib/openalex/oql";
import { fetchOqlWorks } from "@/lib/openalex/oql-works";
import { worksUrl } from "@/lib/openalex/works-url";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import { OpenAlexLimitedError } from "@/lib/openalex/limited";
import { fetchOwnWorks } from "@/lib/openalex/read-works";
import { chosenSource } from "@/lib/search/active-source";
import { asKeywords, SIMILAR_NEEDS_OWN_INDEX, type SearchSource } from "@/lib/search/source";

/**
 * Result of a search action. We return a structured error instead of throwing:
 * thrown error messages are stripped by Next in production builds, so the client
 * could never see the real reason. `status` + `message` travel as plain data and
 * survive serialization. See [[SearchError]] on the client side.
 */
export type SearchActionResult =
  | { ok: true; data: Works }
  | { ok: false; status: number | null; message: string; detail?: QueryErrorDetail };

/**
 * The OpenAlex SDK swallows the response body on failure (it throws a lossy
 * `Error("Error 400: undefined")`), so the only way to recover OpenAlex's real
 * explanation is to re-issue the same query directly and read its JSON `message`.
 * This only runs on the (rare) error path.
 */
async function probeOpenAlexError(
  searchParams: ReturnType<typeof createSearchParameters>
): Promise<{ status: number | null; message: string }> {
  try {
    const res = await fetch(worksUrl({ search: searchParams.search, filter: searchParams.filter, sortBy: searchParams.sortBy }, { per_page: "1" }));
    let message = "";
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body?.message || body?.error || "";
    } catch {
      // Non-JSON body — fall back to a status-based message below.
    }
    return {
      status: res.status,
      message: message || `Search request failed (${res.status})`,
    };
  } catch {
    // Probe itself failed (network) — return an unstructured failure.
    return { status: null, message: "Search request failed" };
  }
}

/** Counts one OpenAlex request against the caller, or the limit as the 429 the search page shows. */
async function spendOne(): Promise<{ ok: false; status: number; message: string } | null> {
  return (await spendOpenAlexRequests()) ? { ok: false, status: 429, message: new OpenAlexLimitedError().message } : null;
}

async function callOpenAlexSDK(
  query: string,
  given: SearchFilters
): Promise<SearchActionResult> {
  if (given.similarTo?.length) return { ok: false, status: 400, message: SIMILAR_NEEDS_OWN_INDEX };
  const filters = asKeywords(given);
  const limited = await spendOne();
  if (limited) return limited;
  const searchParams = createSearchParameters(query, filters);
  if (filters.searchField === OQL_FIELD) {
    return fetchOqlWorks(worksOql(query, searchParams.filter ?? {}), {
      perPage: searchParams.perPage,
      sort: filters.sortBy,
    });
  }
  try {
    const data = (await client.works(searchParams)) as Works;
    return { ok: true, data };
  } catch (error) {
    console.error("OpenAlex SDK Error:", error);
    // The probe asks OpenAlex again, so it's counted too.
    const limited = await spendOne();
    if (limited) return limited;
    const { status, message } = await probeOpenAlexError(searchParams);
    return { ok: false, status, message };
  }
}

/** The same search on our index, which the SDK can't reach. */
async function searchOwnIndex(query: string, filters: SearchFilters): Promise<SearchActionResult> {
  const limited = await spendOne();
  if (limited) return limited;
  const searchParams = createSearchParameters(query, filters);
  if (filters.searchField === OQL_FIELD) {
    return fetchOqlWorks(worksOql(query, searchParams.filter ?? {}), { perPage: searchParams.perPage, sort: filters.sortBy }, "openscholar");
  }
  return fetchOwnWorks(
    { search: searchParams.search, filter: searchParams.filter as never, ...(searchParams.semantic || searchParams.similar ? {} : { sortBy: searchParams.sortBy }) },
    { perPage: searchParams.perPage },
    { "search.semantic": searchParams.semantic, similar_to: searchParams.similar },
  );
}

export async function getSearchResults(
  query: string,
  filters: SearchFilters,
  source?: SearchSource,
): Promise<SearchActionResult> {
  if ((await chosenSource(source)) === "openscholar") return searchOwnIndex(query, filters);
  return callOpenAlexSDK(query, filters);
}
