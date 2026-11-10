import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { openAlexFetch, OPENALEX_TIMEOUT_MS } from "@/lib/openalex/fetch";
import { searchUrl } from "@/lib/openalex/request-url";
import { appWork } from "@/lib/openalex/work-id";
import { ourPaperPage } from "@/lib/papers/page-address";
import { PAPER_SITEMAP_YEARS, SITE_URL } from "@/lib/seo/page-metadata";

// The paper pages search engines are asked to read, one sitemap for each band of years in PAPER_SITEMAP_YEARS.
const PER_PAGE = 200;
const PAGES = 10_000 / PER_PAGE;
/** Pages asked for at once, inside the key's credits a second. */
const AT_ONCE = 10;
/** A page of the list is a credit; each is kept a day, so the sitemaps cost about 250 credits a day however often they're read. */
const DAY = 60 * 60 * 24;

type Row = { id: string; title?: string | null; ids?: { openalex?: string }; updated_date?: string | null };

async function readPage(years: string, page: number): Promise<Row[]> {
  const url = searchUrl("openscholar", "works", {
    filter: `has_abstract:true,is_retracted:false,publication_year:${years}`,
    sort: "cited_by_count:desc",
    "per-page": String(PER_PAGE),
    page: String(page),
    select: "id,ids,title,updated_date",
  });
  const response = await openAlexFetch(url, { timeoutMs: OPENALEX_TIMEOUT_MS, next: { revalidate: DAY } } as RequestInit & { timeoutMs: number });
  // Thrown, so a sitemap is never served short: a search engine asks again later.
  if (!response.ok) throw new Error(`[paper sitemap] our index answered ${response.status} for ${years}, page ${page}: ${(await response.text()).slice(0, 300)}`);
  return ((await response.json()) as { results: Row[] }).results;
}

export async function generateSitemaps() {
  return PAPER_SITEMAP_YEARS.map((_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  // Read when asked, not at build time, which has no key for our index.
  await connection();
  const years = PAPER_SITEMAP_YEARS[Number(await id)];
  if (!years) return [];
  const rows: Row[] = [];
  for (let first = 1; first <= PAGES; first += AT_ONCE) {
    const pages = await Promise.all(Array.from({ length: Math.min(AT_ONCE, PAGES - first + 1) }, (_, index) => readPage(years, first + index)));
    rows.push(...pages.flat());
  }
  return rows.flatMap((row) => {
    const path = ourPaperPage(appWork(row));
    return path ? [{ url: `${SITE_URL}${path}`, lastModified: row.updated_date ?? undefined }] : [];
  });
}
