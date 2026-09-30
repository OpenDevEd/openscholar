/**
 * Admin / maintenance internal mutations. Cascade delete, storage
 * cleanup, one-off backfills, cron-driven PDF GC. All are
 * internalMutations called from scheduled work (crons, maintenance
 * functions, deleteExtraction's scheduler hop).
 */

import { internalMutation } from "../../../lib/functions";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { batchDeleteByIndex } from "../../../lib/cascade";
import { PAPER_LIMIT } from "@/lib/extraction/limits";
import { clearJobCredits } from "../../aggregates";
import { clearJobCounters } from "../../jobCounters";
import { recomputePaperListProjection } from "../../listProjection";

const PROJECTION_REPAIR_BATCH_SIZE = 25;

function paperNeedsListProjectionRepair(paper: {
  sortTitle?: string;
  avgConfidence?: number;
  hasErrors?: boolean;
  hasPdfSource?: boolean;
  questionAnswerTokens?: string[];
  searchText?: string;
}) {
  return (
    typeof paper.sortTitle !== "string" ||
    typeof paper.avgConfidence !== "number" ||
    !Number.isFinite(paper.avgConfidence) ||
    typeof paper.hasErrors !== "boolean" ||
    typeof paper.hasPdfSource !== "boolean" ||
    !Array.isArray(paper.questionAnswerTokens) ||
    typeof paper.searchText !== "string"
  );
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

    // Steps 1-3: delete extractionPapers' children (evidence units, results)
    // — these hang off paperId, not jobId, so iterate the papers we
    // have. Each inner drain shares the helper.
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(PAPER_LIMIT);

    const perPaperChildTables: Array<[string, string]> = [
      ["extractionEvidenceUnits", "by_paper"],
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

    // Plan-04: wipe the creditsAgg namespace for this job so cached
    // per-job totals return 0 immediately. The creditTransactions
    // rows are intentionally NOT deleted — the ledger is the user's
    // credit-audit trail and must survive job deletion, even if the
    // jobId FK becomes dangling.
    await clearJobCredits(ctx, jobId);

    // Tier B: zero the per-job processed/failed sharded counters so a
    // recreated job (same jobId reuse is impossible — Convex Ids are
    // unique — but stale shards would otherwise linger) is dropped from
    // the component too.
    await clearJobCounters(ctx, jobId);

    // Straightforward by-job drains. Results/evidence normally disappear
    // through the per-paper pass above, but the by-job drains catch any
    // orphaned rows left by an interrupted or older cascade.
    const byJobDrains: Array<[string, string, string]> = [
      ["extractionPaperQueue", "by_job_and_status", "jobId"],
      ["extractionPaperErrors", "by_job", "jobId"],
      ["extractionEvidenceUnits", "by_job", "jobId"],
      ["extractionResults", "by_job", "jobId"],
      ["extractionQuestions", "by_job", "jobId"],
      ["chatSourceEvents", "by_job_createdAt", "jobId"],
      // Drain chatPapers before extractionJobSources so sourceId bridge rows
      // do not outlive the source snapshot they point at.
      ["chatPapers", "by_job", "jobId"],
      ["extractionJobSources", "by_job_and_position", "jobId"],
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
    // PAPER_LIMIT, so the extra rows read are acceptable.
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(PAPER_LIMIT);

    let cleaned = 0;
    for (const paper of papers) {
      if (!paper.storageId) continue;
      try {
        await ctx.storage.delete(paper.storageId);
        await ctx.db.patch("extractionPapers", paper._id, {
          storageId: undefined,
        });
        await recomputePaperListProjection(ctx, paper._id);
        cleaned++;
      } catch (e) {
        console.error(`Failed to delete storage for paper ${paper._id}:`, e);
      }
    }

    return { cleaned };
  },
});

export const rebuildJobListProjection = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    scanned: v.number(),
    rebuilt: v.number(),
    remaining: v.number(),
    scheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(PAPER_LIMIT);

    const missingProjectionPapers = papers.filter(paperNeedsListProjectionRepair);
    const batch = missingProjectionPapers.slice(0, PROJECTION_REPAIR_BATCH_SIZE);

    for (const paper of batch) {
      await recomputePaperListProjection(ctx, paper._id);
    }

    const remaining = Math.max(0, missingProjectionPapers.length - batch.length);
    const scheduled = remaining > 0;
    if (scheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal.extraction.mutations.internal.admin.rebuildJobListProjection,
        { jobId: args.jobId },
      );
    }

    return {
      scanned: papers.length,
      rebuilt: batch.length,
      remaining,
      scheduled,
    };
  },
});

export const cleanupOldPdfs = internalMutation({
  args: {
    maxAgeHours: v.number(),
    cursor: v.optional(v.union(v.string(), v.null())),
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
      .paginate({ numItems: CLEANUP_BATCH, cursor: args.cursor ?? null });

    let cleaned = 0;
    for (const paper of oldPapers.page) {
      if (paper.storageId) {
        try {
          await ctx.storage.delete(paper.storageId);
          await ctx.db.patch("extractionPapers", paper._id, {
            storageId: undefined,
          });
          await recomputePaperListProjection(ctx, paper._id);
          cleaned++;
        } catch (error) {
          console.error(`Failed to delete PDF for paper ${paper._id}:`, error);
        }
      }
    }

    if (!oldPapers.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.extraction.mutations.internal.admin.cleanupOldPdfs,
        {
          maxAgeHours: args.maxAgeHours,
          cursor: oldPapers.continueCursor,
        },
      );
    }

    return { cleaned };
  },
});
