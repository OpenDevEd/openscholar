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
import { inputSchema } from "../lib/assistantTools";
import { createError } from "../lib/errors";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { USER_ACTIONS } from "../lib/userActionRegistry";
import { heldPapers } from "../paperSets/held";
import { readSearchWorks } from "../paperSets/openalex";
import { SCREENING_FIELDS, checkRange, keptByRating, searchPapers, spender, toPaper, type SavedSearchRequest, type SearchPaper, type Work } from "../paperSets/search";
import { workUrl } from "../../lib/openalex/work-id";

/** Papers one bulk change takes: as many as one job reads. */
export const PAPERS_MAX = MAX_SCREENING_PAPERS_PER_JOB;
/** Papers OpenAlex is asked for by ID in one request: its filter takes this many values. */
const IDS_A_REQUEST = 50;

const SEARCH = "research/papers:search";
const SAVE = "library/mutations:saveToLibrary";
const IN_COLLECTION = "library/mutations:setPaperInCollection";
const REMOVE = "library/mutations:removeFromLibrary";
const RATE = "library/mutations:setLibraryRating";

/** A query and its filters, as research/papers:search takes them, without the page. */
const querySchema = () => {
  const { page: _page, ...fields } = inputSchema(USER_ACTIONS.find((entry) => entry.path === SEARCH)!).shape as Record<string, z.ZodType>;
  return z.object(fields);
};

/** What change_papers is given. Made when the tools are, since it reads the registry. */
export const changePapersSchema = () =>
  z.object({
    papers: z.union([
      querySchema().extend({ kind: z.literal("query") }),
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
/** A set of papers, as change_papers names it. A query comes with the filters research/papers:search takes, whatever they are. */
export type PaperSet =
  | ({ kind: "query"; query?: string | null } & Record<string, unknown>)
  | { kind: "search"; searchId: string }
  | { kind: "collection"; collectionId: string }
  | { kind: "saved" }
  | { kind: "screening"; jobId: string }
  | { kind: "ids"; ids: string[] };
export type ChangePapers = { papers: PaperSet; first?: number | null; last?: number | null; do: "save" | "collect" | "uncollect" | "remove" | "rate"; collectionId?: string | null; rating?: number | null };

const invalid = (message: string) => createError("VALIDATION_ERROR", message);

/**
 * The set's papers `first` to `last` (from 1), in its own order: a query's and a saved
 * search's as their results list them, a collection's and the library's newest saved first, a
 * screening's included papers in the order it took them. Left out, they are the whole set,
 * as far as one bulk change goes: the person is asked with how many that is. Papers named by
 * ID come as OpenAlex has them. Each page read from OpenAlex counts against the person's allowance.
 */
export async function papersOf(ctx: ActionCtx, userId: Id<"users">, { papers: set, first: start, last: end }: Pick<ChangePapers, "papers" | "first" | "last">): Promise<SearchPaper[]> {
  if (set.kind === "ids") {
    const ids = [...new Set(set.ids.map((id) => workUrl(id)?.split("/").at(-1)))].filter((id): id is string => id !== undefined);
    if (!ids.length) throw invalid("None of these is a paper's ID, such as W2741809807.");
    if (ids.length > PAPERS_MAX) throw invalid(`One call changes up to ${PAPERS_MAX.toLocaleString("en")} papers.`);
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const { clerkId }: SavedSearchRequest = await ctx.runQuery(internal.research.searches.requestFor, { userId, settings: {} });
    const found: Work[] = [];
    for (let from = 0; from < ids.length; from += IDS_A_REQUEST) {
      const some = ids.slice(from, from + IDS_A_REQUEST);
      found.push(...(await readSearchWorks<Work>({ filter: `openalex:${some.join("|")}`, sort: "cited_by_count:desc" }, { first: 1, last: some.length, select: SCREENING_FIELDS }, spender(ctx, clerkId))));
    }
    return found.map(toPaper);
  }
  const first = start ?? 1;
  const last = end ?? first + PAPERS_MAX - 1;
  checkRange(first, last);
  if (set.kind === "query") {
    const { kind: _kind, query, ...settings } = set;
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const found: SavedSearchRequest = await ctx.runQuery(internal.research.searches.requestFor, { userId, query: query ?? undefined, settings: settings as never });
    if (!found.request) throw invalid("This query isn't one OpenAlex can read. Check its brackets and quotes.");
    const works = await readSearchWorks<Work>(found.request, { first, last, select: SCREENING_FIELDS }, spender(ctx, found.clerkId));
    return keptByRating(ctx, userId, works.map(toPaper), found.ratingRange ? { min: found.ratingRange[0], max: found.ratingRange[1] } : undefined);
  }
  if (set.kind === "search") return (await searchPapers(ctx, userId, { searchId: set.searchId, first, last })).papers;
  const held = set.kind === "collection" ? { kind: set.kind, collectionId: set.collectionId as Id<"collections"> } : set.kind === "screening" ? { kind: set.kind, jobId: set.jobId as Id<"screeningJobs"> } : { kind: "saved" as const };
  return (await heldPapers(ctx, userId, held, { first, last })).papers;
}

/** A paper as the library keeps it: what a results card holds, with the venue as its journal. */
const record = ({ venue, ...paper }: SearchPaper) => ({ ...paper, ...(venue ? { journal: venue } : {}) });

/**
 * What change_papers does to each paper: the one action, what each call of it is given, and
 * what every call is given alike, which is what its card says of the change once.
 */
export function changeOf({ do: what, collectionId, rating }: Pick<ChangePapers, "do" | "collectionId" | "rating">, papers: SearchPaper[]): { path: string; items: Record<string, unknown>[]; shared: Record<string, unknown> } {
  const into = what === "collect" || (what === "save" && collectionId != null);
  if ((into || what === "uncollect") && collectionId == null) throw invalid("Say which collection: `collectionId`.");
  if (what === "rate" && rating == null) throw invalid("Say the rating to give them: `rating`, from 0 to 5.");
  if (into && rating != null) throw invalid("Put them in the collection first, then rate them in a second call with `do: \"rate\"`.");
  if (into || what === "uncollect") {
    return { path: IN_COLLECTION, items: papers.map((paper) => ({ paper: into ? record(paper) : { openalexId: paper.openalexId }, collectionId, inCollection: into })), shared: { collectionId } };
  }
  if (what === "save") return { path: SAVE, items: papers.map((paper) => ({ ...record(paper), ...(rating == null ? {} : { rating }) })), shared: rating == null ? {} : { rating } };
  if (what === "rate") return { path: RATE, items: papers.map((paper) => ({ openalexId: paper.openalexId, rating })), shared: { rating } };
  return { path: REMOVE, items: papers.map((paper) => ({ openalexId: paper.openalexId })), shared: {} };
}
