import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../../lib/functions";
import { createError } from "../../lib/errors";
import { screeningRevision } from "../../screening/accounting";
import { readScreeningProgressCounts } from "../../screening/progress";

/** Counts come from the owned job, never from the browser's bucket. */
export async function checkScreeningSelection(ctx: QueryCtx, userId: Id<"users">, jobId: Id<"screeningJobs">, revision: string) {
  const job = await ctx.db.get("screeningJobs", jobId);
  if (!job || job.userId !== userId) throw createError("NOT_FOUND", "Screening not found");
  if (job.status === "processing") throw createError("VALIDATION_ERROR", "This screening is still processing. Wait for it to finish before starting extraction.");
  if (revision !== await screeningRevision(ctx, job)) {
    throw createError("CONFLICT", "Screening decisions changed. Remove this source and select it again to review the current Included papers.");
  }
  const { qualifiedCount } = await readScreeningProgressCounts(ctx, job);
  if (qualifiedCount < 1) throw createError("VALIDATION_ERROR", "This screening has no Included papers.");
  return qualifiedCount;
}

export const check = internalQuery({
  args: { userId: v.id("users"), jobId: v.id("screeningJobs"), revision: v.string() },
  returns: v.number(),
  handler: (ctx, { userId, jobId, revision }) => checkScreeningSelection(ctx, userId, jobId, revision),
});
