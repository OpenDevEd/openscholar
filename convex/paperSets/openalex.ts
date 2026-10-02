/**
 * Reading a search's works from OpenAlex on the server (#341), for Screen all and extraction:
 * only the fields the job keeps, in the results page's order, a range at a time. Each page
 * read counts against the acting person's OpenAlex allowance (#415).
 */
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { openAlexUrl } from "../../lib/openalex/request-url";
import { OpenAlexLimitedError } from "../../lib/openalex/limited";

/** OpenAlex's largest page. */
const PAGE_SIZE = 200;
/** How long one page may take before the request fails, as the results page's reads do. */
const PAGE_TIMEOUT_MS = 12_000;
/**
 * The sort under which numbered pages list works in the results page's (cursor) order.
 * Measured on 2026-10-02 for "climate adaptation": the first 1,000 works matched in every
 * position by relevance, but only 655 by citations and 724 by date, because OpenAlex breaks
 * ties differently on the two paths and can't sort by `id`. Other sorts read cursor pages.
 */
const PAGE_ORDERED_SORT = "relevance_score:desc";

/** A search's request as the results page makes it (lib/openalex/works-query.ts), with its sort. */
export const searchRequestValidator = v.object({
  search: v.optional(v.string()),
  filter: v.optional(v.string()),
  oql: v.optional(v.string()),
  sort: v.string(),
});
export type SearchRequest = Infer<typeof searchRequestValidator>;

type Page = { page: number } | { cursor: string };

/** One page of the search, by number or cursor. An OQL search goes in a POST body: it outgrows the URL limit. */
async function readPage<Work>(request: SearchRequest, at: Page, select: string): Promise<{ works: Work[]; nextCursor: string | null }> {
  const parameters = {
    "per-page": String(PAGE_SIZE),
    ...("page" in at ? { page: String(at.page) } : { cursor: at.cursor }),
    sort: request.sort,
    select,
  };
  const url = request.oql
    ? openAlexUrl("", parameters)
    : openAlexUrl("works", { ...parameters, search: request.search, filter: request.filter });
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      ...(request.oql ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oql: request.oql }) } : {}),
    });
  } catch (error) {
    console.error(`[paperSets] OpenAlex page ${JSON.stringify(at)} didn't answer`, error);
    throw createError("VALIDATION_ERROR", "OpenAlex didn't return these papers in time. Try again in a moment.");
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    console.error(`[paperSets] OpenAlex page ${JSON.stringify(at)} failed: ${response.status} ${detail}`);
    throw createError("VALIDATION_ERROR", `OpenAlex couldn't return these papers (${response.status}). Try again in a moment.`);
  }
  const body = (await response.json()) as { results?: Work[]; meta?: { next_cursor?: string | null } };
  return { works: body.results ?? [], nextCursor: body.meta?.next_cursor || null };
}

/**
 * Works up to the `last` (counting from 1), from page `firstPage` on. Numbered pages in
 * parallel when they keep the results page's order; otherwise the cursor pages it reads,
 * one after another from the start.
 */
async function readWorks<Work>(request: SearchRequest, firstPage: number, last: number, select: string): Promise<{ works: Work[]; offset: number }> {
  if (request.sort === PAGE_ORDERED_SORT) {
    const pages = Array.from({ length: Math.ceil(last / PAGE_SIZE) - firstPage + 1 }, (_, i) => firstPage + i);
    const read = await Promise.all(pages.map((page) => readPage<Work>(request, { page }, select)));
    return { works: read.flatMap((page) => page.works), offset: (firstPage - 1) * PAGE_SIZE };
  }
  const works: Work[] = [];
  let cursor: string | null = "*";
  while (cursor && works.length < last) {
    const page: { works: Work[]; nextCursor: string | null } = await readPage<Work>(request, { cursor }, select);
    works.push(...page.works);
    cursor = page.nextCursor;
  }
  return { works, offset: 0 };
}

/**
 * Works `first` to `last` (counting from 1) of the search, in its results page's order, with
 * only the `select`ed fields. `spend` counts the pages against the acting person's OpenAlex
 * allowance first, and nothing is asked when it says no.
 */
export async function readSearchWorks<Work>(
  request: SearchRequest,
  { first, last, select }: { first: number; last: number; select: string },
  spend: (pages: number) => Promise<boolean>,
): Promise<Work[]> {
  // Cursor pages are read from the start; numbered pages from the range's first page.
  const firstPage = request.sort === PAGE_ORDERED_SORT ? Math.floor((first - 1) / PAGE_SIZE) + 1 : 1;
  if (!(await spend(Math.ceil(last / PAGE_SIZE) - firstPage + 1))) {
    throw createError("VALIDATION_ERROR", new OpenAlexLimitedError().message);
  }
  const { works, offset } = await readWorks<Work>(request, firstPage, last, select);
  return works.slice(first - 1 - offset, last - offset);
}
