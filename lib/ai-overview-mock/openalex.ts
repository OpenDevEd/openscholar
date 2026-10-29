// Mock (mock/ai-overview): what the overview's model reads about the search on screen, straight
// from OpenAlex. Server side only: it reads the OpenAlex key. The real feature reads the same
// through research/papers:count and research/papers:search, as the assistant does.

import { createSearchParameters } from "@/lib/utils";
import type { PaperResult, SearchFilters } from "@/lib/types";
import { openAlexFetch } from "@/lib/openalex/fetch";
import { worksUrl } from "@/lib/openalex/works-url";

export type Group = { key: string; name: string; count: number };
export type Paper = { id: string; title: string; year: number | null; cited: number };
/** A paper as the model reads it: the start of its abstract, so it can say what the paper found. */
export type ReadPaper = Paper & { abstract?: string };

/** The groupings the model can count by, as OpenAlex names them. */
export const GROUPINGS = {
  year: "publication_year",
  country: "authorships.countries",
  type: "type",
  field: "primary_topic.field.id",
  topic: "primary_topic.id",
  openAccess: "open_access.is_oa",
  journal: "primary_location.source.id",
  institution: "authorships.institutions.id",
  funder: "funders.id",
  language: "language",
  sdg: "sustainable_development_goals.id",
} as const;
export type Grouping = keyof typeof GROUPINGS;

const SORTS = { cited: "cited_by_count", newest: "publication_date", relevance: "relevance_score" } as const;
export type PaperSort = keyof typeof SORTS;

type Body = {
  meta?: { count?: number };
  group_by?: Array<{ key: string; key_display_name?: string; count: number }>;
  results?: Array<{ id: string; display_name?: string; publication_year?: number; cited_by_count?: number; abstract_inverted_index?: Record<string, number[]> | null; [field: string]: unknown }>;
};

/** The search's parameters, narrowed to a span of years when one is given. */
function parameters(query: string, filters: SearchFilters, years?: { from?: number; to?: number }) {
  const params = createSearchParameters(query, filters, { perPageOverride: 1 });
  const filter = { ...(params.filter ?? {}) } as Record<string, unknown>;
  if (years?.from || years?.to) filter.publication_year = `${years.from ?? ""}-${years.to ?? ""}`;
  return { search: params.search, filter };
}

async function ask(url: URL): Promise<Body> {
  const response = await openAlexFetch(url, { timeoutMs: 12_000 });
  if (!response.ok) throw new Error(`OpenAlex answered ${response.status} for ${url.pathname}${url.search.replace(/api_key=[^&]+/, "api_key=…")}`);
  return (await response.json()) as Body;
}

export async function countBy(query: string, filters: SearchFilters, by: Grouping, years?: { from?: number; to?: number }) {
  const body = await ask(worksUrl({ ...parameters(query, filters, years), groupBy: GROUPINGS[by] } as never, { "per-page": "200" }));
  let groups: Group[] = (body.group_by ?? [])
    .map(({ key, key_display_name, count }) => ({ key: key.split("/").at(-1)!, name: key_display_name || key, count }))
    .filter((g) => g.key !== "unknown");
  if (by === "year") groups = groups.sort((a, b) => Number(a.key) - Number(b.key)).slice(-30);
  else groups = groups.slice(0, 15);
  return { total: body.meta?.count ?? 0, groups };
}

const abstractOf = (index: Record<string, number[]> | null | undefined) => {
  if (!index) return undefined;
  const words: string[] = [];
  for (const [word, places] of Object.entries(index)) for (const place of places) words[place] = word;
  return words.join(" ");
};

/**
 * Up to 10 of the search's papers: for the model, what it needs to cite them; for the card, each whole OpenAlex
 * record as the results list has one, so a cited paper opens in focus mode with everything a result card shows.
 */
export async function listPapers(query: string, filters: SearchFilters, sort: PaperSort, count: number, years?: { from?: number; to?: number }): Promise<Array<{ read: ReadPaper; work: PaperResult }>> {
  const { search, filter } = parameters(query, filters, years);
  const body = await ask(
    worksUrl({ search, filter, sortBy: sort === "relevance" && !search ? undefined : { field: SORTS[sort], order: "desc" } } as never, {
      "per-page": String(Math.min(10, Math.max(1, count))),
    }),
  );
  return (body.results ?? []).map(({ abstract_inverted_index, ...work }) => {
    const abstract = abstractOf(abstract_inverted_index);
    return {
      read: { id: work.id.split("/").at(-1)!, title: work.display_name ?? "", year: work.publication_year ?? null, cited: work.cited_by_count ?? 0, abstract: abstract?.slice(0, 700) },
      work: { ...work, ...(abstract ? { abstract } : {}) } as unknown as PaperResult,
    };
  });
}
