"use server";
import { z } from "zod";
import { createSearchParameters } from "@/lib/utils";
import type { Works } from "@sickrin/openalex-sdk/dist/src/types/work";
import type { SearchFilters } from "@/lib/types";
import type { QueryErrorDetail } from "@/lib/search/search-error";
import { OQL_FIELD, worksOql } from "@/lib/openalex/oql";
import { fetchOqlWorks } from "@/lib/openalex/oql-works";
import { fetchWorksPage } from "@/lib/openalex/works-page";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import { OpenAlexLimitedError } from "@/lib/openalex/limited";
import { fetchClosenessOrder, type ClosenessResult } from "@/lib/openalex/closeness";
import { worksAskOpenAlex } from "@/lib/openalex/request-url";

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

/**
 * The works nearest a paper by meaning, closest first, as many as `perPage`: the OpenScholar API's
 * similar_to, without retracted works, as the results page lists them. Counted as one request.
 */
export async function getSimilarWorks(paperId: string, perPage: number): Promise<SearchActionResult> {
  const limited = await spendOne();
  if (limited) return limited;
  return fetchWorksPage({ perPage, similar: paperId, filter: { is_retracted: false }, AbstractArrayToString: true });
}

/** What a page may ask to order: the results it loads, and up to 100 papers of each kind, by their ids. */
const closenessAsked = z.object({
  works: z.array(z.string().max(200)).min(1).max(200),
  similarTo: z.array(z.string().max(200)).min(1).max(100),
  dissimilarTo: z.array(z.string().max(200)).max(100),
});

/**
 * The works shown, ordered by closeness by meaning to the papers rated as like what is sought, and
 * away from those rated as not (the OpenScholar API's GET /works/closeness). Counted as one request;
 * refused, uncounted, beyond what the API takes.
 */
export async function getClosenessOrder(works: string[], similarTo: string[], dissimilarTo: string[]): Promise<ClosenessResult> {
  const asked = closenessAsked.safeParse({ works, similarTo, dissimilarTo });
  if (!asked.success) return { ok: false, status: 400, message: "Order 1 to 200 works by 1 to 100 papers alike and up to 100 unlike" };
  // OpenAlex has no such order: nothing to spend a request on.
  if (worksAskOpenAlex()) return { ok: false, status: null, message: "Ordering by closeness needs the OpenScholar API" };
  const limited = await spendOne();
  if (limited) return limited;
  return fetchClosenessOrder(asked.data.works, asked.data.similarTo, asked.data.dissimilarTo);
}
