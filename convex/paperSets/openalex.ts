/**
 * Reading a search's works from OpenAlex on the server (#341), for Screen all and extraction:
 * only the fields the job keeps, in the results page's order, a range at a time. Each page
 * read counts against the acting person's OpenAlex allowance (#415).
 */
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { openAlexFetch, openAlexReason } from "../../lib/openalex/fetch";
import { openAlexUrl } from "../../lib/openalex/request-url";
import { OpenAlexLimitedError } from "../../lib/openalex/limited";

/** OpenAlex's largest page. */
const PAGE_SIZE = 200;
/** How long one page may take before the request fails, as the results page's reads do. */
const PAGE_TIMEOUT_MS = 12_000;
/** How much of OpenAlex's reason for refusing a search is passed on. Its own run to about 350 characters. */
const REASON_SHOWN = 500;
/**
 * How far apart a search's numbered pages are asked for. OpenAlex refuses a search with more
 * than 5 boolean operators when its requests arrive within about 0.04 s of each other.
 * Measured on 2026-10-05 for a 19-operator search: asked for at once, 15 of 20 pages were
 * refused; 0.25 s apart, none of 20, and 1,000 papers took 2.5 to 2.9 s.
 */
const PAGE_GAP_MS = 250;
/**
 * The sort under which numbered pages list works in the results page's (cursor) order.
 * Measured on 2026-10-02 for "climate adaptation": the first 1,000 works matched in every
 * position by relevance, but only 655 by citations and 724 by date, because OpenAlex breaks
 * ties differently on the two paths and can't sort by `id`. Other sorts read cursor pages.
 */
export const PAGE_ORDERED_SORT = "relevance_score:desc";

/** A search's request as the results page makes it (lib/openalex/works-query.ts), with its sort. */
export const searchRequestValidator = v.object({
  search: v.optional(v.string()),
  filter: v.optional(v.string()),
  oql: v.optional(v.string()),
  sort: v.string(),
});
export type SearchRequest = Infer<typeof searchRequestValidator>;

/** A search's request and rating filter as they were when a request for its papers began. */
export const searchSnapshotValidator = v.object({
  request: searchRequestValidator,
  rating: v.optional(v.object({ min: v.number(), max: v.number() })),
});
export type SearchSnapshot = Infer<typeof searchSnapshotValidator>;

type Page = { page: number } | { cursor: string };

/** How many of a character the search's text holds, outside its quoted phrases. */
const countOf = (request: SearchRequest, character: string) => `${request.search ?? ""}${request.filter ?? ""}${request.oql ?? ""}`.replace(/"[^"]*"/g, "").split(character).length;

/**
 * The error for an answer that isn't the papers. A 400 is a search OpenAlex won't take, and it
 * says why ("Wildcards (* or ?) do not work inside this quoted phrase"). Whoever wrote the search,
 * a person or the assistant, gets those words: asking again for the same search changes nothing.
 * Nor does it for a bracket without its pair, which OpenAlex answers with a bare 500.
 */
async function refused(response: Response, request: SearchRequest, doing: "return" | "count", what: string) {
  const body = await response.text().catch(() => "");
  console.error(`[paperSets] OpenAlex ${what} failed: ${response.status} ${body.slice(0, 500)}`);
  if (response.status >= 500 && countOf(request, "(") !== countOf(request, ")")) return createError("VALIDATION_ERROR", "OpenAlex couldn't read this search: its brackets don't match.");
  let reason: string | undefined;
  try {
    reason = response.status === 400 ? openAlexReason(JSON.parse(body)) : undefined;
  } catch {
    // Not the answer OpenAlex gives for a search it won't take.
  }
  return createError("VALIDATION_ERROR", reason ? `OpenAlex didn't take this search: ${reason.slice(0, REASON_SHOWN)}` : `OpenAlex couldn't ${doing} these papers (${response.status}). Try again in a moment.`);
}

/** One page of the search, by number or cursor. An OQL search goes in a POST body: it outgrows the URL limit. */
async function readPage<Work>(request: SearchRequest, at: Page, select: string, size = PAGE_SIZE): Promise<{ works: Work[]; nextCursor: string | null; total: number }> {
  const parameters = {
    "per-page": String(size),
    ...("page" in at ? { page: String(at.page) } : { cursor: at.cursor }),
    sort: request.sort,
    select,
  };
  const url = request.oql
    ? openAlexUrl("", parameters)
    : openAlexUrl("works", { ...parameters, search: request.search, filter: request.filter });
  let response: Response;
  try {
    response = await openAlexFetch(url, {
      timeoutMs: PAGE_TIMEOUT_MS,
      ...(request.oql ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oql: request.oql }) } : {}),
    });
  } catch (error) {
    console.error(`[paperSets] OpenAlex page ${JSON.stringify(at)} didn't answer`, error);
    throw createError("VALIDATION_ERROR", "OpenAlex didn't return these papers in time. Try again in a moment.");
  }
  if (!response.ok) throw await refused(response, request, "return", `page ${JSON.stringify(at)}`);
  const body = (await response.json()) as { results?: Work[]; meta?: { next_cursor?: string | null; count?: number } };
  return { works: body.results ?? [], nextCursor: body.meta?.next_cursor || null, total: body.meta?.count ?? 0 };
}

const limited = () => createError("VALIDATION_ERROR", new OpenAlexLimitedError().message);

/**
 * The search's cursor pages, one after another from the start, each spent for just before
 * it's asked, so a search that runs out early spends only the pages it had.
 */
async function* cursorPages<Work>(request: SearchRequest, select: string, spend: (pages: number) => Promise<boolean>) {
  let cursor: string | null = "*";
  while (cursor) {
    if (!(await spend(1))) throw limited();
    const page: { works: Work[]; nextCursor: string | null; total: number } = await readPage<Work>(request, { cursor }, select);
    yield page;
    cursor = page.nextCursor;
  }
}

/**
 * Works `first` to `last` (counting from 1), how many works came before the first one
 * returned, and how many the search has in all. Numbered pages a moment apart when they keep the results page's order, spent for
 * together first. Otherwise cursor pages from the start, keeping only the range asked for:
 * a range deep in the search still holds no more than its own works.
 */
async function readWorks<Work>(
  request: SearchRequest,
  first: number,
  last: number,
  select: string,
  spend: (pages: number) => Promise<boolean>,
): Promise<{ works: Work[]; offset: number; total: number }> {
  if (request.sort === PAGE_ORDERED_SORT) {
    const firstPage = Math.floor((first - 1) / PAGE_SIZE) + 1;
    const pages = Array.from({ length: Math.ceil(last / PAGE_SIZE) - firstPage + 1 }, (_, i) => firstPage + i);
    if (!(await spend(pages.length))) throw limited();
    const read = await Promise.all(
      pages.map(async (page, i) => {
        await new Promise((resolve) => setTimeout(resolve, i * PAGE_GAP_MS));
        return readPage<Work>(request, { page }, select);
      }),
    );
    return { works: read.flatMap((page) => page.works), offset: (firstPage - 1) * PAGE_SIZE, total: read[0]?.total ?? 0 };
  }
  const works: Work[] = [];
  let [seen, total] = [0, 0];
  for await (const page of cursorPages<Work>(request, select, spend)) {
    total = page.total;
    works.push(...page.works.slice(Math.max(0, first - 1 - seen), Math.max(0, last - seen)));
    seen += page.works.length;
    if (seen >= last) break;
  }
  return { works, offset: first - 1, total };
}

const contact = () => {
  if (!process.env.OPENALEX_CONTACT_EMAIL) throw new Error("OPENALEX_CONTACT_EMAIL is not configured. Set this env var in the Convex dashboard.");
};

/**
 * One short page of the search, in its results page's order, with how many works the
 * search has in all: what the assistant reads (#327). Under the sort whose numbered pages
 * keep that order, it's one request for just those works. Under any other it reads cursor
 * pages from the start, as the results page does, so the papers stand where the person
 * sees them: a request for every 200 works up to the page. Each request counts
 * against the acting person's allowance.
 */
export async function readSearchPage<Work>(
  request: SearchRequest,
  { page, size, select }: { page: number; size: number; select: string },
  spend: (pages: number) => Promise<boolean>,
): Promise<{ works: Work[]; total: number }> {
  contact();
  if (request.sort !== PAGE_ORDERED_SORT) {
    const { works, total } = await readWorks<Work>(request, (page - 1) * size + 1, page * size, select, spend);
    return { works, total };
  }
  if (!(await spend(1))) throw limited();
  const { works, total } = await readPage<Work>(request, { page }, select, size);
  return { works, total };
}

/**
 * Authors or funders whose names start with the words given, as OpenAlex's autocomplete finds
 * them, each with where they work or what they are. One request, counted against the acting
 * person's allowance. The page's own lookups (lib/openalex/authors.ts, funders.ts) make the
 * same request from the Next server, and can't be loaded here.
 */
export async function autocomplete(entity: "authors" | "funders", text: string, spend: (pages: number) => Promise<boolean>): Promise<Array<{ id: string; name: string; detail?: string }>> {
  contact();
  if (!(await spend(1))) throw limited();
  let response: Response;
  try {
    response = await fetch(openAlexUrl(`autocomplete/${entity}`, { q: text }), { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
  } catch (error) {
    console.error(`[paperSets] OpenAlex autocomplete of ${entity} didn't answer`, error);
    throw createError("VALIDATION_ERROR", "OpenAlex didn't answer in time. Try again in a moment.");
  }
  if (!response.ok) {
    console.error(`[paperSets] OpenAlex autocomplete of ${entity} failed: ${response.status} ${(await response.text().catch(() => "")).slice(0, 500)}`);
    throw createError("VALIDATION_ERROR", `OpenAlex couldn't look that up (${response.status}). Try again in a moment.`);
  }
  const body = (await response.json()) as { results?: Array<{ id?: unknown; display_name?: unknown; hint?: unknown }> };
  return (Array.isArray(body.results) ? body.results : []).flatMap(({ id, display_name: name, hint }) =>
    typeof id === "string" && typeof name === "string" && name ? [{ id: id.split("/").at(-1)!, name, ...(typeof hint === "string" && hint ? { detail: hint } : {}) }] : [],
  );
}

/** One work by its ID, or null when OpenAlex has none by it. One request, counted against the acting person's allowance. */
export async function readWork<Work>(id: string, select: string, spend: (pages: number) => Promise<boolean>): Promise<Work | null> {
  contact();
  if (!(await spend(1))) throw limited();
  let response: Response;
  try {
    response = await fetch(openAlexUrl(`works/${id}`, { select }), { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
  } catch (error) {
    console.error(`[paperSets] OpenAlex work ${id} didn't answer`, error);
    throw createError("VALIDATION_ERROR", "OpenAlex didn't return this paper in time. Try again in a moment.");
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    console.error(`[paperSets] OpenAlex work ${id} failed: ${response.status} ${(await response.text().catch(() => "")).slice(0, 500)}`);
    throw createError("VALIDATION_ERROR", `OpenAlex couldn't return this paper (${response.status}). Try again in a moment.`);
  }
  return (await response.json()) as Work;
}

/**
 * How many works the search has, divided by one of OpenAlex's groupings, as it counts them:
 * up to 200 groups, the largest first. One request, counted against the acting person's
 * allowance. An OQL search isn't a request OpenAlex groups.
 */
export async function groupSearch(request: SearchRequest, by: string, spend: (pages: number) => Promise<boolean>): Promise<{ total: number; groups: Array<{ key: string; name: string; count: number }> }> {
  contact();
  if (request.oql) throw createError("VALIDATION_ERROR", "A search written in OQL can't be counted by group.");
  if (!(await spend(1))) throw limited();
  let response: Response;
  try {
    response = await openAlexFetch(openAlexUrl("works", { search: request.search, filter: request.filter, group_by: by, "per-page": String(PAGE_SIZE) }), { timeoutMs: PAGE_TIMEOUT_MS });
  } catch (error) {
    console.error(`[paperSets] OpenAlex count by ${by} didn't answer`, error);
    throw createError("VALIDATION_ERROR", "OpenAlex didn't count these papers in time. Try again in a moment.");
  }
  if (!response.ok) throw await refused(response, request, "count", `count by ${by}`);
  const body = (await response.json()) as { meta?: { count?: unknown }; group_by?: Array<{ key?: unknown; key_display_name?: unknown; count?: unknown }> };
  const groups = (Array.isArray(body.group_by) ? body.group_by : []).flatMap(({ key, key_display_name: name, count }) =>
    typeof key === "string" && typeof count === "number" ? [{ key, name: typeof name === "string" && name ? name : key, count }] : [],
  );
  return { total: typeof body.meta?.count === "number" ? body.meta.count : 0, groups };
}

/** How many works the search has: one request for one work, counted against the acting person's allowance. */
export async function countSearch(request: SearchRequest, spend: (pages: number) => Promise<boolean>): Promise<number> {
  contact();
  if (!(await spend(1))) throw limited();
  return (await readPage(request, { page: 1 }, "id", 1)).total;
}

/**
 * Works `first` to `last` (counting from 1) of the search, in its results page's order, with
 * only the `select`ed fields. `spend` counts pages against the acting person's OpenAlex
 * allowance before they're asked, and nothing more is asked when it says no.
 */
export async function readSearchWorks<Work>(
  request: SearchRequest,
  { first, last, select }: { first: number; last: number; select: string },
  spend: (pages: number) => Promise<boolean>,
): Promise<Work[]> {
  // OpenAlex's polite pool needs a contact address; without one the deployment is misconfigured.
  if (!process.env.OPENALEX_CONTACT_EMAIL) {
    throw new Error("OPENALEX_CONTACT_EMAIL is not configured. Set this env var in the Convex dashboard.");
  }
  const { works, offset } = await readWorks<Work>(request, first, last, select, spend);
  return works.slice(first - 1 - offset, last - offset);
}
