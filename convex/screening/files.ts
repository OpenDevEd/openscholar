/**
 * The PDFs a person hands a screening (plans/screening-reviewers), any number of them. Each is a row of
 * `screeningFiles` from the moment its upload ends. A cheap model reads its first pages once (./heldPdfs.ts
 * `look`), as work in the pool, and what it found stays on the row: the form shows it as it arrives, and the
 * screening's source takes its papers from these rows when it starts (./held.ts).
 *
 * A drop is read in lanes. Its first `LANES` files start at once, and each file that lands starts the one `LANES`
 * places after it. So a drop of thousands never has more than `LANES` readings in the pool, another workspace's
 * drop takes its turn beside it, and no two landings ask for the same next file: a landing that took "the first
 * one still waiting" would fight every other landing for it, which is what slowed Screen all (./slots.ts).
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { internalMutation, internalQuery } from "../lib/functions";
import { countOf, screeningFilesOf, type PdfStanding } from "../lib/listCounts";
import { workspaceMutation, workspaceQuery } from "../lib/userActions";
import { screeningPool } from "../workpool";
import { MAX_FILE_NAME, MAX_PDF_BYTES, MAX_PDF_MB } from "../../lib/assistant/files";
import { PDFS_A_CALL, pdfDropValidator, pdfReadValidator, pdfStateValidator, screeningAuthorsValidator } from "./validators";

/** Readings one drop has in the pool at once. Half the pool, so two drops and the models' own readings all move. */
const LANES = 20;
const STANDINGS = ["waiting", "known", "file", "broken"] as const satisfies readonly PdfStanding[];

const placed = (ctx: Pick<QueryCtx, "db">, batch: string, at: number) => ctx.db.query("screeningFiles").withIndex("by_batch_and_at", (q) => q.eq("batch", batch).eq("at", at)).unique();
const lastOf = (ctx: Pick<QueryCtx, "db">, batch: string) => ctx.db.query("screeningFiles").withIndex("by_batch_and_at", (q) => q.eq("batch", batch)).order("desc").first();

/** A drop is its adder's, in the workspace it was added in: nobody else adds to it or reads it. */
async function own(ctx: Pick<QueryCtx, "db">, actor: { userId: Id<"users">; workspaceId: Id<"workspaces"> }, batch: string) {
  const last = await lastOf(ctx, batch);
  if (last && (last.userId !== actor.userId || last.workspaceId !== actor.workspaceId)) throw createError("FORBIDDEN", "These files were added by someone else.");
  return last;
}

/** Puts files' first readings in the pool in one call, which costs about what one file's would (./slots.ts). */
async function start(ctx: MutationCtx, files: Id<"screeningFiles">[]) {
  if (!files.length) return;
  const workIds = await screeningPool.enqueueActionBatch(ctx, internal.screening.heldPdfs.look, files.map((fileId) => ({ fileId })), { onComplete: internal.screening.files.done, context: {} });
  for (const [i, fileId] of files.entries()) await ctx.db.patch("screeningFiles", fileId, { workId: workIds[i] });
}

/** Adds PDFs whose upload has ended to a drop, in the order given, and starts reading the ones whose lane is free. */
export const add = workspaceMutation({
  args: { batch: v.string(), files: v.array(v.object({ file: v.id("_storage"), name: v.string(), bytes: v.number() })) },
  returns: v.null(),
  handler: async (ctx, actor, { batch, files }) => {
    if (!batch || batch.length > 64) throw createError("VALIDATION_ERROR", "These files have no drop to go in.");
    if (files.length > PDFS_A_CALL) throw createError("VALIDATION_ERROR", `Add up to ${PDFS_A_CALL} PDFs in one call.`);
    const last = await own(ctx, actor, batch);
    const from = last ? last.at + 1 : 0;
    const starting: Id<"screeningFiles">[] = [];
    for (const [i, { file, name, bytes }] of files.entries()) {
      if (bytes > MAX_PDF_BYTES) throw createError("VALIDATION_ERROR", `${name} is over ${MAX_PDF_MB} MB.`);
      const at = from + i;
      const fileId = await ctx.db.insert("screeningFiles", { userId: actor.userId, workspaceId: actor.workspaceId, batch, at, file, name: name.slice(0, MAX_FILE_NAME), bytes, state: "waiting" });
      // Its lane is free where the file `LANES` places before it has landed already: that landing found no file to start.
      if (at < LANES || (await placed(ctx, batch, at - LANES))?.state !== "waiting") starting.push(fileId);
    }
    await start(ctx, starting);
    return null;
  },
});

/** How a drop stands: how many PDFs it holds, and of them how many are still to be read, are papers the index holds, are screened as the file they are, and don't open. */
export const drop = workspaceQuery({
  args: { batch: v.string() },
  returns: pdfDropValidator,
  handler: async (ctx, actor, { batch }) => {
    await own(ctx, actor, batch);
    const [waiting, known, file, broken] = await Promise.all(STANDINGS.map((standing) => countOf(ctx, screeningFilesOf(batch, standing))));
    return { total: waiting! + known! + file! + broken!, waiting: waiting!, known: known!, file: file!, broken: broken! };
  },
});

/** A page of a drop's PDFs in the order they were added, each with what its first reading found. */
export const list = workspaceQuery({
  args: { batch: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ id: v.id("screeningFiles"), name: v.string(), state: pdfStateValidator, title: v.optional(v.string()), known: v.boolean(), /** Read as the file it is: the index doesn't hold it, or holds it with no abstract. */ asFile: v.boolean(), pages: v.optional(v.number()) })),
  handler: async (ctx, actor, { batch, paginationOpts }) => {
    await own(ctx, actor, batch);
    const page = await ctx.db.query("screeningFiles").withIndex("by_batch_and_at", (q) => q.eq("batch", batch)).paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PDFS_A_CALL) });
    return { ...page, page: page.page.map((file) => ({ id: file._id, name: file.name, state: file.state, ...(file.title ? { title: file.title } : {}), known: file.known === true, asFile: file.state === "read" && (file.known !== true || file.bare === true), ...(file.pages === undefined ? {} : { pages: file.pages }) })) };
  },
});

/** What a file's first reading needs: the file, and whose it is. Null when its row is gone or it was read already. */
export const waiting = internalQuery({
  args: { fileId: v.id("screeningFiles") },
  returns: v.union(v.null(), v.object({ file: v.id("_storage"), name: v.string(), userId: v.id("users"), workspaceId: v.id("workspaces") })),
  handler: async (ctx, { fileId }) => {
    const row = await ctx.db.get("screeningFiles", fileId);
    return row?.state === "waiting" ? { file: row.file, name: row.name, userId: row.userId, workspaceId: row.workspaceId } : null;
  },
});

/** A file's first reading has ended: what it found is kept, and the file `LANES` places after it starts. */
export const landed = internalMutation({
  args: { workId: v.string(), read: v.union(pdfReadValidator, v.null()) },
  returns: v.null(),
  handler: async (ctx, { workId, read }) => {
    const row = await ctx.db.query("screeningFiles").withIndex("by_workId", (q) => q.eq("workId", workId)).unique();
    if (!row) return null;
    // A reading that failed every try leaves a file that opens for all anyone knows: it is screened as the file, under its own name.
    if (row.state === "waiting") await ctx.db.patch("screeningFiles", row._id, { ...(read ?? { state: "read" as const }), workId: undefined });
    const next = await placed(ctx, row.batch, row.at + LANES);
    if (next?.state === "waiting" && next.workId === undefined) await start(ctx, [next._id]);
    return null;
  },
});

/** The pool's callback for a first reading. The pool's own context has no triggers, so the row is written by `landed`, which keeps the drop's counts. */
export const done = screeningPool.defineOnComplete({
  context: v.object({}),
  handler: async (ctx, { workId, result }) => {
    await ctx.runMutation(internal.screening.files.landed, { workId, read: result.kind === "success" ? (result.returnValue as typeof pdfReadValidator.type) : null });
  },
});

/** How many PDFs a drop holds. */
export const total = internalQuery({
  args: { batch: v.string() },
  returns: v.number(),
  handler: async (ctx, { batch }) => ((await lastOf(ctx, batch))?.at ?? -1) + 1,
});

/** PDFs one read of a drop takes: a source's step is never longer (./gathering.ts `READ_STEP`). */
const SLICE = 200;
/** PDFs `from` to `to` of a drop (from 1), as its source reads them, `SLICE` of them at most. */
export const slice = internalQuery({
  args: { batch: v.string(), from: v.number(), to: v.number() },
  returns: v.array(v.object({ file: v.id("_storage"), name: v.string(), state: pdfStateValidator, pages: v.optional(v.number()), title: v.optional(v.string()), authors: screeningAuthorsValidator, year: v.optional(v.number()), doi: v.optional(v.string()), known: v.optional(v.boolean()), abstract: v.optional(v.string()) })),
  handler: async (ctx, { batch, from, to }) => {
    const rows: Doc<"screeningFiles">[] = await ctx.db.query("screeningFiles").withIndex("by_batch_and_at", (q) => q.eq("batch", batch).gte("at", from - 1).lte("at", to - 1)).take(Math.min(to - from + 1, SLICE));
    return rows.map(({ file, name, state, pages, title, authors, year, doi, known, abstract }) => ({ file, name, state, pages, title, authors, year, doi, known, abstract }));
  },
});
