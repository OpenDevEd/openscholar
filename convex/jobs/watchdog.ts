/**
 * Universal Job System - Watchdog
 *
 * Cron-triggered mutation that:
 * 1. Times out stale jobs that exceeded jobTimeoutMs
 * 2. Spawns recovery workers for stale claimed items
 * 3. Starts pending jobs whose dependencies completed
 */
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

/**
 * Watchdog mutation - called by cron every minute.
 * Ensures the job system remains healthy and recovers from failures.
 */
export const watchdog = internalMutation({
  args: {},
  returns: v.object({
    timedOutJobs: v.number(),
    recoveredItems: v.number(),
    startedDependentJobs: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    let timedOutJobs = 0;
    let recoveredItems = 0;
    let startedDependentJobs = 0;

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Time out stale jobs
    // ═══════════════════════════════════════════════════════════════

    const runningJobs = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();

    for (const job of runningJobs) {
      // Check if job exceeded timeout
      if (now - job.startedAt > job.jobTimeoutMs) {
        console.log(`[Watchdog] Job ${job._id} timed out after ${job.jobTimeoutMs}ms`);

        // Mark all pending/claimed items as skipped
        const pendingItems = await ctx.db
          .query("jobItems")
          .withIndex("by_job_status", (q) =>
            q.eq("jobId", job._id).eq("status", "pending")
          )
          .collect();

        const claimedItems = await ctx.db
          .query("jobItems")
          .withIndex("by_job_status", (q) =>
            q.eq("jobId", job._id).eq("status", "claimed")
          )
          .collect();

        for (const item of [...pendingItems, ...claimedItems]) {
          await ctx.db.patch(item._id, {
            status: "skipped",
            completedAt: now,
            error: "Job timed out",
          });
        }

        // Mark job as failed
        await ctx.db.patch(job._id, {
          status: "failed",
          completedAt: now,
          processed: job.totalItems,
          skipped: job.skipped + pendingItems.length + claimedItems.length,
          errors: [
            ...job.errors.slice(-99),
            `Job timed out after ${Math.round((now - job.startedAt) / 1000)}s`,
          ],
        });

        timedOutJobs++;
        continue; // Skip further processing for this job
      }

      // ═══════════════════════════════════════════════════════════════
      // STEP 2: Check for stale claimed items and spawn recovery workers
      // ═══════════════════════════════════════════════════════════════

      const claimedItems = await ctx.db
        .query("jobItems")
        .withIndex("by_job_status", (q) =>
          q.eq("jobId", job._id).eq("status", "claimed")
        )
        .collect();

      let staleCount = 0;
      for (const item of claimedItems) {
        const claimedAt = item.claimedAt ?? 0;
        if (now - claimedAt > job.itemTimeoutMs) {
          staleCount++;
        }
      }

      // If there are stale items and fewer than concurrencyLimit claimed items,
      // spawn a recovery worker
      if (staleCount > 0 && claimedItems.length < job.concurrencyLimit) {
        console.log(
          `[Watchdog] Job ${job._id} has ${staleCount} stale items, spawning recovery worker`
        );
        await ctx.scheduler.runAfter(0, internal.jobs.actions.processNextItem, {
          jobId: job._id,
        });
        recoveredItems += staleCount;
      }

      // Check if there are pending items but no active workers
      const pendingItems = await ctx.db
        .query("jobItems")
        .withIndex("by_job_status", (q) =>
          q.eq("jobId", job._id).eq("status", "pending")
        )
        .take(1);

      if (pendingItems.length > 0 && claimedItems.length === 0) {
        console.log(
          `[Watchdog] Job ${job._id} has pending items but no workers, spawning workers`
        );
        const workersToSpawn = Math.min(job.concurrencyLimit, job.totalItems - job.processed);
        for (let i = 0; i < workersToSpawn; i++) {
          await ctx.scheduler.runAfter(i * 50, internal.jobs.actions.processNextItem, {
            jobId: job._id,
          });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Start pending jobs whose dependencies completed
    // ═══════════════════════════════════════════════════════════════

    const pendingJobs = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    for (const pendingJob of pendingJobs) {
      if (!pendingJob.dependsOn) continue;

      // Check if dependency is completed
      const parentJob = await ctx.db.get(pendingJob.dependsOn);
      if (parentJob?.status === "completed") {
        console.log(
          `[Watchdog] Starting pending job ${pendingJob._id} (dependency ${pendingJob.dependsOn} completed)`
        );

        // Start the job
        await ctx.db.patch(pendingJob._id, {
          status: "running",
          lastActivityAt: now,
        });

        // Count pending items and spawn workers
        const pendingItems = await ctx.db
          .query("jobItems")
          .withIndex("by_job_status", (q) =>
            q.eq("jobId", pendingJob._id).eq("status", "pending")
          )
          .collect();

        const workersToSpawn = Math.min(pendingJob.concurrencyLimit, pendingItems.length);
        for (let i = 0; i < workersToSpawn; i++) {
          await ctx.scheduler.runAfter(i * 50, internal.jobs.actions.processNextItem, {
            jobId: pendingJob._id,
          });
        }

        startedDependentJobs++;
      }
    }

    if (timedOutJobs > 0 || recoveredItems > 0 || startedDependentJobs > 0) {
      console.log(
        `[Watchdog] Timed out: ${timedOutJobs}, Recovered: ${recoveredItems}, Started: ${startedDependentJobs}`
      );
    }

    return {
      timedOutJobs,
      recoveredItems,
      startedDependentJobs,
    };
  },
});
