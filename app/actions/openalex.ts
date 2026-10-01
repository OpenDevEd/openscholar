"use server";
import { createSearchParameters } from "@/lib/utils";
import client from "@/lib/openalex";
import type { Work, Works } from "@sickrin/openalex-sdk/dist/src/types/work";
import { readOpenAlexWorks } from "@/lib/openalex/read-works";
import type { SearchFilters } from "@/lib/types";
import type { QueryErrorDetail } from "@/lib/search/search-error";
import { OQL_FIELD, worksOql } from "@/lib/openalex/oql";
import { fetchOqlWorks } from "@/lib/openalex/oql-works";
import { worksUrl } from "@/lib/openalex/works-url";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import { OpenAlexLimitedError } from "@/lib/openalex/limited";

/** OpenAlex's largest page. */
const SEARCH_PAGE_SIZE = 200;

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
  filters: SearchFilters
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
  try {
    const data = (await client.works(searchParams)) as Works;
    return { ok: true, data };
  } catch (error) {
    console.error("OpenAlex SDK Error:", error);
    const { status, message } = await probeOpenAlexError(searchParams);
    return { ok: false, status, message };
  }
}

export async function getSearchResults(
  query: string,
  filters: SearchFilters,
): Promise<SearchActionResult> {
  return callOpenAlexSDK(query, filters);
}

export type SearchPageResult =
  | { ok: true; works: Work[]; nextCursor: string | null }
  | { ok: false; status: number | null; message: string };

/**
 * One page of a search's works, read on the server with OpenScholar's key.
 * Screen All pages through a search with the returned cursor; from the
 * browser it would have no key and share 1,000 daily credits.
 */
export async function readSearchPage(
  query: string,
  filters: SearchFilters,
  cursor: string,
): Promise<SearchPageResult> {
  const limited = await spendOne();
  if (limited) return limited;
  const params = createSearchParameters(query, filters, { perPageOverride: SEARCH_PAGE_SIZE });
  if (filters.searchField === OQL_FIELD) {
    const result = await fetchOqlWorks(worksOql(query, params.filter ?? {}), {
      perPage: SEARCH_PAGE_SIZE,
      sort: filters.sortBy,
      cursor,
    });
    return result.ok
      ? { ok: true, works: result.data.results, nextCursor: result.data.meta.next_cursor || null }
      : { ok: false, status: result.status, message: result.message };
  }
  try {
    const page = await readOpenAlexWorks({ ...params, cursor });
    return { ok: true, works: page.results, nextCursor: page.meta.next_cursor };
  } catch (error) {
    console.error("OpenAlex search page failed:", error);
    return { ok: false, status: null, message: error instanceof Error ? error.message : "Search request failed" };
  }
}
