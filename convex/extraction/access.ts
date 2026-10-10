/**
 * Who may reach an extraction job or paper: the one place that says so for queries and
 * mutations alike. A job opened by its ID is open to anyone who can act in its workspace
 * (#650); a function given the page's workspace takes only that workspace's jobs.
 */

import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import { createError } from "../lib/errors";
import { noAccess, ok, unauthenticated } from "../lib/query_states";
import { actorIn, type Actor } from "../workspaces/actor";

export type OwnedJobResolution =
  | { status: "ok"; user: Doc<"users">; job: Doc<"extractionJobs"> }
  | { status: "unauthenticated" }
  | { status: "no_access" };

export async function resolveOwnedJob(
  ctx: QueryCtx,
  jobId: Id<"extractionJobs">,
): Promise<OwnedJobResolution> {
  const user = await getCurrentUser(ctx);
  if (!user) return unauthenticated();

  const job = await ctx.db.get("extractionJobs", jobId);
  if (!job || !(await actorIn(ctx, user, job.workspaceId))) return noAccess();

  return ok({ user, job });
}

/** The job when it's in `workspaceId`, the workspace a user action runs in; else null. */
export async function ownJob(ctx: QueryCtx, workspaceId: Id<"workspaces">, jobId: Id<"extractionJobs">) {
  const job = await ctx.db.get("extractionJobs", jobId);
  return job && (job.workspaceId === workspaceId) ? job : null;
}

export type OwnedPaperResolution =
  | {
      status: "ok";
      user: Doc<"users">;
      job: Doc<"extractionJobs">;
      paper: Doc<"extractionPapers">;
    }
  | { status: "unauthenticated" }
  | { status: "no_access" };

export async function resolveOwnedPaper(
  ctx: QueryCtx,
  paperId: Id<"extractionPapers">,
): Promise<OwnedPaperResolution> {
  const user = await getCurrentUser(ctx);
  if (!user) return unauthenticated();

  const paper = await ctx.db.get("extractionPapers", paperId);
  if (!paper) return noAccess();

  const job = await ctx.db.get("extractionJobs", paper.jobId);
  if (!job || !(await actorIn(ctx, user, job.workspaceId))) return noAccess();

  return ok({ user, job, paper });
}

/**
 * Mutation-side check: the job, and `user` acting on it in its workspace. Throws NOT_FOUND
 * (not FORBIDDEN, so nobody outside the workspace learns the job exists) when they can't.
 */
export async function assertJobAccess(
  ctx: MutationCtx,
  user: Doc<"users">,
  jobId: Id<"extractionJobs">,
): Promise<{ job: Doc<"extractionJobs">; actor: Actor }> {
  const job = await ctx.db.get("extractionJobs", jobId);
  const actor = job && (await actorIn(ctx, user, job.workspaceId));
  if (!job || !actor) throw createError("NOT_FOUND", "Job not found");
  return { job, actor };
}
