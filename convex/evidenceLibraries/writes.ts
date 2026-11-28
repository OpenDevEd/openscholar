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
import { libraryWriteProblemValidator, libraryWriteValidator } from "../screening/validators";
import { paperRefValidator, crossRefsValidator } from "../lib/paperRef";
import { LIBRARY_CHANGE_MAX } from "../../lib/evidence-libraries/reader-sources";

/** How long a write waits for others of its job, so they go in one call. */
const GATHER_MS = 5_000;

type Change = "add" | "remove";
type Collection = { libraryId: Id<"evidenceLibraries">; collection: string };

/** Queues a paper going into, or out of, a library collection; a later change of the same paper there replaces it. `prune` marks a move out of, or back into, the collection the job read. */
export async function queueLibraryWrite(ctx: MutationCtx, job: Doc<"screeningJobs">, result: Doc<"screeningResults">, change: Change, to: Collection, { prune = false } = {}) {
  const waiting = await ctx.db.query("libraryWrites").withIndex("by_job", (q) => q.eq("job", job._id)).first();
  for (const earlier of await ctx.db.query("libraryWrites").withIndex("by_result", (q) => q.eq("result", result._id)).take(4)) {
    if (earlier.collection === to.collection) await ctx.db.delete("libraryWrites", earlier._id);
  }
  await ctx.db.insert("libraryWrites", { job: job._id, result: result._id, change, libraryId: to.libraryId, collection: to.collection, ...(prune ? { prune: true as const } : {}) });
  if (!waiting) await ctx.scheduler.runAfter(GATHER_MS, internal.evidenceLibraries.sourceActions.flushWrites, { job: job._id });
}

/**
 * A paper that no longer stands included stops counting as one its library collection didn't take: the collection
 * keeps what went in, as a workspace collection keeps a paper saved to it, but lists none it never held.
 */
export async function forgetMissing(ctx: MutationCtx, job: Doc<"screeningJobs">, result: Doc<"screeningResults">) {
  if (result.libraryWrite !== "missing" || result.qualified === true) return;
  await ctx.db.patch("screeningResults", result._id, { libraryWrite: undefined });
  const progress = await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", job._id)).unique();
  if (progress?.libraryMissing) await ctx.db.patch("screeningJobProgress", progress._id, { libraryMissing: progress.libraryMissing - 1 });
}

const queuedValidator = v.object({
  id: v.id("libraryWrites"),
  result: v.id("screeningResults"),
  change: v.union(v.literal("add"), v.literal("remove")),
  libraryId: v.id("evidenceLibraries"),
  collection: v.string(),
  prune: v.boolean(),
  attempts: v.number(),
  paperKey: v.string(),
  ref: paperRefValidator,
  crossRefs: v.optional(crossRefsValidator),
});

/** A batch of a job's waiting writes, with each paper's identity, who writes them, the collection its included papers go to, and writes whose paper is gone. */
export const batch = internalQuery({
  args: { job: v.id("screeningJobs") },
  returns: v.object({
    userId: v.union(v.id("users"), v.null()),
    destination: v.union(v.object({ libraryId: v.id("evidenceLibraries"), collection: v.string() }), v.null()),
    rows: v.array(queuedValidator),
    gone: v.array(v.object({ id: v.id("libraryWrites"), result: v.id("screeningResults") })),
    more: v.boolean(),
  }),
  handler: async (ctx, { job }) => {
    const owner = await ctx.db.get("screeningJobs", job);
    const queued = await ctx.db.query("libraryWrites").withIndex("by_job", (q) => q.eq("job", job)).take(LIBRARY_CHANGE_MAX + 1);
    const rows = [];
    const gone = [];
    for (const row of queued.slice(0, LIBRARY_CHANGE_MAX)) {
      const result = await ctx.db.get("screeningResults", row.result);
      if (owner && result?.paperKey && result.ref) rows.push({ id: row._id, result: row.result, change: row.change, libraryId: row.libraryId, collection: row.collection, prune: row.prune === true, attempts: row.attempts ?? 0, paperKey: result.paperKey, ref: result.ref, ...(result.crossRefs ? { crossRefs: result.crossRefs } : {}) });
      else gone.push({ id: row._id, result: row.result });
    }
    const destination = owner?.libraryDestination ? { libraryId: owner.libraryDestination.libraryId, collection: owner.libraryDestination.collection } : null;
    return { userId: owner?.createdBy ?? null, destination, rows, gone, more: queued.length > LIBRARY_CHANGE_MAX };
  },
});

/**
 * Records a batch written, and says whether the job has writes still waiting, queued while this batch was out: each
 * paper put into the job's library collection is `added`, or `missing` when the library holds no record of it, and
 * the job counts both; `removed` is what the batch confirmed out of, or back into, the collection the job prunes. A
 * refusal stops those writes and says why on the job.
 */
export const written = internalMutation({
  args: {
    job: v.id("screeningJobs"),
    rows: v.array(v.object({ id: v.id("libraryWrites"), result: v.id("screeningResults"), write: v.optional(libraryWriteValidator) })),
    removed: v.optional(v.number()),
    // Writes whose library didn't answer, to be asked again.
    retried: v.optional(v.array(v.id("libraryWrites"))),
    problem: v.optional(libraryWriteProblemValidator),
    pruneProblem: v.optional(libraryWriteProblemValidator),
  },
  returns: v.boolean(),
  handler: async (ctx, { job, rows, removed = 0, retried = [], problem, pruneProblem }) => {
    for (const id of retried) {
      const row = await ctx.db.get("libraryWrites", id);
      if (row) await ctx.db.patch("libraryWrites", id, { attempts: (row.attempts ?? 0) + 1 });
    }
    let added = 0;
    let missing = 0;
    for (const row of rows) {
      if (await ctx.db.get("libraryWrites", row.id)) await ctx.db.delete("libraryWrites", row.id);
      const result = row.write ? await ctx.db.get("screeningResults", row.result) : null;
      // One left out since it was queued isn't listed as missing from the collection.
      if (!result || !row.write || result.libraryWrite === row.write || (row.write === "missing" && result.qualified !== true)) continue;
      if (row.write === "added") added++;
      else missing++;
      if (result.libraryWrite === "added") added--;
      else if (result.libraryWrite === "missing") missing--;
      await ctx.db.patch("screeningResults", result._id, { libraryWrite: row.write });
    }
    const progress = await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", job)).unique();
    if (progress && (added || missing || removed)) {
      await ctx.db.patch("screeningJobProgress", progress._id, {
        libraryAdded: Math.max(0, (progress.libraryAdded ?? 0) + added),
        libraryMissing: Math.max(0, (progress.libraryMissing ?? 0) + missing),
        ...(removed ? { removed: Math.max(0, (progress.removed ?? 0) + removed) } : {}),
      });
    }
    // A problem is kept until a later write gets through: then the screening stops saying papers aren't reaching the community.
    const cleared = { ...(!problem && added ? { libraryWriteProblem: undefined } : {}), ...(!pruneProblem && removed ? { libraryPruneProblem: undefined } : {}) };
    if ((problem || pruneProblem || Object.keys(cleared).length) && (await ctx.db.get("screeningJobs", job))) await ctx.db.patch("screeningJobs", job, { ...cleared, ...(problem ? { libraryWriteProblem: problem } : {}), ...(pruneProblem ? { libraryPruneProblem: pruneProblem } : {}) });
    return (await ctx.db.query("libraryWrites").withIndex("by_job", (q) => q.eq("job", job)).first()) !== null;
  },
});
