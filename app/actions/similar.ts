"use server";
import { fetchOwnWorks } from "@/lib/openalex/read-works";
import { OPENALEX_TIMEOUT_MS, openAlexFetch } from "@/lib/openalex/fetch";
import { searchUrl } from "@/lib/openalex/request-url";
import { spendOpenAlexRequests } from "@/lib/openalex/spend-requests";
import type { OpenAlexLimited } from "@/lib/openalex/limited";

export type SimilarPaper = { id: string; title: string; year: number | null; citations: number; doi: string | null };

/** The papers closest in meaning to a paper, from our index, for focus mode. Only ours can say. */
export async function readSimilarPapers(paperId: string, count: number): Promise<SimilarPaper[] | OpenAlexLimited> {
  const limited = await spendOpenAlexRequests();
  if (limited) return limited;
  const answer = await fetchOwnWorks({ filter: { is_retracted: false } as never }, { perPage: count }, { similar_to: paperId.split("/").at(-1)! });
  if (!answer.ok) throw new Error(answer.message);
  return answer.data.results.map((work) => ({
    // Our own ID, so each row links straight to its paper's page.
    id: (work as { openscholar_id?: string }).openscholar_id ?? work.id,
    title: work.title ?? work.display_name ?? "",
    year: work.publication_year ?? null,
    citations: work.cited_by_count ?? 0,
    doi: work.doi ?? null,
  }));
}

/** These papers, closest first to the ones liked and furthest from the ones disliked. Each is named by our index's ID. */
export async function orderByCloseness(works: string[], liked: string[], disliked: string[]): Promise<string[] | OpenAlexLimited> {
  const limited = await spendOpenAlexRequests();
  if (limited) return limited;
  const url = searchUrl("openscholar", "works/closeness", { works: works.join("|"), similar_to: liked.join("|"), dissimilar_to: disliked.length ? disliked.join("|") : undefined });
  const response = await openAlexFetch(url, { timeoutMs: OPENALEX_TIMEOUT_MS });
  if (!response.ok) throw new Error(`Ordering failed (${response.status})`);
  const body = (await response.json()) as { results: Array<{ id: string }> };
  return body.results.map((work) => work.id.split("/").at(-1)!);
}
