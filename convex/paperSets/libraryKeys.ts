/**
 * The record keys a job reads from an Evidence Library (plans/evidence-library-sources): the
 * library turns its source into keys once, when the job starts, and the job reads them a page at
 * a time from here, so records added to or taken from the source meanwhile change nothing.
 */
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../lib/functions";
import { LIBRARY_SOURCE_MAX } from "../../lib/evidence-libraries/source-address";
import { MAX_LIST_CAP } from "../lib/listCaps";
import { TERMINAL_JOB_STATUSES, type JobStatus } from "../extraction/stateMachine";

/** Keys a page holds: a page is a few kilobytes. */
const KEYS_PAGE = MAX_LIST_CAP;
/** Pages one source's keys take at most: a source gives at most LIBRARY_SOURCE_MAX keys. */
const KEYS_PAGES = Math.ceil(LIBRARY_SOURCE_MAX / KEYS_PAGE);
/** Keys one call to a library, or one write here, carries at most: a Convex array holds 8,192 values. */
export const LIBRARY_KEYS_WINDOW = 5 * KEYS_PAGE;
/** Pages a cleanup step deletes. */
const DELETE_STEP = 20;

type Job = Id<"screeningJobs"> | Id<"extractionJobs">;
const jobValidator = v.union(v.id("screeningJobs"), v.id("extractionJobs"));

/** Keeps a window of a job's keys for one of its sources (`part`, its place among the job's sources), from the source's key `from` (from 0, a page's first), in their order. */
export async function keepKeys(ctx: MutationCtx, job: Job, keys: string[], part = 0, from = 0) {
  if (keys.length > LIBRARY_KEYS_WINDOW || from % KEYS_PAGE !== 0 || (from + keys.length) > KEYS_PAGES * KEYS_PAGE) throw new Error(`A job keeps at most ${LIBRARY_SOURCE_MAX} keys of a source, ${LIBRARY_KEYS_WINDOW} at a time.`);
  for (let page = 0; page * KEYS_PAGE < keys.length; page++) await ctx.db.insert("paperSetKeys", { job, part, page: from / KEYS_PAGE + page, keys: keys.slice(page * KEYS_PAGE, (page + 1) * KEYS_PAGE) });
}

/** Deletes a step of a job's keys. Returns whether all are gone. */
export async function dropKeys(ctx: MutationCtx, job: Job) {
  const pages = await ctx.db.query("paperSetKeys").withIndex("by_job_and_part_and_page", (q) => q.eq("job", job)).take(DELETE_STEP);
  for (const page of pages) await ctx.db.delete("paperSetKeys", page._id);
  return pages.length < DELETE_STEP;
}

/** Drops a job's keys once it has read them, a step a transaction. */
export const drop = internalMutation({
  args: { job: jobValidator },
  returns: v.null(),
  handler: async (ctx, { job }) => {
    if (!(await dropKeys(ctx, job))) await ctx.scheduler.runAfter(0, internal.paperSets.libraryKeys.drop, { job });
    return null;
  },
});

/** Whether an extraction's setup run `epoch` is still the one going on: a job stopped, ended or set off again since has another. */
async function runGoesOn(ctx: MutationCtx, job: Id<"extractionJobs">, epoch: number) {
  const row = await ctx.db.get("extractionJobs", job);
  return row !== null && (row.runEpoch ?? 0) === epoch && !TERMINAL_JOB_STATUSES.has(row.status as JobStatus);
}

/** Drops an extraction's keys once its setup run `epoch` has read them, or failed: never the keys of a run that took its place. */
export const dropRun = internalMutation({
  args: { job: v.id("extractionJobs"), epoch: v.number() },
  returns: v.null(),
  handler: async (ctx, { job, epoch }) => {
    const row = await ctx.db.get("extractionJobs", job);
    if (row && (row.runEpoch ?? 0) !== epoch) return null;
    if (!(await dropKeys(ctx, job))) await ctx.scheduler.runAfter(0, internal.paperSets.libraryKeys.drop, { job });
    return null;
  },
});

/**
 * Keeps a window of a job's keys for one source, from key `from` (from 0) on. The first window starts the source's
 * keys afresh, so a start tried again never mixes two answers of the library. An extraction's are kept only while
 * its setup run `epoch` goes on: says whether they were kept.
 */
export const keep = internalMutation({
  args: { job: jobValidator, epoch: v.optional(v.number()), part: v.number(), from: v.number(), keys: v.array(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, { job, epoch, part, from, keys }) => {
    const extraction = ctx.db.normalizeId("extractionJobs", job);
    if (extraction && (epoch === undefined || !(await runGoesOn(ctx, extraction, epoch)))) return false;
    if (from === 0) for (const page of await ctx.db.query("paperSetKeys").withIndex("by_job_and_part_and_page", (q) => q.eq("job", job).eq("part", part)).take(KEYS_PAGES)) await ctx.db.delete("paperSetKeys", page._id);
    await keepKeys(ctx, job, keys, part, from);
    return true;
  },
});

/** A job's keys of one source from `offset` (from 0), `count` of them at most. */
export const slice = internalQuery({
  args: { job: jobValidator, part: v.optional(v.number()), offset: v.number(), count: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, { job, part = 0, offset, count }) => {
    const first = Math.floor(offset / KEYS_PAGE);
    const last = Math.floor((offset + Math.max(count, 1) - 1) / KEYS_PAGE);
    const pages = await ctx.db.query("paperSetKeys").withIndex("by_job_and_part_and_page", (q) => q.eq("job", job).eq("part", part).gte("page", first).lte("page", last)).take(KEYS_PAGES);
    return pages.flatMap((page) => page.keys).slice(offset - first * KEYS_PAGE, offset - first * KEYS_PAGE + count);
  },
});
