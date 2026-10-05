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
import { authorMetadata, sourceMetadata } from "../../lib/library/paper-metadata";
import { screeningRevision } from "../screening/accounting";

type PaperSet = Infer<typeof paperSetValidator>;
export type HeldSet = Exclude<PaperSet, { kind: "search" }>;

/** Papers one read takes: a saved paper holds its abstract and its whole OpenAlex record. */
const PAGE = 100;
const PAGE_BYTES = 8 * 1024 * 1024;

const fromLibrary = (item: Doc<"libraryItems">): SearchPaper => ({
  openalexId: item.openalexId,
  title: item.title,
  ...(item.abstract ? { abstract: item.abstract } : {}),
  ...sourceMetadata(item),
  ...authorMetadata(item),
  authors: authorMetadata(item).authors?.slice(0, MAX_AUTHORS),
  ...(item.publicationYear === undefined ? {} : { publicationYear: item.publicationYear }),
  ...(item.doi ? { doi: item.doi } : {}),
  ...(item.journal ? { venue: item.journal } : {}),
  ...(item.citedByCount === undefined ? {} : { citedByCount: item.citedByCount }),
});

const fromResult = (paper: Doc<"screeningResults">): SearchPaper => ({
  ...sourceMetadata(paper),
  openalexId: paper.openalexId, title: paper.title, abstract: paper.abstract, authors: paper.authors, publicationYear: paper.publicationYear, doi: paper.doi, venue: paper.venue, citedByCount: paper.citedByCount,
});

/** One page of a held set's papers, in its order. Another person's collection or job reads as not found. */
export const page = internalQuery({
  args: { userId: v.id("users"), set: paperSetValidator, cursor: v.union(v.string(), v.null()), numItems: v.number(), revision: v.optional(v.string()) },
  returns: v.object({ page: v.array(screeningPaperInputValidator), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { userId, set, cursor, numItems, revision }) => {
    if (set.kind === "search") throw new Error("A search's papers are read from OpenAlex (./search.ts)");
    const opts = { cursor, numItems: Math.min(numItems, PAGE), maximumBytesRead: PAGE_BYTES };
    if (set.kind === "screening") {
      const job = await ctx.db.get("screeningJobs", set.jobId);
      if (!job || job.userId !== userId) throw createError("NOT_FOUND", "Screening not found");
      if (revision !== undefined && revision !== await screeningRevision(ctx, job)) {
        throw createError("CONFLICT", "Screening decisions changed. Remove this source and select it again to review the current Included papers.");
      }
      const read = await ctx.db
        .query("screeningResults")
        .withIndex("by_job_and_outcome", (q) => q.eq("jobId", set.jobId).eq("outcome", "included"))
        .paginate(opts);
      return { page: read.page.map(fromResult), isDone: read.isDone, continueCursor: read.continueCursor };
    }
    const collectionId = set.kind === "collection" ? set.collectionId : undefined;
    if (collectionId && (await ctx.db.get("collections", collectionId))?.userId !== userId) throw createError("NOT_FOUND", "Collection not found");
    const read = await readLibraryPage(ctx, userId, { sortBy: "savedAt", sortOrder: "desc", collectionId }, opts);
    return { page: read.page.map(fromLibrary), isDone: read.isDone, continueCursor: read.continueCursor };
  },
});

/** The set's pages from `cursor` on, each of at most `size()` papers, with where the set goes on after it (`after`, missing on the last). */
async function* pages(ctx: ActionCtx, userId: Id<"users">, set: HeldSet, cursor: string | null, size: () => number, revision?: string) {
  for (;;) {
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const read: { page: SearchPaper[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.paperSets.held.page, { userId, set, cursor, numItems: size(), revision });
    yield { papers: read.page, after: read.isDone ? undefined : read.continueCursor };
    if (read.isDone) return;
    cursor = read.continueCursor;
  }
}

/**
 * Papers `first` to `last` (counting from 1) of a held set, and where the set goes on after
 * them (`resume`, missing once it has no more). Given `resume`, the papers that follow it,
 * as many as the range holds: a request's next job reads on from where the last one stopped,
 * so papers that left the set since, as a pruned collection's do, don't shift the ones still
 * to come. Pages end exactly where the skipped papers end and where the range ends, and
 * only the range is kept: never more than one job's papers.
 */
export async function heldPapers(ctx: ActionCtx, userId: Id<"users">, set: HeldSet, { first, last }: { first: number; last: number }, resume?: string, revision?: string): Promise<{ papers: SearchPaper[]; resume?: string }> {
  checkRange(first, last);
  const papers: SearchPaper[] = [];
  let skip = resume === undefined ? first - 1 : 0;
  const want = last - first + 1;
  for await (const read of pages(ctx, userId, set, resume ?? null, () => skip || want - papers.length, revision)) {
    if (skip) skip -= read.papers.length;
    else papers.push(...read.papers);
    if (papers.length >= want) return { papers, ...(read.after === undefined ? {} : { resume: read.after }) };
  }
  return { papers };
}
