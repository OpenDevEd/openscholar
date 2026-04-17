/**
 * Extraction Mutations
 * Public and internal mutations for data extraction jobs
 * Using Workflows and Workpools for durable execution
 */

import { mutation, internalMutation, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { PaperData, ExtractionResult } from "./types";
import type { Doc, Id } from "../_generated/dataModel";
import type { WorkflowId } from "@convex-dev/workflow";
import type { WorkId } from "@convex-dev/workpool";
import { pdfProcessingPool } from "../workpool";
import { getProcessableFlags } from "./content";
import { workflow } from "../workflow";
import { requireAuth } from "../lib/auth";
import { requireFeature, getFlag } from "../featureFlags/guard";
import { rateLimit } from "../lib/rateLimit";
import {
  aggregateQuestionInsights,
  buildDisagreementClusters,
  buildRunDiff,
  formatAnswerForDisplay,
  type DisagreementCluster,
  type InsightEntry,
  type QuestionInsightAggregate,
  type RunDiffRecord,
} from "../../lib/extraction/insights";

import { createError } from "../lib/errors";
import { batchDeleteByIndex } from "../lib/cascade";
import { handleWorkpoolResult } from "../lib/workpool";
import { assertJobOwnership } from "./access";
import {
  assertValidJobTransition,
  assertValidPaperTransition,
  type JobStatus,
  type PaperStatus,
} from "./stateMachine";
import {
  isTerminalPaperStatus,
  markPaperTerminalTx,
} from "./paperLifecycle";
import {
  assertExtractionInputLimits,
  historyEntryInputValidator,
  manualItemInputValidator,
  paperSourceTypeValidator,
  questionInputValidator,
  questionTypeValidator,
  sourceTypeValidator,
  zoteroSelectionInputValidator,
} from "./validators";
import { MAX_EVIDENCE_UNITS_PER_PAPER } from "../lib/queryBounds";
import {
  readJobSources,
  writeJobSources,
  type JobSourceHistoryEntry,
  type JobSourceManualItem,
  type JobSourceZoteroSelection,
} from "./jobSources";

/** Safety bound for per-job paper queries to prevent unbounded memory usage. */
const MAX_PAPERS_PER_JOB = 500;



export const deleteExtractionInternal = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const BATCH_SIZE = 100;
    const { jobId } = args;

    const reschedule = async (): Promise<null> => {
      await ctx.scheduler.runAfter(
        0,
        internal.extraction.mutations.deleteExtractionInternal,
        { jobId },
      );
      return null;
    };

    // Steps 1-3: delete extractionPapers' children (evidence units,
    // reviews, results) — these hang off paperId, not jobId, so iterate
    // the papers we have. Each inner drain shares the helper.
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

    // Step 4: Delete extractionPapers with inline storage cleanup. Done
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

    // Step 9: Delete the job itself
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
        await ctx.db.patch("extractionPapers", paper._id, { storageId: undefined });
        cleaned++;
      } catch (e) {
        console.error(`Failed to delete storage for paper ${paper._id}:`, e);
      }
    }

    return { cleaned };
  },
});

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

/**
 * Backfill pre-aggregated stats for a legacy completed job.
 * Idempotent: skips if stats already exist.
 *
 * Replaces the previous O(Q × P × R) nested scan (≤10k per-paper
 * result queries for a 50-question × 500-paper job) with a single
 * indexed by_job read over `extractionResults` bucketed in JS.
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
      // Cardinality: ~5-20 questions per extraction job
      ctx.db
        .query("extractionQuestions")
        .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
        .order("asc")
        .collect(),
      ctx.db
        .query("extractionPapers")
        .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
        .take(MAX_PAPERS_PER_JOB),
      // Cardinality: ≤ papers × questions. Bounded by MAX_PAPERS_PER_JOB × 20.
      ctx.db
        .query("extractionResults")
        .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
        .take(MAX_PAPERS_PER_JOB * 20),
    ]);

    const processablePapers = papers.filter((p) => p.processable !== false);

    // Bucket results by (questionKey, paperId) for O(1) lookup in the
    // aggregation loop. A single indexed scan replaces the prior O(Q·P)
    // per-paper result queries.
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

        const isAnswered = result.answer !== null && result.answer !== undefined;
        if (isAnswered) acc.totalAnswered += 1;
        if (result.citationStatus === "grounded") acc.groundedCount += 1;
        else if (result.citationStatus === "best_effort") acc.bestEffortCount += 1;
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

// Internal mutations (called by workflow/actions)

// Delete old PDF files (called by cron)
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
        q.eq("status", "completed").lt("completedAt", cutoffTime)
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

    // If we fetched a full batch, there might be more to process
    if (oldPapers.length >= CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.cleanupOldPdfs, {
        maxAgeHours: args.maxAgeHours,
      });
    }

    return { cleaned: oldPapers.length };
  },
});

/**
 * Decide whether the job has reached a terminal state and patch accordingly.
 *
 * Reads only the `extractionJobs` row (1 doc). Every terminal paper
 * transition bumps `processedPapers`/`failedPapers` via `markPaperTerminalTx`,
 * so `(processed + failed) >= totalPapers` is a faithful "all done" signal.
 *
 * Terminal states are sticky: a late onComplete cannot resurrect a job that
 * was cancelled/failed/completed earlier.
 */
export const maybeFinalizeJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get("extractionJobs", args.jobId);
    if (!job) return null;

    if (
      job.status === "cancelled" ||
      job.status === "failed" ||
      job.status === "completed"
    ) {
      return null;
    }

    const now = Date.now();
    const total = job.totalPapers;
    const processed = job.processedPapers;
    const failed = job.failedPapers;

    // Degenerate case: every source was non-processable, so `totalPapers`
    // was set to 0 at enqueue time. Fail the job immediately so the UI is
    // not stuck on "extracting".
    if (total === 0) {
      assertValidJobTransition(job.status as JobStatus, "failed");
      await ctx.db.patch("extractionJobs", args.jobId, {
        status: "failed",
        completedAt: now,
        updatedAt: now,
      });
      return null;
    }

    if (processed + failed < total) {
      await ctx.db.patch("extractionJobs", args.jobId, { updatedAt: now });
      return null;
    }

    const status: JobStatus = failed >= total ? "failed" : "completed";
    assertValidJobTransition(job.status as JobStatus, status);
    await ctx.db.patch("extractionJobs", args.jobId, {
      status,
      completedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

// Helper mutations for test job creation. Source rows go into
// extractionJobSources; callers can pass them here for ergonomics.
export const createJobDirect = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    sourceType: sourceTypeValidator,
    sourceHistoryEntries: v.optional(v.array(historyEntryInputValidator)),
    sourceZoteroSelection: v.optional(zoteroSelectionInputValidator),
    sourceManualItems: v.optional(v.array(manualItemInputValidator)),
  },
  returns: v.id("extractionJobs"),
  handler: async (ctx, args) => {
    const jobId = await ctx.db.insert("extractionJobs", {
      userId: args.userId,
      name: args.name,
      sourceType: args.sourceType,
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await writeJobSources(ctx, jobId, {
      historyEntries: args.sourceHistoryEntries,
      zoteroSelection: args.sourceZoteroSelection,
      manualItems: args.sourceManualItems,
    });
    return jobId;
  },
});

export const createQuestionDirect = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    key: v.string(),
    question: v.string(),
    type: questionTypeValidator,
    description: v.optional(v.string()),
    order: v.number(),
  },
  returns: v.id("extractionQuestions"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("extractionQuestions", {
      jobId: args.jobId,
      key: args.key,
      question: args.question,
      type: args.type,
      description: args.description,
      order: args.order,
      createdAt: Date.now(),
    });
  },
});

export const setJobWorkflowId = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    workflowId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("extractionJobs", args.jobId, { workflowId: args.workflowId });
    return null;
  },
});

// Enqueue paper for processing via workpool (3-step workflow)
export const enqueuePaperProcessing = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    pdfUrl: v.string(),
    storageId: v.optional(v.id("_storage")),
    title: v.string(),
    abstract: v.optional(v.string()),
    doi: v.optional(v.string()),
    questions: v.array(questionInputValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    console.log(`[enqueuePaperProcessing] START - Paper ${args.paperId}, PDF URL: ${args.pdfUrl ? "YES" : "NO"}`);
    
    // Update status to downloading before enqueuing
    await ctx.db.patch("extractionPapers", args.paperId, {
      status: "downloading",
    });
    console.log(`[enqueuePaperProcessing] Status updated to 'downloading' for ${args.paperId}`);

    // Enqueue Step 1: Download and index PDF. Capture the WorkId so
    // cancelExtraction can abort this specific item without touching other
    // jobs' in-flight work in the shared pool.
    console.log(`[enqueuePaperProcessing] Enqueuing Step 1 (Download & Index) for paper ${args.paperId}`);
    const workId = await pdfProcessingPool.enqueueAction(
      ctx,
      internal.extraction.workpoolActions.downloadAndIndexPdfAction,
      {
        paperId: args.paperId,
        jobId: args.jobId,
        pdfUrl: args.pdfUrl || "",
        storageId: args.storageId,
        title: args.title,
        abstract: args.abstract,
        doi: args.doi,
      },
      {
        onComplete: internal.extraction.mutations.handleDownloadAndIndexComplete,
        context: {
          paperId: args.paperId,
          jobId: args.jobId,
          questions: args.questions,
        },
        retry: {
          maxAttempts: 3,
          initialBackoffMs: 2000,
          base: 2,
        },
      }
    );
    await ctx.db.patch("extractionPapers", args.paperId, { workId });
    console.log(`[enqueuePaperProcessing] SUCCESS - Paper ${args.paperId} enqueued for processing (workId ${workId})`);
    return null;
  },
});

async function failPaperAndFinalize(
  ctx: MutationCtx,
  paperId: Id<"extractionPapers">,
  jobId: Id<"extractionJobs">,
  status: "failed" | "download_failed",
  errorMessage: string,
) {
  await markPaperTerminalTx(ctx, paperId, status, { errorMessage });
  await ctx.runMutation(internal.extraction.mutations.maybeFinalizeJob, {
    jobId,
  });
}

// Handle Step 1 completion: Download & Index
export const handleDownloadAndIndexComplete = pdfProcessingPool.defineOnComplete({
  context: v.object({
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    questions: v.array(questionInputValidator),
  }),
  handler: async (ctx, { context, result }) => {
    const { paperId, jobId, questions } = context;
    console.log(`[handleDownloadAndIndexComplete] Paper ${paperId}, result: ${result.kind}`);

    await handleWorkpoolResult(ctx, result, {
      onSuccess: async (ctx, returnValue) => {
        const data = returnValue as {
          success: boolean;
          storageId?: string;
          chunksCount?: number;
          error?: string;
        };

        if (!data.success) {
          console.log(`[handleDownloadAndIndexComplete] Download failed for ${paperId}: ${data.error}`);
          await failPaperAndFinalize(
            ctx,
            paperId,
            jobId,
            "download_failed",
            data.error || "Download failed",
          );
          return;
        }

        console.log(
          `[handleDownloadAndIndexComplete] Download/index success for ${paperId}, chunks: ${data.chunksCount}`,
        );

        const paperRow = await ctx.db.get(paperId);
        if (paperRow) {
          assertValidPaperTransition(paperRow.status as PaperStatus, "indexing");
        }
        await ctx.db.patch(paperId, { status: "indexing" });
        if ((data.chunksCount ?? 0) === 0) {
          await ctx.db.patch(paperId, { isIndexed: false });
        }

        // Step 2: Wait for indexing and extract. Capture the WorkId so
        // cancelExtraction can abort only this paper's work item.
        const extractWorkId = await pdfProcessingPool.enqueueAction(
          ctx,
          internal.extraction.workpoolActions.waitAndExtractAction,
          { paperId, jobId, questions },
          {
            onComplete: internal.extraction.mutations.handleExtractionComplete,
            context: { paperId, jobId },
            retry: { maxAttempts: 3, initialBackoffMs: 2000, base: 2 },
          },
        );
        await ctx.db.patch(paperId, { workId: extractWorkId });
      },
      onFailed: (ctx, error) =>
        failPaperAndFinalize(
          ctx,
          paperId,
          jobId,
          "failed",
          error || "Download/index action failed",
        ),
      onCanceled: (ctx) =>
        failPaperAndFinalize(
          ctx,
          paperId,
          jobId,
          "failed",
          "Download/index was canceled",
        ),
    });
  },
});

// Handle Step 2 completion: Wait & Extract
export const handleExtractionComplete = pdfProcessingPool.defineOnComplete({
  context: v.object({
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
  }),
  handler: async (ctx, { context, result }) => {
    const { paperId, jobId } = context;
    console.log(`[handleExtractionComplete] Paper ${paperId}, result: ${result.kind}`);

    await handleWorkpoolResult(ctx, result, {
      onSuccess: async (ctx, returnValue) => {
        const data = returnValue as {
          success: boolean;
          results?: ExtractionResult[];
          creditsUsed?: number;
          pdfContentUsed?: boolean;
          error?: string;
        };

        if (!data.success || !data.results) {
          await failPaperAndFinalize(
            ctx,
            paperId,
            jobId,
            "failed",
            data.error || "Extraction failed",
          );
          return;
        }

        // saveExtractionResultsAndComplete owns the terminal transition for
        // the success branch — it calls maybeFinalizeJob as its last step.
        await ctx.runMutation(
          internal.extraction.mutations.saveExtractionResultsAndComplete,
          {
            paperId,
            results: data.results,
            creditsUsed: data.creditsUsed || 0,
            pdfContentUsed: data.pdfContentUsed || false,
          },
        );
        console.log(`[handleExtractionComplete] Paper ${paperId} completed successfully`);
      },
      onFailed: (ctx, error) =>
        failPaperAndFinalize(
          ctx,
          paperId,
          jobId,
          "failed",
          error || "Extraction action failed",
        ),
      onCanceled: (ctx) =>
        failPaperAndFinalize(
          ctx,
          paperId,
          jobId,
          "failed",
          "Extraction was canceled",
        ),
    });
  },
});




// ═══════════════════════════════════════════════════════════════════════
// BARREL RE-EXPORTS — stable public paths for extracted submodules.
// External callers use `api.extraction.mutations.<fn>` regardless of the
// submodule the implementation now lives in. Submodules MUST NOT be
// imported directly from outside convex/extraction/ (enforced by the
// T4.0 import-boundary guard).
// ═══════════════════════════════════════════════════════════════════════

export {
  startExtraction,
  cancelExtraction,
  duplicateExtraction,
  startExtractionFromTemplate,
  deleteExtraction,
} from "./mutations/jobs";

export {
  createPaperRecords,
  updatePaperStatus,
  updatePaperProcessable,
  setPaperStorage,
  markPaperIndexed,
} from "./mutations/papers";

export {
  setResultReviewState,
  updateJobStatus,
  saveExtractionResultsAndComplete,
} from "./mutations/results";

export {
  saveWorkflowTemplate,
  saveWorkflowTemplateFromJob,
  deleteWorkflowTemplate,
} from "./mutations/templates";

export {
  saveExtractionSavedView,
  deleteExtractionSavedView,
} from "./mutations/savedViews";

export {
  createExtractionReportSnapshot,
  createExtractionRunDiff,
} from "./mutations/reports";

export { replacePaperEvidenceUnits } from "./mutations/evidence";
