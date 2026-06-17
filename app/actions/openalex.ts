"use server";
import { createSearchParameters } from "@/lib/utils";
import client from "@/lib/openalex";
import { buildUrl } from "@sickrin/openalex-sdk/dist/src/utils/helpers";
import type { Works } from "@sickrin/openalex-sdk/dist/src/types/work";
import type { SearchFilters } from "@/lib/types";

const OPENALEX_BASE_URL = "https://api.openalex.org";

/**
 * Result of a search action. We return a structured error instead of throwing:
 * thrown error messages are stripped by Next in production builds, so the client
 * could never see the real reason. `status` + `message` travel as plain data and
 * survive serialization. See [[SearchError]] on the client side.
 */
export type SearchActionResult =
  | { ok: true; data: Works }
  | { ok: false; status: number | null; message: string };

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
    const base = buildUrl(
      OPENALEX_BASE_URL,
      "works",
      searchParams.search,
      undefined,
      searchParams.filter,
      undefined,
      searchParams.sortBy
    );
    const mailto = process.env.OPENALEX_CONTACT_EMAIL;
    const url = `${base}&per_page=1${mailto ? `&mailto=${encodeURIComponent(mailto)}` : ""}`;

    const res = await fetch(url);
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

async function callOpenAlexSDK(
  query: string,
  filters: SearchFilters
): Promise<SearchActionResult> {
  const searchParams = createSearchParameters(query, filters);
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
  expandedQuery?: string,
  effectiveCitesItemId?: string,
  effectiveRelatedToItemId?: string
): Promise<SearchActionResult> {
  const actualQuery = expandedQuery || query;

  const effectiveFilters: SearchFilters = {
    ...filters,
    citesItemId: effectiveCitesItemId || filters.citesItemId,
    relatedToItemId: effectiveRelatedToItemId || filters.relatedToItemId,
  };

  return callOpenAlexSDK(actualQuery, effectiveFilters);
}
