/**
 * Admin / maintenance internal mutations. Cascade delete, storage
 * cleanup, one-off backfills, cron-driven PDF GC. All are
 * internalMutations called from scheduled work (crons, maintenance
 * functions, deleteExtraction's scheduler hop).
 */

import { internalMutation } from "../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { batchDeleteByIndex } from "../../../lib/cascade";
import { PAPER_LIMIT_MAX } from "../../bucket/limits";
import { clearJobAggregates, clearJobCredits } from "../../aggregates";

export const deleteExtractionInternal = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const BATCH_SIZE = 100;
    const { jobId } = args;

    const reschedule = async (): Promise<null> => {
      await ctx.scheduler.runAfter(
        0,
        internal.extraction.mutations.internal.admin.deleteExtractionInternal,
        { jobId },
      );
      return null;
    };

    // Steps 1-3: delete extractionPapers' children (evidence units, reviews,
    // results) — these hang off paperId, not jobId, so iterate the papers we
    // have. Each inner drain shares the helper.
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(PAPER_LIMIT_MAX);
    const perPaperChildTables: Array<[string, string]> = [
      ["extractionEvidenceUnits", "by_paper"],
      ["extractionResultReviews", "by_paper"],
      ["extractionResults", "by_paper"],
    ];
    for (const [table, indexName] of perPaperChildTables) {
      for (const paper of papers) {
        const deleted = await batchDeleteByIndex(
          ctx,
          table,
          indexName,
          "paperId",
          paper._id,
          BATCH_SIZE,
        );
        if (deleted > 0) return reschedule();
      }
    }

    // Step 4: delete extractionPapers with inline storage cleanup. Done
    // inline (not via the helper) because each row also deletes its PDF
    // blob from storage.
    const remainingPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(BATCH_SIZE);
    if (remainingPapers.length > 0) {
      for (const paper of remainingPapers) {
        if (paper.storageId) {
          try {
            await ctx.storage.delete(paper.storageId);
          } catch (e) {
            console.error(
              `Failed to delete PDF storage for paper ${paper._id}:`,
              e,
            );
          }
        }
        await ctx.db.delete(paper._id);
      }
      return reschedule();
    }

    // Clear the @convex-dev/aggregate state for every question on this
    // job before dropping extractionQuestions below. The aggregate
    // namespaces are keyed by (jobId, questionKey), so we need the keys
    // in hand before the drain.
    const jobQuestions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect();
    await clearJobAggregates(
      ctx,
      jobId,
      jobQuestions.map((q) => q.key),
    );

    // Plan-04: wipe the creditsAgg namespace for this job so cached
    // per-job totals return 0 immediately. The creditTransactions
    // rows are intentionally NOT deleted — the ledger is the user's
    // credit-audit trail and must survive job deletion, even if the
    // jobId FK becomes dangling.
    await clearJobCredits(ctx, jobId);

    // Steps 5-8b: straightforward by-job drains. Ordered so that
    // extractionRunDiffs rows referencing this job as baseline are
    // cleaned up last (BUG-03 fix — preserves existing semantics).
    const byJobDrains: Array<[string, string, string]> = [
      ["extractionQuestions", "by_job", "jobId"],
      ["extractionSavedViews", "by_job", "jobId"],
      ["extractionReportSnapshots", "by_job", "jobId"],
      ["extractionRunDiffs", "by_job", "jobId"],
      ["extractionJobSources", "by_job_and_position", "jobId"],
      // Drain chatPapers after extractionJobSources so any brief window of
      // stale sourceId references is closed out by the time the bridge
      // rows are gone. chatPapers only ever exists for chat-mode jobs;
      // for extraction-mode jobs this is a no-op drain.
      ["chatPapers", "by_job", "jobId"],
      ["extractionRunDiffs", "by_baseline", "baselineJobId"],
    ];
    for (const [table, indexName, field] of byJobDrains) {
      const deleted = await batchDeleteByIndex(
        ctx,
        table,
        indexName,
        field,
        jobId,
        BATCH_SIZE,
      );
      if (deleted > 0) return reschedule();
    }

    // Step 9: delete the job itself.
    const job = await ctx.db.get("extractionJobs", jobId);
    if (job) await ctx.db.delete(jobId);

    return null;
  },
});

export const cleanupFailedPaperStorage = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ cleaned: v.number() }),
  handler: async (ctx, args): Promise<{ cleaned: number }> => {
    // Convex guidelines forbid `.filter()` on DB queries; read via index
    // and skip papers without a storageId in JS. Bounded by
    // PAPER_LIMIT_MAX, so the extra rows read are acceptable.
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(PAPER_LIMIT_MAX);

    let cleaned = 0;
    for (const paper of papers) {
      if (!paper.storageId) continue;
      try {
        await ctx.storage.delete(paper.storageId);
        await ctx.db.patch("extractionPapers", paper._id, {
          storageId: undefined,
        });
        cleaned++;
      } catch (e) {
        console.error(`Failed to delete storage for paper ${paper._id}:`, e);
      }
    }

    return { cleaned };
  },
});

export const cleanupOldPdfs = internalMutation({
  args: {
    maxAgeHours: v.number(),
  },
  returns: v.object({ cleaned: v.number() }),
  handler: async (ctx, args): Promise<{ cleaned: number }> => {
    const cutoffTime = Date.now() - args.maxAgeHours * 60 * 60 * 1000;
    const CLEANUP_BATCH = 500;

    const oldPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_status_completedAt", (q) =>
        q.eq("status", "completed").lt("completedAt", cutoffTime),
      )
      .take(CLEANUP_BATCH);

    for (const paper of oldPapers) {
      if (paper.storageId) {
        try {
          await ctx.storage.delete(paper.storageId);
          await ctx.db.patch("extractionPapers", paper._id, {
            storageId: undefined,
          });
        } catch (error) {
          console.error(`Failed to delete PDF for paper ${paper._id}:`, error);
        }
      }
    }

    if (oldPapers.length >= CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(
        0,
        internal.extraction.mutations.internal.admin.cleanupOldPdfs,
        { maxAgeHours: args.maxAgeHours },
      );
    }

    return { cleaned: oldPapers.length };
  },
});
