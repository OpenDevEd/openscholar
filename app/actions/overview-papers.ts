"use server";
import { z } from "zod";
import { readOpenAlexWorks } from "@/lib/openalex/read-works";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import { activeSearchSource } from "@/lib/search/active-source";
import { isOwnId } from "@/lib/search/source";
import type { PaperResult } from "@/lib/types";
import { PAPERS_KEPT, LISTS_KEPT } from "@/convex/research/overviewValidators";

/**
 * The whole OpenAlex records of the papers an AI overview cites (#967), by their IDs, in that order, for focus mode
 * to open with everything a result card shows. One request, counted against the person's OpenAlex allowance.
 */
export async function readCitedPapers(ids: string[]) {
  const valid = z.array(z.string().regex(/^(?:W|OS)\d+$/)).min(1).max(PAPERS_KEPT * LISTS_KEPT).parse(ids);
  const source = valid.some(isOwnId) ? "openscholar" : await activeSearchSource();
  const limited = await spendOpenAlexRequests(1, source);
  if (limited) return limited;
  const { results } = await readOpenAlexWorks({ filter: { openalex: valid.join("|") }, perPage: valid.length, cursor: "*" } as never, source);
  const byId = new Map(results.map((work) => [work.id.split("/").at(-1)!, work as unknown as PaperResult]));
  return valid.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}
