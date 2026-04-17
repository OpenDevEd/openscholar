/**
 * Extraction ownership helpers — single source of truth for "does the
 * current user own this job / paper" checks. Used by both queries and
 * mutations so the auth shape stays consistent across read and write
 * paths.
 */

import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import { createError } from "../lib/errors";
import { noAccess, ok, unauthenticated } from "../lib/query_states";

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
  if (!job || job.userId !== user._id) return noAccess();

  return ok({ user, job });
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
  if (!job || job.userId !== user._id) return noAccess();

  return ok({ user, job, paper });
}

/**
 * Mutation-side ownership check — throws NOT_FOUND (not FORBIDDEN, to
 * avoid leaking existence) when the job does not belong to `userId`.
 */
export async function assertJobOwnership(
  ctx: MutationCtx,
  userId: Id<"users">,
  jobId: Id<"extractionJobs">,
): Promise<Doc<"extractionJobs">> {
  const job = await ctx.db.get("extractionJobs", jobId);
  if (!job || job.userId !== userId) {
    throw createError("NOT_FOUND", "Job not found");
  }
  return job;
}
