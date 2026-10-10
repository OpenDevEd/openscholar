/**
 * What an extraction is started from (#690): paper sets, each with the range of its papers to
 * read, as screening reads them (`paperSetValidator`, `first`, `last`), and PDFs the person
 * uploaded. The page sends any number of them; the assistant one set. Each becomes a source the
 * job stores and its setup reads (./jobSources.ts, ./actions.ts): a search as its request from
 * result `first` to `last`, a screening as its included papers at their revision, a collection's
 * or the saved papers' range as that range, and an upload as one paper.
 */
import { v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { filtersOf } from "../paperSets/search";
import { findSearch } from "../research/records";
import type { InWorkspace } from "../workspaces/actor";
import { screeningRevision } from "../screening/accounting";
import { paperSetValidator } from "../screening/validators";
import { currentSearch } from "../../lib/research/records";
import { isRatingFilterActive } from "../../lib/utils";
import { checkScreeningSelection } from "./sources/screening";
import { MAX_JOB_SOURCES } from "./jobSources";
import { bucketItemInputValidator } from "./validators";

export const paperPickValidator = v.object({ set: paperSetValidator, first: v.number(), last: v.number() });
export const uploadPickValidator = v.object({ storageId: v.id("_storage"), title: v.string() });
export type PaperSet = Infer<typeof paperSetValidator>;
type PaperPick = Infer<typeof paperPickValidator>;
type UploadPick = Infer<typeof uploadPickValidator>;
/** A source as the job is started with it. */
type Source = Infer<typeof bucketItemInputValidator>;

const invalid = (message: string) => createError("VALIDATION_ERROR", message);

/** Papers `first` to `last` of a set, from 1 up. A screening is all its included papers, whatever the range. */
export function checkRange(first: number, last: number) {
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first) throw invalid("Pick papers from 1 up, with the first before the last");
}

/** A saved search as an extraction's source: the request its results page makes, which the job reads from OpenAlex. */
export async function searchFilters(ctx: QueryCtx, workspaceId: Id<"workspaces">, searchId: string) {
  const row = await findSearch(ctx, workspaceId, searchId);
  if (!row) throw createError("NOT_FOUND", "Search not found");
  const { params, filters } = await filtersOf(ctx, workspaceId, currentSearch(row.data));
  if (!filters) throw invalid("This search's query isn't one OpenAlex can read. Check its brackets and quotes.");
  // Which papers a person rated is theirs, not OpenAlex's: the job reads the search from OpenAlex, and would read the papers the filter leaves out.
  if (isRatingFilterActive([params.rmin, params.rmax], params.rated)) throw invalid("This search keeps papers by the person's ratings, which an extraction can't read from the search. Put its papers in a collection first, then extract from the collection.");
  return filters;
}

/** A screening as an extraction's source: its included papers as they are now, how many, and what it's called. */
export async function screeningPicked(ctx: QueryCtx, workspaceId: Id<"workspaces">, jobId: Id<"screeningJobs">) {
  const job = await ctx.db.get("screeningJobs", jobId);
  if (!job || !(job.workspaceId === workspaceId)) throw createError("NOT_FOUND", "Screening not found");
  const revision = await screeningRevision(ctx, job);
  return { revision, count: await checkScreeningSelection(ctx, workspaceId, jobId, revision), label: job.name ?? job.label ?? "Screening" };
}

/** One pick as the source the job stores. */
async function sourceOf(ctx: QueryCtx, { workspaceId }: InWorkspace, { set, first, last }: PaperPick): Promise<Source> {
  checkRange(first, last);
  if (set.kind === "screening") {
    const picked = await screeningPicked(ctx, workspaceId, set.jobId);
    // A range short of all its Included papers is kept; the start counts what it holds.
    const range = first > 1 || last < picked.count ? { first, last } : {};
    return { bucketKey: `screening:${set.jobId}:${first}-${last}`, source: "screening", sourceRefId: set.jobId, title: picked.label, authors: [], screeningSelection: { jobId: set.jobId, revision: picked.revision, count: picked.count, ...range } };
  }
  if (set.kind === "search") {
    const filters = await searchFilters(ctx, workspaceId, set.searchId);
    // Each range of a search is a source of its own.
    return { bucketKey: `history:${set.searchId}:${first}-${last}`, source: "history", sourceRefId: set.searchId, title: filters.query, authors: [], searchFilters: { ...filters, ...(first > 1 ? { first } : {}), limit: last } };
  }
  // One source for the whole range: the job reads its papers a page at a time when it's set up.
  const collection = set.kind === "collection" ? await ctx.db.get("collections", set.collectionId) : null;
  if (set.kind === "collection" && collection?.workspaceId !== workspaceId) throw createError("NOT_FOUND", "Collection not found");
  const collectionId = collection?._id;
  return { bucketKey: `library:${collectionId ?? "all"}:${first}-${last}`, source: collectionId ? "collection" : "library", sourceRefId: collectionId ?? "library", title: collection?.name ?? "Saved papers", authors: [], librarySet: { ...(collectionId ? { collectionId } : {}), first, last, count: 0 } };
}

/** The picks and uploads as the sources the job stores, one each. */
export async function sourcesFor(ctx: QueryCtx, reader: InWorkspace, picks: PaperPick[], uploads: UploadPick[] = []): Promise<Source[]> {
  if (picks.length + uploads.length > MAX_JOB_SOURCES) throw invalid(`An extraction takes up to ${MAX_JOB_SOURCES.toLocaleString("en")} sources.`);
  const papers = await Promise.all(picks.map((pick) => sourceOf(ctx, reader, pick)));
  return [...papers, ...uploads.map(({ storageId, title }): Source => ({ bucketKey: `upload:${storageId}`, source: "upload", sourceRefId: storageId, title, authors: [], storageId }))];
}
