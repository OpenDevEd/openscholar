/**
 * A screening's papers going into, or out of, a collection in an Evidence Library (plans/evidence-library-sources):
 * queued as they move (../screening/bookkeeping.ts `shelve`), and written a batch at a time by `flushWrites`
 * (./sourceActions.ts), as the person who started the job.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../lib/functions";
import { libraryWriteValidator } from "../screening/validators";
import { paperRefValidator, crossRefsValidator } from "../lib/paperRef";
import { LIBRARY_CHANGE_MAX } from "./sourceClient";

/** How long a write waits for others of its job, so they go in one call. */
const GATHER_MS = 5_000;

type Change = "add" | "remove";
type Collection = { libraryId: Id<"evidenceLibraries">; collection: string };

/** Queues a paper going into, or out of, a library collection; a later change of the same paper there replaces it. */
export async function queueLibraryWrite(ctx: MutationCtx, job: Doc<"screeningJobs">, result: Doc<"screeningResults">, change: Change, to: Collection) {
  const waiting = await ctx.db.query("libraryWrites").withIndex("by_job", (q) => q.eq("job", job._id)).first();
  for (const earlier of await ctx.db.query("libraryWrites").withIndex("by_result", (q) => q.eq("result", result._id)).take(4)) {
    if (earlier.collection === to.collection) await ctx.db.delete("libraryWrites", earlier._id);
  }
  await ctx.db.insert("libraryWrites", { job: job._id, result: result._id, change, libraryId: to.libraryId, collection: to.collection });
  if (!waiting) await ctx.scheduler.runAfter(GATHER_MS, internal.evidenceLibraries.sourceActions.flushWrites, { job: job._id, attempt: 0 });
}

const queuedValidator = v.object({
  id: v.id("libraryWrites"),
  result: v.id("screeningResults"),
  change: v.union(v.literal("add"), v.literal("remove")),
  libraryId: v.id("evidenceLibraries"),
  collection: v.string(),
  paperKey: v.string(),
  ref: paperRefValidator,
  crossRefs: v.optional(crossRefsValidator),
});

/** A batch of a job's waiting writes, with each paper's identity, and who writes them. */
export const batch = internalQuery({
  args: { job: v.id("screeningJobs") },
  returns: v.object({ userId: v.union(v.id("users"), v.null()), rows: v.array(queuedValidator), more: v.boolean() }),
  handler: async (ctx, { job }) => {
    const owner = await ctx.db.get("screeningJobs", job);
    const queued = await ctx.db.query("libraryWrites").withIndex("by_job", (q) => q.eq("job", job)).take(LIBRARY_CHANGE_MAX + 1);
    const rows = [];
    for (const row of queued.slice(0, LIBRARY_CHANGE_MAX)) {
      const result = await ctx.db.get("screeningResults", row.result);
      if (result?.paperKey && result.ref) rows.push({ id: row._id, result: row.result, change: row.change, libraryId: row.libraryId, collection: row.collection, paperKey: result.paperKey, ref: result.ref, ...(result.crossRefs ? { crossRefs: result.crossRefs } : {}) });
    }
    return { userId: owner?.createdBy ?? null, rows, more: queued.length > LIBRARY_CHANGE_MAX };
  },
});

/**
 * Records a batch written: each paper put into the job's library collection is `added`, or `missing` when the library
 * holds no record of it, and the job counts both. A refusal stops the job's writes and says why on it.
 */
export const written = internalMutation({
  args: {
    job: v.id("screeningJobs"),
    rows: v.array(v.object({ id: v.id("libraryWrites"), result: v.id("screeningResults"), write: v.optional(libraryWriteValidator) })),
    problem: v.optional(v.union(v.literal("role"), v.literal("notFound"), v.literal("unreadable"))),
  },
  returns: v.null(),
  handler: async (ctx, { job, rows, problem }) => {
    let added = 0;
    let missing = 0;
    for (const row of rows) {
      if (await ctx.db.get("libraryWrites", row.id)) await ctx.db.delete("libraryWrites", row.id);
      const result = row.write ? await ctx.db.get("screeningResults", row.result) : null;
      if (!result || !row.write || result.libraryWrite === row.write) continue;
      if (row.write === "added") added++;
      else missing++;
      if (result.libraryWrite === "added") added--;
      else if (result.libraryWrite === "missing") missing--;
      await ctx.db.patch("screeningResults", result._id, { libraryWrite: row.write });
    }
    const progress = await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", job)).unique();
    if (progress && (added || missing)) await ctx.db.patch("screeningJobProgress", progress._id, { libraryAdded: Math.max(0, (progress.libraryAdded ?? 0) + added), libraryMissing: Math.max(0, (progress.libraryMissing ?? 0) + missing) });
    if (problem && (await ctx.db.get("screeningJobs", job))) await ctx.db.patch("screeningJobs", job, { libraryWriteProblem: problem });
    return null;
  },
});
