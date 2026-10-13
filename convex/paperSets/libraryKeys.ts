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

/** Keys a page holds: a page is a few kilobytes. */
const KEYS_PAGE = 1_000;
/** Pages a cleanup step deletes. */
const DELETE_STEP = 20;

type Job = Id<"screeningJobs"> | Id<"extractionJobs">;
const jobValidator = v.union(v.id("screeningJobs"), v.id("extractionJobs"));

/** Keeps a job's keys, in their order. */
export async function keepKeys(ctx: MutationCtx, job: Job, keys: string[]) {
  for (let page = 0; page * KEYS_PAGE < keys.length; page++) await ctx.db.insert("paperSetKeys", { job, page, keys: keys.slice(page * KEYS_PAGE, (page + 1) * KEYS_PAGE) });
}

/** Deletes a step of a job's keys. Returns whether all are gone. */
export async function dropKeys(ctx: MutationCtx, job: Job) {
  const pages = await ctx.db.query("paperSetKeys").withIndex("by_job_and_page", (q) => q.eq("job", job)).take(DELETE_STEP);
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

/** A job's keys from `offset` (from 0), `count` of them at most. */
export const slice = internalQuery({
  args: { job: jobValidator, offset: v.number(), count: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, { job, offset, count }) => {
    const first = Math.floor(offset / KEYS_PAGE);
    const last = Math.floor((offset + Math.max(count, 1) - 1) / KEYS_PAGE);
    const pages = await ctx.db.query("paperSetKeys").withIndex("by_job_and_page", (q) => q.eq("job", job).gte("page", first).lte("page", last)).collect();
    return pages.flatMap((page) => page.keys).slice(offset - first * KEYS_PAGE, offset - first * KEYS_PAGE + count);
  },
});
