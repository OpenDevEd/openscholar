/**
 * One change made to many papers at once (#341): the papers of a set, read on the server in
 * the set's own order, and what the assistant's change_papers tool does to each. The model
 * names the set and never reads the papers: asked to save every paper a query found, it read
 * twelve pages of results and saved them one by one.
 */
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { InWorkspace } from "../workspaces/actor";
import { createError } from "../lib/errors";
import { heldPapers, SAVED_A_READ } from "../paperSets/held";
import { readSearchRun, readSearchWorks, type SearchSnapshot } from "../paperSets/openalex";
import { PAPERS_A_READ, SCREENING_FIELDS, keptByRating, searchPapers, spender, toPaper, type SavedSearchRequest, type SearchPaper, type Work } from "../paperSets/search";
import { parsePaperKey, toPaperKey } from "../../lib/papers/paper-ref";

/**
 * Papers one bulk change takes at most, whatever the person's plan allows (`bulk_papers`):
 * the reply reads them all, and makes every change, before it goes on.
 */
export const BULK_CEILING = 10_000;
/** Papers OpenAlex is asked for by ID in one request: its filter takes this many values. */
const IDS_A_REQUEST = 50;

const SAVE = "library/mutations:saveToLibrary";
const IN_COLLECTION = "library/mutations:setPaperInCollection";
const REMOVE = "library/mutations:removeFromLibrary";
const RATE = "library/mutations:setLibraryRating";

/**
 * What change_papers is given. A query's filters are named by the tool that searches, not
 * spelled out again here: every request carries every tool, and thirty settings twice over
 * is a thousand tokens of each (#326). The search checks them when the set is read.
 */
export const changePapersSchema = () =>
  z.object({
    papers: z.union([
      z.object({ kind: z.literal("query"), query: z.string().nullish(), filters: z.record(z.string(), z.unknown()).nullish() }),
      z.object({ kind: z.literal("search"), searchId: z.string() }),
      z.object({ kind: z.literal("collection"), collectionId: z.string() }),
      z.object({ kind: z.literal("saved") }),
      z.object({ kind: z.literal("screening"), jobId: z.string() }),
      z.object({ kind: z.literal("ids"), ids: z.array(z.string()) }),
    ]),
    first: z.number().nullish(),
    last: z.number().nullish(),
    do: z.enum(["save", "collect", "uncollect", "remove", "rate"]),
    collectionId: z.string().nullish(),
    rating: z.number().nullish(),
  });
/** A set of papers, as change_papers names it. A query comes with the filters research/papers:search takes. */
export type PaperSet =
  | { kind: "query"; query?: string | null; filters?: Record<string, unknown> | null }
  | { kind: "search"; searchId: string }
  | { kind: "collection"; collectionId: string }
  | { kind: "saved" }
  | { kind: "screening"; jobId: string }
  | { kind: "ids"; ids: string[] };
export type ChangePapers = { papers: PaperSet; first?: number | null; last?: number | null; do: "save" | "collect" | "uncollect" | "remove" | "rate"; collectionId?: string | null; rating?: number | null };

const invalid = (message: string) => createError("VALIDATION_ERROR", message);

/**
 * Papers of a set one bulk change looks through at most: a rating filter that keeps few of a
 * broad query's papers would otherwise read page after page of OpenAlex for them.
 */
const SCANNED_MAX = 20_000;

/** Reads a set a piece at a time, each carrying on from where the last stopped, until `last`, the set's end, or `enough` papers. */
async function readPieces(first: number, last: number, enough: number, piece: (from: number, to: number, resume?: string) => Promise<{ papers: SearchPaper[]; taken: number; resume?: string; ended: boolean }>) {
  const papers: SearchPaper[] = [];
  let resume: string | undefined;
  for (let from = first; from <= last; ) {
    if (from - first >= SCANNED_MAX) throw invalid(`Its rating filter keeps few of the first ${SCANNED_MAX.toLocaleString("en")} papers, so a change can't go through them all. Name a range with first and last, or narrow the query.`);
    // No more than the papers still wanted: a page that skips to `first` takes none, and the read carries on from where it stopped.
    const read = await piece(from, Math.min(last, from + Math.min(PAPERS_A_READ, enough - papers.length) - 1), resume);
    papers.push(...read.papers);
    if (read.ended || !read.resume || papers.length >= enough) break;
    resume = read.resume;
    from += read.taken;
  }
  return papers;
}

/**
 * The set's papers `first` to `last` (from 1), in its own order: a query's and a saved
 * search's as their results list them, a collection's and the library's newest saved first, a
 * screening's included papers in the order it took them. Left out, they are the whole set.
 * Either way no more than the person's plan changes in one go (`bulk_papers`): a range or set
 * past it is refused, read no further than one paper past it. Papers named by ID or key come as
 * OpenAlex has them, or from elsewhere as the library holds them. Each page read from OpenAlex
 * counts against the person's allowance.
 */
export async function papersOf(ctx: ActionCtx, { userId, workspaceId }: InWorkspace, { papers: set, first: start, last: end }: Pick<ChangePapers, "papers" | "first" | "last">): Promise<SearchPaper[]> {
  // Typed here: the generated API's types depend on this module, so inference would loop.
  const allowed: number | null = await ctx.runQuery(internal.billing.accounts.planLimitOf, { workspaceId, limit: "bulk_papers" });
  const most = Math.min(allowed ?? BULK_CEILING, BULK_CEILING);
  const tooMany = () => invalid(`The person's plan changes up to ${most.toLocaleString("en")} papers in one go. Name a range of the set with first and last, or a smaller set.`);
  if (set.kind === "ids") {
    const keys = [...new Set(set.ids.map(toPaperKey))].filter((key): key is string => key !== null);
    if (!keys.length) throw invalid("None of these is a paper's ID, such as W2741809807, or a paper's key as a list gave it.");
    if (keys.length > most) throw tooMany();
    const ids = keys.flatMap((key) => {
      const ref = parsePaperKey(key);
      return ref?.source === "openalex" ? [ref.work] : [];
    });
    // A paper from elsewhere is changed as the person's library holds it.
    const elsewhere = keys.filter((key) => parsePaperKey(key)?.source !== "openalex");
    const saved: SearchPaper[] = [];
    for (let from = 0; from < elsewhere.length; from += SAVED_A_READ) saved.push(...(await ctx.runQuery(internal.paperSets.held.saved, { workspaceId, keys: elsewhere.slice(from, from + SAVED_A_READ) })));
    if (!ids.length) return saved;
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const person: { clerkId: string } | null = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
    const { clerkId } = person;
    const found: Work[] = [];
    for (let from = 0; from < ids.length; from += IDS_A_REQUEST) {
      const some = ids.slice(from, from + IDS_A_REQUEST);
      found.push(...(await readSearchWorks<Work>({ filter: `openalex:${some.join("|")}`, sort: "cited_by_count:desc" }, { first: 1, last: some.length, select: SCREENING_FIELDS }, spender(ctx, clerkId))));
    }
    return [...found.map(toPaper), ...saved];
  }
  const first = start ?? 1;
  if (!Number.isSafeInteger(first) || first < 1 || (end != null && (!Number.isSafeInteger(end) || end < first))) throw invalid("Pick papers from 1 up, with the first before the last.");
  if (end != null && end - first + 1 > most) throw tooMany();
  // Left out, the whole set, read until one paper past what the plan allows says it holds more: papers a rating filter drops don't count.
  const last = end ?? Number.MAX_SAFE_INTEGER;
  const enough = most + 1;
  let papers: SearchPaper[];
  if (set.kind === "query") {
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const found: SavedSearchRequest = await ctx.runQuery(internal.research.searches.requestFor, { userId, workspaceId, query: set.query ?? undefined, settings: (set.filters ?? {}) as never });
    if (!found.request) throw invalid("This query isn't one OpenAlex can read. Check its brackets and quotes.");
    const request = found.request;
    const rating = found.ratingRange ? { min: found.ratingRange[0], max: found.ratingRange[1] } : undefined;
    papers = await readPieces(first, last, enough, async (from, to, resume) => {
      const { works, ended, resume: next } = await readSearchRun<Work>(request, { first: from, last: to, select: SCREENING_FIELDS, resume, goesOn: true }, spender(ctx, found.clerkId));
      return { papers: await keptByRating(ctx, userId, works.map(toPaper), rating), taken: works.length, ended, ...(next ? { resume: next } : {}) };
    });
  } else if (set.kind === "search") {
    // Every piece reads the search as the first found it.
    let snapshot: SearchSnapshot | undefined;
    papers = await readPieces(first, last, enough, async (from, to, resume) => {
      const read = await searchPapers(ctx, { userId, workspaceId }, { searchId: set.searchId, first: from, last: to }, snapshot, { resume, goesOn: true });
      snapshot = read.snapshot;
      return read;
    });
  } else {
    const held = set.kind === "collection" ? { kind: set.kind, collectionId: set.collectionId as Id<"collections"> } : set.kind === "screening" ? { kind: set.kind, jobId: set.jobId as Id<"screeningJobs"> } : { kind: "saved" as const };
    papers = await readPieces(first, last, enough, async (from, to, resume) => {
      const read = await heldPapers(ctx, { userId, workspaceId }, held, { first: from, last: to }, resume);
      return { papers: read.papers, taken: to - from + 1, ended: !read.resume, ...(read.resume ? { resume: read.resume } : {}) };
    });
  }
  if (papers.length > most) throw tooMany();
  return papers;
}

/** A paper as the library keeps it: what a results card holds, with the venue as its journal. */
const record = ({ venue, ...paper }: SearchPaper) => ({ ...paper, ...(venue ? { journal: venue } : {}) });

/**
 * What change_papers does to each paper: the one action, what each call of it is given, and
 * what every call is given alike, which is what its card says of the change once.
 */
export function changeOf({ do: what, collectionId, rating }: Pick<ChangePapers, "do" | "collectionId" | "rating">, papers: SearchPaper[]): { path: string; items: Record<string, unknown>[]; shared: Record<string, unknown> } {
  if ((what === "collect" || what === "uncollect") && collectionId == null) throw invalid("Say which collection: `collectionId`.");
  if (what === "rate" && rating == null) throw invalid("Say the rating to give them: `rating`, from 0 to 5.");
  // Into a collection is a save with the collection: one write, and one reversal that takes a paper it added back out of the library too.
  if (what === "save" || what === "collect") {
    const given = { ...(collectionId == null ? {} : { collectionId }), ...(rating == null ? {} : { rating }) };
    return { path: SAVE, items: papers.map((paper) => ({ ...record(paper), ...given })), shared: given };
  }
  if (what === "uncollect") return { path: IN_COLLECTION, items: papers.map((paper) => ({ paper: { paper: paper.paper }, collectionId, inCollection: false })), shared: { collectionId } };
  if (what === "rate") return { path: RATE, items: papers.map((paper) => ({ paper: paper.paper, rating })), shared: { rating } };
  return { path: REMOVE, items: papers.map((paper) => ({ paper: paper.paper })), shared: {} };
}
