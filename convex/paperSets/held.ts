/**
 * Papers a job reads from what the account already holds (#341): a collection, every saved
 * paper, or an earlier screening job's included papers. Each has one fixed order, so
 * "papers 1 to 300" are the same papers every time: a collection's and saved papers newest
 * saved first, as the library page lists them; a job's in the order it took them.
 */
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { internalQuery, type ActionCtx } from "../lib/functions";
import { createError } from "../lib/errors";
import { MAX_AUTHORS } from "../lib/listCaps";
import { readLibraryPage } from "../library/queries";
import { paperSetValidator, screeningPaperInputValidator } from "../screening/validators";
import { checkRange, type SearchPaper } from "./search";

type PaperSet = Infer<typeof paperSetValidator>;
export type HeldSet = Exclude<PaperSet, { kind: "search" }>;

/** Papers one read takes: a saved paper holds its abstract and its whole OpenAlex record. */
const PAGE = 100;
const PAGE_BYTES = 8 * 1024 * 1024;

const fromLibrary = (item: Doc<"libraryItems">): SearchPaper => ({
  openalexId: item.openalexId,
  title: item.title,
  ...(item.abstract ? { abstract: item.abstract } : {}),
  ...(item.authors ? { authors: item.authors.split(", ").slice(0, MAX_AUTHORS) } : {}),
  ...(item.publicationYear === undefined ? {} : { publicationYear: item.publicationYear }),
  ...(item.doi ? { doi: item.doi } : {}),
  ...(item.journal ? { venue: item.journal } : {}),
  ...(item.citedByCount === undefined ? {} : { citedByCount: item.citedByCount }),
});

const fromResult = ({ openalexId, title, abstract, authors, publicationYear, doi, venue, citedByCount }: Doc<"screeningResults">): SearchPaper => ({
  openalexId, title, abstract, authors, publicationYear, doi, venue, citedByCount,
});

/** One page of a held set's papers, in its order. Another person's collection or job reads as not found. */
export const page = internalQuery({
  args: { userId: v.id("users"), set: paperSetValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ page: v.array(screeningPaperInputValidator), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { userId, set, cursor }) => {
    if (set.kind === "search") throw new Error("A search's papers are read from OpenAlex (./search.ts)");
    if (set.kind === "screening") {
      const job = await ctx.db.get("screeningJobs", set.jobId);
      if (!job || job.userId !== userId) throw createError("NOT_FOUND", "Screening not found");
      const read = await ctx.db
        .query("screeningResults")
        .withIndex("by_job_and_outcome", (q) => q.eq("jobId", set.jobId).eq("outcome", "included"))
        .paginate({ cursor, numItems: PAGE, maximumBytesRead: PAGE_BYTES });
      return { page: read.page.map(fromResult), isDone: read.isDone, continueCursor: read.continueCursor };
    }
    const collectionId = set.kind === "collection" ? set.collectionId : undefined;
    if (collectionId && (await ctx.db.get("collections", collectionId))?.userId !== userId) throw createError("NOT_FOUND", "Collection not found");
    const read = await readLibraryPage(ctx, userId, { sortBy: "savedAt", sortOrder: "desc", collectionId }, { cursor, numItems: PAGE, maximumBytesRead: PAGE_BYTES });
    return { page: read.page.map(fromLibrary), isDone: read.isDone, continueCursor: read.continueCursor };
  },
});

/** The set's pages, one after another from the start. */
async function* pages(ctx: ActionCtx, userId: Id<"users">, set: HeldSet) {
  let cursor: string | null = null;
  for (;;) {
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const read: { page: SearchPaper[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.paperSets.held.page, { userId, set, cursor });
    yield read.page;
    if (read.isDone) return;
    cursor = read.continueCursor;
  }
}

/**
 * Papers `first` to `last` (counting from 1) of a held set, keeping only that range as the
 * pages before it go by, so a range deep in the set still holds no more than its own papers.
 */
export async function heldPapers(ctx: ActionCtx, userId: Id<"users">, set: HeldSet, { first, last }: { first: number; last: number }): Promise<SearchPaper[]> {
  checkRange(first, last);
  const papers: SearchPaper[] = [];
  let seen = 0;
  for await (const read of pages(ctx, userId, set)) {
    papers.push(...read.slice(Math.max(0, first - 1 - seen), Math.max(0, last - seen)));
    seen += read.length;
    if (seen >= last) break;
  }
  return papers;
}
