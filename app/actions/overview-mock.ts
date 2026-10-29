"use server";

// Mock (mock/ai-overview): the breakdowns an overview reads for the search on screen, straight from
// OpenAlex. The real feature reads them through research/papers:count as the assistant does.

import { createSearchParameters } from "@/lib/utils";
import type { SearchFilters } from "@/lib/types";
import { OQL_FIELD } from "@/lib/openalex/oql";
import { openAlexFetch } from "@/lib/openalex/fetch";
import { worksUrl } from "@/lib/openalex/works-url";

export type Group = { key: string; name: string; count: number };
export type TopPaper = { id: string; title: string; year: number | null; cited: number };
export type OverviewData = {
  total: number;
  years: Group[];
  countries: Group[];
  types: Group[];
  fields: Group[];
  openAccess: number;
  topCited: TopPaper[];
  recent: TopPaper[];
};

type Body = { meta?: { count?: number }; group_by?: Array<{ key: string; key_display_name?: string; count: number }>; results?: Array<{ id: string; display_name?: string; publication_year?: number; cited_by_count?: number }> };

export async function overviewData(query: string, filters: SearchFilters): Promise<OverviewData | null> {
  // OpenAlex doesn't group a search written in OQL, as the real count action says.
  if (filters.searchField === OQL_FIELD) return null;
  const params = createSearchParameters(query, filters, { perPageOverride: 1 });
  const ask = async (extra: Record<string, string>, groupBy?: string, sort?: string): Promise<Body> => {
    const url = worksUrl({ search: params.search, filter: params.filter, groupBy, sortBy: sort ? { field: sort, order: "desc" } : undefined } as never, extra);
    const response = await openAlexFetch(url, { timeoutMs: 12_000 });
    if (!response.ok) throw new Error(`OpenAlex ${response.status}`);
    return (await response.json()) as Body;
  };
  const groups = (body: Body) => (body.group_by ?? []).map(({ key, key_display_name, count }) => ({ key: key.split("/").at(-1)!, name: key_display_name || key, count }));
  const papers = (body: Body) => (body.results ?? []).map((w) => ({ id: w.id.split("/").at(-1)!, title: w.display_name ?? "", year: w.publication_year ?? null, cited: w.cited_by_count ?? 0 }));
  const select = { select: "id,display_name,publication_year,cited_by_count", "per-page": "5" };
  const [years, countries, types, fields, oa, cited, recent] = await Promise.all([
    ask({ "per-page": "200" }, "publication_year"),
    ask({ "per-page": "200" }, "authorships.countries"),
    ask({ "per-page": "200" }, "type"),
    ask({ "per-page": "200" }, "primary_topic.field.id"),
    ask({ "per-page": "200" }, "open_access.is_oa"),
    ask(select, undefined, "cited_by_count"),
    ask(select, undefined, "publication_date"),
  ]);
  return {
    total: years.meta?.count ?? 0,
    years: groups(years).filter((g) => Number(g.key) <= new Date().getFullYear()).sort((a, b) => Number(a.key) - Number(b.key)),
    countries: groups(countries).filter((g) => g.key !== "unknown"),
    types: groups(types),
    fields: groups(fields).filter((g) => g.key !== "unknown"),
    openAccess: groups(oa).find((g) => g.key === "true")?.count ?? 0,
    topCited: papers(cited),
    recent: papers(recent),
  };
}
