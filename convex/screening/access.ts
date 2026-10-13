import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { guestRole } from "../sharing/items";
import type { InWorkspace } from "../workspaces/actor";

/**
 * A screening job for someone who may read it: a member of its workspace acting there, or a
 * guest of it acting in their own workspace (#653). Null for anyone else, who learns nothing
 * of it. Changing a job stays its workspace's members'.
 */
export async function readableJob(ctx: Pick<QueryCtx, "db">, actor: InWorkspace, jobId: Id<"screeningJobs">): Promise<Doc<"screeningJobs"> | null> {
  const job = await ctx.db.get("screeningJobs", jobId);
  if (!job) return null;
  return job.workspaceId === actor.workspaceId || (await guestRole(ctx, actor, job)) ? job : null;
}

/** A job's result for a paper, by its key. */
export async function resultOf(ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">, key: string) {
  return await ctx.db.query("screeningResults").withIndex("by_job_paperKey", (q) => q.eq("jobId", jobId).eq("paperKey", key)).first();
}
