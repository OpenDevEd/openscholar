import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

/**
 * Backfill: every extractionJobs row predates the mode column. Flag them
 * as "extraction" so reads that branch on mode don't crash on undefined.
 *
 * Run once via:
 *   npx convex run migrations/setExistingJobsToExtractionMode:run
 *
 * Idempotent — re-running is a no-op once all rows carry a mode.
 *
 * Paginates with take(500) + scheduler.runAfter(0) so a single invocation
 * stays inside Convex's transaction budget regardless of table size.
 * Mirrors the existing cleanupOldPdfs cron pattern.
 */
export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ patched: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("extractionJobs")
      .paginate({ numItems: 500, cursor: cursor ?? null });

    let patched = 0;
    for (const job of page.page) {
      if (job.mode === undefined) {
        await ctx.db.patch(job._id, { mode: "extraction" });
        patched += 1;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.setExistingJobsToExtractionMode.run,
        { cursor: page.continueCursor },
      );
    }

    return { patched, isDone: page.isDone };
  },
});
