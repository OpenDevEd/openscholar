import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { guestRole } from "../sharing/items";
import type { InWorkspace } from "../workspaces/actor";
import { createError } from "../lib/errors";

/**
 * A screening job for someone who may read it: a member of its workspace acting there, or a
 * guest of it acting in their own workspace (#653). Null for anyone else, who learns nothing
 * of it. Changing a job stays its workspace's members'. A screening with reviewers is read by its own pages alone
 * (./paperViews.ts), which keep the others' votes from a reviewer while a paper waits for theirs: null here.
 */
export async function readableJob(ctx: Pick<QueryCtx, "db">, actor: InWorkspace, jobId: Id<"screeningJobs">): Promise<Doc<"screeningJobs"> | null> {
  const job = await ctx.db.get("screeningJobs", jobId);
  if (!job || job.shape === 2) return null;
  return job.workspaceId === actor.workspaceId || (await guestRole(ctx, actor, job)) ? job : null;
}

/** A job's result for a paper, by its key. */
export async function resultOf(ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">, key: string) {
  return await ctx.db.query("screeningResults").withIndex("by_job_paperKey", (q) => q.eq("jobId", jobId).eq("paperKey", key)).first();
}

/**
 * What someone is to a screening with reviewers (plans/screening-reviewers). A member of its workspace sees it and
 * changes it, and votes where they are one of its reviewers. Someone from outside has it only once it is shared with
 * them, while they act in their own workspace: to vote, as a guest who edits, or to look. Null for anyone else.
 */
export type Standing = { job: Doc<"screeningJobs">; member: boolean; guest: "viewer" | "editor" | null; reviewer: Doc<"screeningReviewers"> | null };
export async function standingOn(ctx: Pick<QueryCtx, "db">, actor: InWorkspace, jobId: Id<"screeningJobs">): Promise<Standing | null> {
  const job = await ctx.db.get("screeningJobs", jobId);
  if (!job) return null;
  const member = job.workspaceId === actor.workspaceId;
  const guest = member ? null : await guestRole(ctx, actor, job);
  if (!member && !guest) return null;
  const row = await ctx.db.query("screeningReviewers").withIndex("by_job_and_user", (q) => q.eq("jobId", jobId).eq("userId", actor.userId)).first();
  // A guest votes only while their place lets them: one whose role went back to looking keeps their row and loses their vote.
  const reviewer = row && row.left === undefined && (member || guest === "editor") ? row : null;
  return { job, member, guest, reviewer };
}

const GONE = "Screening not found";
/** The screening, for a member of its workspace: only they change it. Anyone else learns nothing of it. */
export async function requireMember(ctx: Pick<QueryCtx, "db">, actor: InWorkspace, jobId: Id<"screeningJobs">) {
  const job = await ctx.db.get("screeningJobs", jobId);
  if (!job || job.workspaceId !== actor.workspaceId || job.shape !== 2) throw createError("SCREENING_JOB_NOT_FOUND", GONE);
  return job;
}
/** The screening and the place of whoever votes on it. */
export async function requireReviewer(ctx: Pick<QueryCtx, "db">, actor: InWorkspace, jobId: Id<"screeningJobs">) {
  const standing = await standingOn(ctx, actor, jobId);
  if (!standing || standing.job.shape !== 2) throw createError("SCREENING_JOB_NOT_FOUND", GONE);
  if (!standing.reviewer) throw createError("FORBIDDEN", "Only this screening's reviewers vote on its papers.");
  if (standing.job.finishedAt !== undefined) throw createError("CONFLICT", "This screening is finished. Reopen it to vote.");
  return { ...standing, reviewer: standing.reviewer };
}
