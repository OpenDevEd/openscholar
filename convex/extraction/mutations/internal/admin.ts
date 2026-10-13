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
import { clearJobCredits } from "../../aggregates";
import { recomputePaperListProjection } from "../../listProjection";


export const deleteExtractionInternal = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const BATCH_SIZE = 100;
    // Papers one pass deletes, each with up to BATCH_SIZE of each kind of child.
    const PAPERS_A_PASS = 20;
    // Count entries one pass's answer rows take out (../../facets.ts): one for a row's answer and one for each item of a list answer, up to 101 a row.
    let entriesLeft = 4_000;
    const { jobId } = args;

    const reschedule = async (): Promise<null> => {
      await ctx.scheduler.runAfter(
        0,
        internal.extraction.mutations.internal.admin.deleteExtractionInternal,
        { jobId },
      );
      return null;
    };

    // The job goes first, as deleteExtraction deletes it: its rows' changes then stop feeding its tallies (../../tallies.ts).
    if (await ctx.db.get("extractionJobs", jobId)) await ctx.db.delete(jobId);

    // Steps 1-4: a pass of the job's papers, each with its evidence, results and facts, then
    // the paper and its PDF. A paper with more children than a batch takes another pass.
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(PAPERS_A_PASS);
    const perPaperChildTables: Array<[string, string]> = [
      ["extractionEvidenceUnits", "by_paper"],
      ["extractionResults", "by_paper"],
      ["extractionPaperFacts", "by_paper"],
    ];
    for (const paper of papers) {
      for (const [table, indexName] of perPaperChildTables) {
        const deleted = await batchDeleteByIndex(ctx, table, indexName, "paperId", paper._id, BATCH_SIZE);
        if (deleted === BATCH_SIZE) return reschedule();
      }
      const rows = await ctx.db.query("extractionAnswerRows").withIndex("by_paper", (q) => q.eq("paperId", paper._id)).take(BATCH_SIZE);
      for (const row of rows) {
        if (entriesLeft <= 0) return reschedule();
        entriesLeft -= 1 + row.items.length;
        await ctx.db.delete(row._id);
      }
      if (rows.length === BATCH_SIZE) return reschedule();
      if (paper.storageId) {
        try {
          await ctx.storage.delete(paper.storageId);
        } catch (e) {
          console.error(`Failed to delete PDF storage for paper ${paper._id}:`, e);
        }
      }
      await ctx.db.delete(paper._id);
    }
    if (papers.length > 0) return reschedule();

    // Plan-04: wipe the creditsAgg namespace for this job so cached
    // per-job totals return 0 immediately. The creditTransactions
    // rows are intentionally NOT deleted — the ledger is the user's
    // credit-audit trail and must survive job deletion, even if the
    // jobId FK becomes dangling.
    await clearJobCredits(ctx, jobId);

    // The job's counts row and waiting count changes go with the job, through the
    // trigger on extractionJobs (../../counts.ts).

    // Straightforward by-job drains. Results/evidence normally disappear
    // through the per-paper pass above, but the by-job drains catch any
    // orphaned rows left by an interrupted or older cascade.
    const byJobDrains: Array<[string, string, string]> = [
      ["extractionEvidenceChanges", "by_job", "jobId"],
      ["extractionCountChanges", "by_job", "jobId"],
      ["extractionPaperQueue", "by_job_and_status", "jobId"],
      ["extractionPaperErrors", "by_job", "jobId"],
      ["extractionEvidenceUnits", "by_job", "jobId"],
      ["extractionResults", "by_job", "jobId"],
      ["extractionQuestions", "by_job", "jobId"],
      ["extractionJobSources", "by_job_and_position", "jobId"],
      ["paperSetKeys", "by_job_and_part_and_page", "job"],
      ["extractionAnswerTallies", "by_group", "jobId"],
      ["extractionAnswerTotals", "by_job_question", "jobId"],
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
    // What the job paid for of the paper PDF store (../../../lib/paperPdfs.ts).
    if ((await batchDeleteByIndex(ctx, "paperPdfReads", "by_scope_and_key", "scope", `extraction:${jobId}`, BATCH_SIZE)) > 0) return reschedule();

    return null;
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
