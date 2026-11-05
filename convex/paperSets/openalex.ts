/**
 * Reading a search's works from OpenAlex on the server (#341), for Screen all and extraction:
 * only the fields the job keeps, in the results page's order, a range at a time. Each page
 * read counts against the acting person's OpenAlex allowance (#415).
 */
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { openAlexFetch, openAlexReason } from "../../lib/openalex/fetch";
import { searchUrl } from "../../lib/openalex/request-url";
import { appWork, selectWithIds } from "../../lib/openalex/work-id";
import { oqlForOwnIndex } from "../../lib/openalex/oql-for-own-index";
import { SEARCH_SOURCE_NAMES, type SearchSource } from "../../lib/search/source";
import { OpenAlexLimitedError } from "../../lib/openalex/limited";
import { autocompleteOptions, autocompleteParameters, sourceTypesParameters, withSourceTypes, type LookupEntity, type LookupOption } from "../../lib/openalex/autocomplete";

/** OpenAlex's largest page. */
export const PAGE_SIZE = 200;
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
/** How far into a search OpenAlex pages by number. Past it: "Cursor pagination is required for records beyond 10,000". */
const PAGED_MAX = 10_000;

/** A search's request as the results page makes it (lib/openalex/works-query.ts), with its sort. */
export const searchSourceValidator = v.union(v.literal("openalex"), v.literal("openscholar"));

export const searchRequestValidator = v.object({
  search: v.optional(v.string()),
  filter: v.optional(v.string()),
  oql: v.optional(v.string()),
  sort: v.string(),
  /** The source it reads. Kept with the request, so a job finishes on the source it started on. A request kept before there was a choice read OpenAlex. */
  source: v.optional(searchSourceValidator),
});
export type SearchRequest = Infer<typeof searchRequestValidator>;

/** A search's request and rating filter as they were when a request for its papers began. */
export const searchSnapshotValidator = v.object({
  request: searchRequestValidator,
  rating: v.optional(v.object({ min: v.number(), max: v.number() })),
});
export type SearchSnapshot = Infer<typeof searchSnapshotValidator>;

type Page = { page: number } | { cursor: string };

const sourceOf = (request: SearchRequest): SearchSource => request.source ?? "openalex";

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
  const name = SEARCH_SOURCE_NAMES[sourceOf(request)];
  console.error(`[paperSets] ${name} ${what} failed: ${response.status} ${body.slice(0, 500)}`);
  if (response.status >= 500 && countOf(request, "(") !== countOf(request, ")")) return createError("VALIDATION_ERROR", `${name} couldn't read this search: its brackets don't match.`);
  let reason: string | undefined;
  try {
    reason = response.status === 400 ? openAlexReason(JSON.parse(body)) : undefined;
  } catch {
    // Not the answer OpenAlex gives for a search it won't take.
  }
  return createError("VALIDATION_ERROR", reason ? `${name} didn't take this search: ${reason.slice(0, REASON_SHOWN)}` : `${name} couldn't ${doing} these papers (${response.status}). Try again in a moment.`);
}

/** One page of the search, by number or cursor. An OQL search goes in a POST body: it outgrows the URL limit. */
async function readPage<Work>(request: SearchRequest, at: Page, select: string, size = PAGE_SIZE): Promise<{ works: Work[]; nextCursor: string | null; total: number }> {
  const parameters = {
    "per-page": String(size),
    ...("page" in at ? { page: String(at.page) } : { cursor: at.cursor }),
    sort: request.sort,
    select: selectWithIds(select),
  };
  const source = sourceOf(request);
  const url = request.oql
    ? searchUrl(source, "", parameters)
    : searchUrl(source, "works", { ...parameters, search: request.search, filter: request.filter });
  let response: Response;
  try {
    response = await openAlexFetch(url, {
      timeoutMs: PAGE_TIMEOUT_MS,
      ...(request.oql ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oql: source === "openscholar" ? oqlForOwnIndex(request.oql) : request.oql }) } : {}),
    });
  } catch (error) {
    console.error(`[paperSets] ${SEARCH_SOURCE_NAMES[source]} page ${JSON.stringify(at)} didn't answer`, error);
    throw createError("VALIDATION_ERROR", `${SEARCH_SOURCE_NAMES[source]} didn't return these papers in time. Try again in a moment.`);
  }
  if (!response.ok) throw await refused(response, request, "return", `page ${JSON.stringify(at)}`);
  const body = (await response.json()) as { results?: Work[]; meta?: { next_cursor?: string | null; count?: number } };
  return { works: (body.results ?? []).map((work) => appWork(work as Work & { id?: string })), nextCursor: body.meta?.next_cursor || null, total: body.meta?.count ?? 0 };
}

const limited = () => createError("VALIDATION_ERROR", new OpenAlexLimitedError().message);

/** A place in a search's cursor pages: the cursor of a page, and how many of its works come before the place. */
type Place = { cursor: string; taken: number };

/**
 * The search's cursor pages, one after another from `from`, each spent for just before it's
 * asked, so a search that runs out early spends only the pages it had. A page tells the place
 * `after` so many of its works: in it, at the start of the next, or nowhere once the search is over.
 */
async function* cursorPages<Work>(request: SearchRequest, select: string, spend: (pages: number) => Promise<boolean>, from: string) {
  let cursor: string | null = from;
  while (cursor) {
    if (!(await spend(1))) throw limited();
    const at: string = cursor;
    const page: { works: Work[]; nextCursor: string | null; total: number } = await readPage<Work>(request, { cursor }, select);
    const after = (used: number): Place | null => (used < page.works.length ? { cursor: at, taken: used } : page.nextCursor ? { cursor: page.nextCursor, taken: 0 } : null);
    yield { works: page.works, total: page.total, after };
    cursor = page.nextCursor;
  }
}

/** The search's first work but `skipped`. */
const fromStart = (skipped: number): Place => ({ cursor: "*", taken: skipped });
/** A place as a job keeps it, for the job after it. A cursor is base64, so it holds no colon. */
const kept = (place: Place) => `${place.taken}:${place.cursor}`;
const placeOf = (resume: string): Place => ({ taken: Number(resume.slice(0, resume.indexOf(":"))), cursor: resume.slice(resume.indexOf(":") + 1) });

/**
 * Up to `count` works from a place in the search's cursor pages, the place after them (null
 * when the search has no more), and how many works the search has in all. Given `pages`, it
 * reads no more pages than that, and the place after says how many works are still to skip.
 */
async function readFrom<Work>(request: SearchRequest, at: Place, count: number, select: string, spend: (pages: number) => Promise<boolean>, pages = Infinity): Promise<{ works: Work[]; after: Place | null; total: number }> {
  const works: Work[] = [];
  let [toSkip, total, read] = [at.taken, 0, 0];
  for await (const page of cursorPages<Work>(request, select, spend, at.cursor)) {
    total = page.total;
    read += 1;
    const skipped = Math.min(toSkip, page.works.length);
    const taken = page.works.slice(skipped, skipped + count - works.length);
    works.push(...taken);
    toSkip -= skipped;
    if (works.length >= count || read >= pages) {
      const after = page.after(skipped + taken.length);
      return { works, total, after: after && { cursor: after.cursor, taken: after.taken + toSkip } };
    }
  }
  return { works, total, after: null };
}

/** Whether works up to `last` can come by numbered page, in the results page's order. */
export const numbered = (request: SearchRequest, last: number) => request.sort === PAGE_ORDERED_SORT && last <= PAGED_MAX;

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
  if (numbered(request, last)) {
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
  // ponytail: a range that starts deep in the search walks every page before it, one request each. A place kept per search would save that.
  const { works, total } = await readFrom<Work>(request, fromStart(first - 1), last - first + 1, select, spend);
  return { works, offset: first - 1, total };
}

const contact = (source: SearchSource) => {
  if (source === "openalex" && !process.env.OPENALEX_CONTACT_EMAIL) throw new Error("OPENALEX_CONTACT_EMAIL is not configured. Set this env var in the Convex dashboard.");
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
  contact(sourceOf(request));
  if (request.sort !== PAGE_ORDERED_SORT) {
    const { works, total } = await readWorks<Work>(request, (page - 1) * size + 1, page * size, select, spend);
    return { works, total };
  }
  if (!(await spend(1))) throw limited();
  const { works, total } = await readPage<Work>(request, { page }, select, size);
  return { works, total };
}

/**
 * Authors, funders, journals or institutions whose names start with the words given, as
 * OpenAlex's autocomplete finds them, each with what tells it apart. Counted against the
 * acting person's allowance: one request, and a second for journals' types. The page's own
 * lookup (lib/openalex/lookup.ts) makes the same requests from the Next server.
 */
export async function autocomplete(entity: LookupEntity, text: string, spend: (pages: number) => Promise<boolean>, source: SearchSource = "openalex"): Promise<LookupOption[]> {
  contact(source);
  if (!(await spend(entity === "sources" ? 2 : 1))) throw limited();
  const options = autocompleteOptions(await readLookup(`autocomplete/${entity}`, autocompleteParameters(text, entity, source), source));
  if (entity !== "sources" || !options.length) return options;
  return withSourceTypes(options, await readLookup("sources", sourceTypesParameters(options.map((option) => option.id)), source));
}

async function readLookup(path: string, parameters: Record<string, string>, source: SearchSource): Promise<unknown> {
  const name = SEARCH_SOURCE_NAMES[source];
  let response: Response;
  try {
    response = await openAlexFetch(searchUrl(source, path, parameters), { timeoutMs: PAGE_TIMEOUT_MS });
  } catch (error) {
    console.error(`[paperSets] ${name} ${path} didn't answer`, error);
    throw createError("VALIDATION_ERROR", `${name} didn't answer in time. Try again in a moment.`);
  }
  if (!response.ok) {
    console.error(`[paperSets] ${name} ${path} failed: ${response.status} ${(await response.text().catch(() => "")).slice(0, 500)}`);
    throw createError("VALIDATION_ERROR", `${name} couldn't look that up (${response.status}). Try again in a moment.`);
  }
  return await response.json();
}

/** One record by its address, such as works/W1 or authors/A1, or null when OpenAlex has none by it. One request, counted against the acting person's allowance. `what` names it in errors. */
async function readRecord<Record>(path: string, select: string, spend: (pages: number) => Promise<boolean>, what: string, source: SearchSource): Promise<Record | null> {
  contact(source);
  if (!(await spend(1))) throw limited();
  const name = SEARCH_SOURCE_NAMES[source];
  let response: Response;
  try {
    response = await openAlexFetch(searchUrl(source, path, { select }), { timeoutMs: PAGE_TIMEOUT_MS });
  } catch (error) {
    console.error(`[paperSets] ${name} ${path} didn't answer`, error);
    throw createError("VALIDATION_ERROR", `${name} didn't return ${what} in time. Try again in a moment.`);
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    console.error(`[paperSets] ${name} ${path} failed: ${response.status} ${(await response.text().catch(() => "")).slice(0, 500)}`);
    throw createError("VALIDATION_ERROR", `${name} couldn't return ${what} (${response.status}). Try again in a moment.`);
  }
  return (await response.json()) as Record;
}
/** One work by its ID, or null when OpenAlex has none by it. */
export const readWork = async <Work>(id: string, select: string, spend: (pages: number) => Promise<boolean>, source: SearchSource = "openalex") => {
  const work = await readRecord<Work & { id?: string }>(`works/${id}`, selectWithIds(select), spend, "this paper", source);
  return work && (appWork(work) as Work);
};
/** One author by their ID, or null when OpenAlex has none by it. */
export const readAuthor = <Author>(id: string, select: string, spend: (pages: number) => Promise<boolean>, source: SearchSource = "openalex") => readRecord<Author>(`authors/${id}`, select, spend, "this author", source);

/** The names of up to 100 authors, funders, journals or institutions by their IDs, such as A1: one request, counted against the acting person's allowance. One OpenAlex has none for is left out. */
export async function readNames(entity: LookupEntity, ids: readonly string[], spend: (pages: number) => Promise<boolean>, source: SearchSource = "openalex"): Promise<Array<{ id: string; name: string }>> {
  contact(source);
  if (!(await spend(1))) throw limited();
  const body = (await readLookup(entity, { filter: `openalex_id:${ids.join("|")}`, select: source === "openscholar" ? "id,display_name,ids" : "id,display_name", "per-page": "100" }, source)) as { results?: Array<{ id?: unknown; display_name?: unknown; ids?: { openalex?: unknown } | null }> };
  // Our index answers an OpenAlex ID with its own record, so the name goes back under the ID that was asked for.
  const named = (body.results ?? []).flatMap(({ id, display_name: name, ids: paired }) => {
    if (typeof id !== "string" || typeof name !== "string") return [];
    const own = id.split("/").at(-1)!;
    const openalex = typeof paired?.openalex === "string" ? paired.openalex.split("/").at(-1)! : null;
    return [{ id: openalex && ids.includes(openalex) && !ids.includes(own) ? openalex : own, name }];
  });
  // One OpenAlex author can stand for several of our records: the ID comes back once.
  return [...new Map(named.map((record) => [record.id, record])).values()];
}

/**
 * How many works the search has, divided by one of OpenAlex's groupings, as it counts them:
 * up to 200 groups, the largest first. One request, counted against the acting person's
 * allowance. An OQL search isn't a request OpenAlex groups.
 */
export async function groupSearch(request: SearchRequest, by: string, spend: (pages: number) => Promise<boolean>): Promise<{ total: number; groups: Array<{ key: string; name: string; count: number }> }> {
  const source = sourceOf(request);
  contact(source);
  if (request.oql) throw createError("VALIDATION_ERROR", "A search written in OQL can't be counted by group.");
  if (!(await spend(1))) throw limited();
  let response: Response;
  try {
    response = await openAlexFetch(searchUrl(source, "works", { search: request.search, filter: request.filter, group_by: by, "per-page": String(PAGE_SIZE) }), { timeoutMs: PAGE_TIMEOUT_MS });
  } catch (error) {
    console.error(`[paperSets] ${SEARCH_SOURCE_NAMES[source]} count by ${by} didn't answer`, error);
    throw createError("VALIDATION_ERROR", `${SEARCH_SOURCE_NAMES[source]} didn't count these papers in time. Try again in a moment.`);
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
  contact(sourceOf(request));
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
  contact(sourceOf(request));
  const { works, offset } = await readWorks<Work>(request, first, last, select, spend);
  return works.slice(first - 1 - offset, last - offset);
}

/**
 * Works `first` to `last` of the search for one step of a job's reading, and whether the
 * search `ended` with them. A job that `goesOn` reads by cursor, one page a step: from where
 * the step before stopped (`resume`), or from the start, skipping to `first`. The place after
 * the page comes back as `resume`, however far the job goes and whatever OpenAlex's order does
 * between reads, and only the works it took count as read. A step alone reads as
 * `readSearchWorks` does.
 */
export async function readSearchRun<Work>(
  request: SearchRequest,
  { first, last, select, resume, goesOn }: { first: number; last: number; select: string; resume?: string; goesOn: boolean },
  spend: (pages: number) => Promise<boolean>,
): Promise<{ works: Work[]; ended: boolean; resume?: string }> {
  contact(sourceOf(request));
  if (!resume && !goesOn) {
    const { works, offset, total } = await readWorks<Work>(request, first, last, select, spend);
    // A short page isn't the search's end: its count is.
    return { works: works.slice(first - 1 - offset, last - offset), ended: last >= total };
  }
  const { works, after } = await readFrom<Work>(request, resume ? placeOf(resume) : fromStart(first - 1), last - first + 1, select, spend, 1);
  return { works, ended: !after, ...(after ? { resume: kept(after) } : {}) };
}
