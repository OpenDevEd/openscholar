/**
 * Starting a look in a screening's sources, and what tells two records for one paper (plans/screening-reviewers).
 * Kept apart from the reading itself (./gathering.ts), which loads the search reader with everything it brings:
 * the many queries and mutations that start a look, or ask where the next paper goes, load none of it.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../lib/functions";
import { normalDoi } from "../../lib/papers/paper-ref";
import { plainTitle } from "../../lib/papers/paper-ref";
import { firstCheck } from "./dealing";

/** How long a check may go without a step before its reading is set off again (./gathering.ts `watch`). */
export const QUIET_MS = 15 * 60_000;

/** What makes two records one paper where their sources name them differently: the DOI, then the title with the year. */
export const doiKeyOf = (doi: string | undefined | null) => normalDoi(doi) ?? undefined;
export const titleKeyOf = (title: string, year: number | undefined) => `${plainTitle(title)}|${year ?? ""}`;

/**
 * Has a screening that isn't started yet read the sources it was just given. They all belong to its first look: the
 * one it has goes on where it ended, so none of its papers counts as one a later check brought.
 */
export async function readOn(ctx: MutationCtx, job: Doc<"screeningJobs">, by: Id<"users">) {
  const check = await firstCheck(ctx, job._id);
  if (!check) return void (await startCheck(ctx, job, by));
  if (check.state === "running") return;
  // Read anew as a run of its own: a reader still out from before it ended writes nothing.
  const run = (check.run ?? 0) + 1;
  await ctx.db.patch("screeningChecks", check._id, { state: "running", endedAt: undefined, beat: Date.now(), run });
  await ctx.db.patch("screeningJobs", job._id, { reading: true });
  await ctx.scheduler.runAfter(0, internal.screening.gathering.gather, { checkId: check._id, run });
  await ctx.scheduler.runAfter(QUIET_MS, internal.screening.gathering.watch, { checkId: check._id, restarts: 0 });
}

/** The place after the last paper a screening has, whichever look placed it: where the next paper goes, and how many it has had. */
export const nextPlace = async (ctx: Pick<MutationCtx, "db">, jobId: Id<"screeningJobs">) =>
  ((await ctx.db.query("screeningResults").withIndex("by_job_and_place", (q) => q.eq("jobId", jobId)).order("desc").first())?.place ?? -1) + 1;

/** Starts a look in a screening's sources: every source that isn't taken out is read again from where it stands. */
export async function startCheck(ctx: MutationCtx, job: Doc<"screeningJobs">, by: Id<"users"> | undefined, search = false) {
  // One look at a time: a look under way reads what was added too. A new one starts after every paper the screening has, read now rather than from what the caller held.
  const running = await ctx.db.query("screeningChecks").withIndex("by_job_and_state", (q) => q.eq("jobId", job._id).eq("state", "running")).first();
  if (running) return running._id;
  const from = Math.max((await ctx.db.get("screeningJobs", job._id))?.totalPapers ?? job.totalPapers, await nextPlace(ctx, job._id));
  const checkId = await ctx.db.insert("screeningChecks", { jobId: job._id, at: Date.now(), ...(by ? { by } : {}), ...(search ? { search } : {}), state: "running", from, found: 0, added: 0, beat: Date.now() });
  // Papers are arriving while it reads, whichever look it is: a check asked for meanwhile joins it.
  await ctx.db.patch("screeningJobs", job._id, { reading: true });
  await ctx.scheduler.runAfter(0, internal.screening.gathering.gather, { checkId, run: 0 });
  await ctx.scheduler.runAfter(QUIET_MS, internal.screening.gathering.watch, { checkId, restarts: 0 });
  return checkId;
}
