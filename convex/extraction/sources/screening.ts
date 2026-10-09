import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../../lib/functions";
import { createError } from "../../lib/errors";
import { screeningRevision } from "../../screening/accounting";
import { readScreeningProgressCounts } from "../../screening/progress";
import { isInWorkspace, personalWorkspaceOf } from "../../workspaces/personal";

/** Counts come from the workspace's own job, never from the browser's bucket. */
export async function checkScreeningSelection(ctx: QueryCtx, workspaceId: Id<"workspaces">, jobId: Id<"screeningJobs">, revision: string) {
  const job = await ctx.db.get("screeningJobs", jobId);
  if (!job || !(await isInWorkspace(ctx, job, workspaceId))) throw createError("NOT_FOUND", "Screening not found");
  if (job.status === "processing") throw createError("VALIDATION_ERROR", "This screening is still processing. Wait for it to finish before starting extraction.");
  if (revision !== await screeningRevision(ctx, job)) {
    throw createError("CONFLICT", "Screening decisions changed. Remove this source and select it again to review the current Included papers.");
  }
  const { qualifiedCount } = await readScreeningProgressCounts(ctx, job);
  if (qualifiedCount < 1) throw createError("VALIDATION_ERROR", "This screening has no Included papers.");
  return qualifiedCount;
}

export const check = internalQuery({
  // `workspaceId` is optional only for a call from an action already running when this deployed (#650), which reads its person's own; required again in slice 8.
  args: { userId: v.id("users"), workspaceId: v.optional(v.id("workspaces")), jobId: v.id("screeningJobs"), revision: v.string() },
  returns: v.number(),
  handler: async (ctx, { userId, workspaceId, jobId, revision }) => checkScreeningSelection(ctx, workspaceId ?? (await personalWorkspaceOf(ctx, userId)), jobId, revision),
});
