/**
 * Looking in a screening's sources again (plans/screening-reviewers): by hand, and for a living screening on its
 * schedule. A check reads each source that gains papers again from its start, and only the papers the screening
 * doesn't have join it, at the end of the round (./gathering.ts). A file or a pasted list holds what it held.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { internalMutation } from "../lib/functions";
import { workspaceMutation } from "../lib/userActions";
import { requireMember } from "./access";
import { reviewersOf, sourcesOf } from "./dealing";
import { startCheck } from "./gathering";
import { logChange } from "./log";
import { EVERY_MS } from "./screenings";

/** The kinds of source that gain papers over time. */
const GROWS = new Set(["search", "collection", "saved", "screening", "evidenceLibrary", "zotero"]);
export const grows = (source: Doc<"screeningSources">) => source.removedAt === undefined && GROWS.has(source.set.kind);

/** Starts a check of a screening's growing sources, unless one is under way or it has none. Says whether it did. */
export async function check(ctx: MutationCtx, job: Doc<"screeningJobs">, by: Id<"users"> | undefined) {
  if (await ctx.db.query("screeningChecks").withIndex("by_job_and_state", (q) => q.eq("jobId", job._id).eq("state", "running")).first()) return false;
  const sources = (await sourcesOf(ctx, job._id)).filter(grows);
  if (!sources.length) return false;
  // Read again from its start, as it stands now: what it had merged and left out is counted again as it is read.
  for (const source of sources) await ctx.db.patch("screeningSources", source._id, { state: "waiting", read: 0, resume: undefined, snapshot: undefined, failure: undefined, duplicates: 0, left: 0 });
  await startCheck(ctx, job, by, job.totalPapers);
  return true;
}

/**
 * Looks in a screening's sources again now for papers they gained since it last looked: a search, a collection, the
 * library, another screening's included papers, a community or a Zotero library. The new ones join the screening and
 * go to its reviewers. A finished screening that gains papers is open again.
 */
export const checkNow = workspaceMutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, actor, { jobId }) => {
    const job = await requireMember(ctx, actor, jobId);
    if (job.reading) throw createError("CONFLICT", "Its papers are still arriving.");
    await check(ctx, job, actor.userId);
    return null;
  },
});

/** Screenings one run of the schedule starts a check for. */
const DUE = 25;

/** The living screenings whose next check is due: each is checked, and its next check set. Run every hour (../crons.ts). */
export const due = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const jobs = await ctx.db.query("screeningJobs").withIndex("by_living_next", (q) => q.gt("living.next", 0).lte("living.next", now)).take(DUE);
    for (const job of jobs) {
      if (!job.living) continue;
      await ctx.db.patch("screeningJobs", job._id, { living: { ...job.living, next: now + EVERY_MS[job.living.every] } });
      if (job.finishedAt === undefined && !job.reading) await check(ctx, job, undefined);
    }
    // More than one run's worth were due: the rest follow at once.
    if (jobs.length === DUE) await ctx.scheduler.runAfter(0, internal.screening.living.due, {});
    return null;
  },
});

/** What a check that has ended leaves behind: its note in the screening's activity, an email to the people the new papers went to, and a finished screening open again. */
export async function checked(ctx: MutationCtx, job: Doc<"screeningJobs">, check: Doc<"screeningChecks">) {
  if (check.from === 0) return;
  const now = Date.now();
  if (check.added && job.finishedAt !== undefined) {
    await ctx.db.patch("screeningJobs", job._id, { finishedAt: undefined, status: "processing", completedAt: undefined, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.screening.readings.release, { jobId: job._id, cursor: null });
  }
  await logChange(ctx, { userId: check.by ?? job.createdBy }, job, check.by ? "checked" : "scheduledCheck", { count: check.found, more: [...(check.found !== check.added ? [{ code: "known", count: check.found - check.added }] : []), ...(check.added ? [{ code: "joined", count: check.added }] : []), ...(check.added && job.finishedAt !== undefined ? [{ code: "reopened" }] : [])] });
  if (!check.added) return;
  for (const reviewer of await reviewersOf(ctx, job._id)) {
    if (reviewer.kind === "person" && reviewer.userId && reviewer.left === undefined) await ctx.scheduler.runAfter(0, internal.screening.noticeMail.send, { jobId: job._id, userId: reviewer.userId, about: "papers" });
  }
}
