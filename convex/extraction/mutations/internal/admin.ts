/**
 * Admin / maintenance internal mutations. Cascade delete, storage
 * cleanup, one-off backfills, cron-driven PDF GC. All are
 * internalMutations called from scheduled work (crons, maintenance
 * functions, deleteExtraction's scheduler hop).
 */

import { internalMutation } from "../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import type { Doc } from "../../../_generated/dataModel";
import { batchDeleteByIndex } from "../../../lib/cascade";
import { MAX_PAPERS_PER_JOB } from "../../../lib/queryBounds";

type BackfillAccumulator = {
  totalPapers: number;
  totalAnswered: number;
  groundedCount: number;
  bestEffortCount: number;
  insufficientEvidenceCount: number;
  extractionErrorCount: number;
  confidenceSum: number;
  confidenceCount: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  unknownConfidenceCount: number;
};

function emptyBackfillAccumulator(): BackfillAccumulator {
  return {
    totalPapers: 0,
    totalAnswered: 0,
    groundedCount: 0,
    bestEffortCount: 0,
    insufficientEvidenceCount: 0,
    extractionErrorCount: 0,
    confidenceSum: 0,
    confidenceCount: 0,
    highConfidenceCount: 0,
    mediumConfidenceCount: 0,
    lowConfidenceCount: 0,
    unknownConfidenceCount: 0,
  };
}

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
      .take(MAX_PAPERS_PER_JOB);
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

    // Steps 5-8b: straightforward by-job drains. Ordered so that
    // extractionRunDiffs rows referencing this job as baseline are
    // cleaned up last (BUG-03 fix — preserves existing semantics).
    const byJobDrains: Array<[string, string, string]> = [
      ["extractionQuestions", "by_job", "jobId"],
      ["extractionSavedViews", "by_job", "jobId"],
      ["extractionReportSnapshots", "by_job", "jobId"],
      ["extractionJobStats", "by_job", "jobId"],
      ["extractionRunDiffs", "by_job", "jobId"],
      ["extractionJobSources", "by_job_and_position", "jobId"],
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
    // MAX_PAPERS_PER_JOB, so the extra rows read are acceptable.
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_PAPERS_PER_JOB);

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

/**
 * Backfill pre-aggregated stats for a legacy completed job.
 * Idempotent: skips if stats already exist.
 *
 * Replaces the previous O(Q × P × R) nested scan with a single indexed
 * by_job read over extractionResults bucketed in JS.
 */
export const backfillJobStats = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const existingStats = await ctx.db
      .query("extractionJobStats")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .first();
    if (existingStats) return null;

    const [questions, papers, allResults] = await Promise.all([
      ctx.db
        .query("extractionQuestions")
        .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
        .order("asc")
        .collect(),
      ctx.db
        .query("extractionPapers")
        .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
        .take(MAX_PAPERS_PER_JOB),
      ctx.db
        .query("extractionResults")
        .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
        .take(MAX_PAPERS_PER_JOB * 20),
    ]);

    const processablePapers = papers.filter((p) => p.processable !== false);

    const resultsByKey = new Map<string, Doc<"extractionResults">>();
    for (const row of allResults) {
      resultsByKey.set(`${row.questionKey}:${row.paperId}`, row);
    }

    const now = Date.now();
    for (const question of questions) {
      const acc = emptyBackfillAccumulator();
      for (const paper of processablePapers) {
        acc.totalPapers += 1;
        const result = resultsByKey.get(`${question.key}:${paper._id}`);
        if (!result) {
          acc.unknownConfidenceCount += 1;
          continue;
        }

        const isAnswered =
          result.answer !== null && result.answer !== undefined;
        if (isAnswered) acc.totalAnswered += 1;
        if (result.citationStatus === "grounded") acc.groundedCount += 1;
        else if (result.citationStatus === "best_effort")
          acc.bestEffortCount += 1;
        else if (result.citationStatus === "insufficient_evidence")
          acc.insufficientEvidenceCount += 1;
        else if (result.citationStatus === "extraction_error")
          acc.extractionErrorCount += 1;

        const conf =
          typeof result.confidence === "number" ? result.confidence : undefined;
        if (conf === undefined) {
          acc.unknownConfidenceCount += 1;
        } else {
          acc.confidenceSum += conf;
          acc.confidenceCount += 1;
          if (conf >= 0.8) acc.highConfidenceCount += 1;
          else if (conf >= 0.5) acc.mediumConfidenceCount += 1;
          else acc.lowConfidenceCount += 1;
        }
      }

      await ctx.db.insert("extractionJobStats", {
        jobId: args.jobId,
        questionKey: question.key,
        ...acc,
        updatedAt: now,
      });
    }

    return null;
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
