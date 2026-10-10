/**
 * Who may reach an extraction job or paper: the one place that says so for queries and
 * mutations alike. A job opened by its ID is open to anyone who can act in its workspace
 * (#650); a function given the page's workspace takes only that workspace's jobs.
 *
 * A job can be shared with someone outside its workspace, to view (#653). The reads a guest has
 * go through `resolveJobToRead`, `jobToRead` and `resolvePaperToRead`, which also say whether
 * the reader is one; what a job costs, and every change to it, stay on the owned checks.
 */

import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import { createError } from "../lib/errors";
import { noAccess, ok, unauthenticated } from "../lib/query_states";
import { v } from "convex/values";
import { countOf } from "../lib/listCounts";
import { grantOf, guestRole, itemGuestsOf, open } from "../sharing/items";
import { guestRoleValidator, sharedFromValidator, type GuestRole } from "../sharing/validators";
import { actorIn, type Actor, type InWorkspace } from "../workspaces/actor";
import { workspaceFrom } from "../workspaces/personal";

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

/** What a person outside the job's workspace was given it to do, while that workspace is still anyone's to open; null when they weren't. */
const givenTo = async (ctx: QueryCtx, user: Doc<"users">, job: Doc<"extractionJobs">) => {
  const role = (await grantOf(ctx, job._id, user._id))?.role;
  return role && (await open(ctx, job.workspaceId)) ? role : null;
};

/**
 * A job as its reader is sent it. A guest isn't told what it holds and may spend, which chat
 * started it or where its setup stands: those are its workspace's. Nor why it ran out of
 * credits, whose words give the figure it was allowed (./paperWorker.ts): its status says it did.
 */
export function jobFor(job: Doc<"extractionJobs">, guest: boolean): Doc<"extractionJobs"> {
  if (!guest) return job;
  const { spendHold: _hold, spendCap: _cap, chatStep: _chat, setup: _setup, error, ...shown } = job;
  return error && error.code !== "insufficient_credits" ? { ...shown, error: said(error) } : shown;
}

/** An error as a guest is sent it: what went wrong, without the diagnostics kept beside it. */
const said = <Failure extends { context?: unknown }>({ context: _context, ...failure }: Failure) => failure as Failure;

/**
 * A paper or an answer as its reader is sent it. What it cost, the ID of the record a paper
 * came from and its last error's diagnostics are its workspace's.
 */
export function rowFor<Row extends { creditsUsed?: number; sourceId?: string; lastError?: { context?: unknown } }>(row: Row, guest: boolean): Row {
  if (!guest) return row;
  const { creditsUsed: _credits, sourceId: _source, lastError, ...shown } = row;
  return (lastError ? { ...shown, lastError: said(lastError) } : shown) as Row;
}

export type ReadableJobResolution =
  | { status: "ok"; user: Doc<"users">; job: Doc<"extractionJobs">; guest: GuestRole | null }
  | { status: "unauthenticated" }
  | { status: "no_access" };

/** A job opened by its ID, for someone who may read it: a member of its workspace, or a guest of it. */
export async function resolveJobToRead(ctx: QueryCtx, jobId: Id<"extractionJobs">): Promise<ReadableJobResolution> {
  const user = await getCurrentUser(ctx);
  if (!user) return unauthenticated();
  const job = await ctx.db.get("extractionJobs", jobId);
  if (!job) return noAccess();
  if (await actorIn(ctx, user, job.workspaceId)) return ok({ user, job, guest: null });
  const guest = await givenTo(ctx, user, job);
  return guest ? ok({ user, job: jobFor(job, true), guest }) : noAccess();
}

/**
 * The job for a read given the page's workspace: that workspace's own, or one shared with the
 * person, who then acts in their own workspace. `guest` is their role in it, null for a member. Else null.
 */
export async function jobToRead(ctx: QueryCtx, actor: InWorkspace, jobId: Id<"extractionJobs">) {
  const job = await ctx.db.get("extractionJobs", jobId);
  if (!job) return null;
  if (job.workspaceId === actor.workspaceId) return { job, guest: null };
  const guest = await guestRole(ctx, actor, job);
  return guest ? { job: jobFor(job, true), guest } : null;
}

/** A paper opened by its ID, for someone who may read its job. */
export async function resolvePaperToRead(ctx: QueryCtx, paperId: Id<"extractionPapers">) {
  const user = await getCurrentUser(ctx);
  if (!user) return unauthenticated();
  const paper = await ctx.db.get("extractionPapers", paperId);
  const job = paper ? await ctx.db.get("extractionJobs", paper.jobId) : null;
  if (!paper || !job) return noAccess();
  if (await actorIn(ctx, user, job.workspaceId)) return ok({ user, job, paper, guest: null });
  const guest = await givenTo(ctx, user, job);
  return guest ? ok({ user, job: jobFor(job, true), paper: rowFor(paper, true), guest }) : noAccess();
}

/** How a job is shared, as its page and the assistant are told: for its workspace's members, how many guests it has; for a guest, what they may do and whose it is. */
export const sharingValidators = { guests: v.optional(v.number()), guest: v.optional(v.object({ role: guestRoleValidator, from: sharedFromValidator })) };
export async function sharingOf(ctx: QueryCtx, job: Doc<"extractionJobs">, guest: GuestRole | null) {
  return guest ? { guest: { role: guest, from: await workspaceFrom(ctx, job.workspaceId) } } : { guests: await countOf(ctx, itemGuestsOf(job._id)) };
}
