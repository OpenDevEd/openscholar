/**
 * Plan-05 retry mutation.
 *
 * `retryFailedQuestions(jobId)` re-runs only the failed-but-retryable
 * question results from a completed, failed, or credits-exhausted job.
 *
 * Mirrors the duplicateJob auth / rate-limit / ownership shape, but
 * does NOT duplicate the job row — it un-terminals the existing row,
 * then `resetRetryBatch` resets the failures a batch of papers at a time
 * and re-dispatches retry paper queue rows, so a job of any size can be
 * retried (#351). The job can't finish until the last batch has run.
 *
 * Guards:
 *   - `status ∈ {completed, failed, creditsExhausted}` (state-machine edges
 *     for `completed|failed → extracting` were widened in stateMachine.ts).
 *   - A result is only reset when `status === "failed"` AND
 *     `isResultRetryableFailure(result)` AND `result.billed !== true`.
 *     The billed guard is the per-question billing idempotency gate from
 *     plan 02; the retry mutation never flips `billed` back to false and
 *     never touches a row where it's true (would re-bill).
 *   - Indexing is NEVER re-run. Retry reuses the paper's existing
 *     `ragEntryId` and `isIndexed`; retry rows skip download
 *     and indexing.
 *   - Pre-flight credit check via `estimateRetryCredits` × balance, from the
 *     job's retryable count (`../resultCounts.ts`).
 */

import { internalMutation, mutation } from "../../lib/functions";
import { internal } from "../../_generated/api";
import type { MutationCtx } from "../../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { getFlag, requireFeature } from "../../featureFlags/guard";
import { rateLimit } from "../../lib/rateLimit";
import { createError } from "../../lib/errors";
import { assertJobOwnership } from "../access";
import {
  assertValidJobTransition,
  assertValidPaperTransition,
  type JobStatus,
} from "../stateMachine";
import {
  EXTRACTION_PAPER_CONCURRENCY,
  EXTRACTION_QUESTION_CONCURRENCY,
} from "../../../lib/extraction/limits";
import { MAX_QUESTIONS_PER_JOB } from "../validators";
import { estimateRetryCredits } from "../../../lib/extraction/cost-estimate";
import { availableCredits as readAvailableCredits } from "../../billing/accounts";
import { isResultRetryableFailure } from "../../../lib/extraction/retry-summary";
import { readResultCounts } from "../resultCounts";
import { recomputePaperListProjection } from "../listProjection";
import {
  dispatchPaperQueueWindowTx,
  enqueueRetryPapersForJobTx,
} from "../queue/mutations";

const ALLOWED_RETRY_STATUSES: readonly JobStatus[] = [
  "completed",
  "failed",
  "creditsExhausted",
];

/**
 * Papers reset per batch. Each batch reads a paper's results (at most
 * MAX_QUESTIONS_PER_JOB), resets its retryable failures and recomputes its list
 * projection, so a batch stays far inside a transaction's limits however many of the
 * job's results failed (#351).
 */
const RETRY_PAPERS_PER_BATCH = 25;

/**
 * Resets one batch of a job's papers for a retry: their retryable failures go back to
 * pending, the papers back to extracting, and they're queued. The next batch is scheduled
 * until every paper is seen; the last one lets the job finish again. A pause or credit
 * stop halts the batches with the job's `retryReset` cursor kept, and resuming the job
 * carries on from it under the new epoch.
 */
export const resetRetryBatch = internalMutation({
  args: { jobId: v.id("extractionJobs"), epoch: v.number() },
  returns: v.null(),
  handler: async (ctx, { jobId, epoch }) => {
    const job = await ctx.db.get("extractionJobs", jobId);
    if (!job?.retryReset || (job.runEpoch ?? 0) !== epoch || job.status !== "extracting") return null;
    const page = await ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", jobId)).paginate({ cursor: job.retryReset.cursor, numItems: RETRY_PAPERS_PER_BATCH });
    const retryPapers: Array<{ paperId: Id<"extractionPapers">; questionKeys: string[] }> = [];
    for (const paper of page.page) {
      const results = await ctx.db.query("extractionResults").withIndex("by_paper", (q) => q.eq("paperId", paper._id)).take(MAX_QUESTIONS_PER_JOB);
      // A billed result is never reset: that would bill it again.
      const retryable = results.filter((result) => result.billed !== true && isResultRetryableFailure(result));
      if (!retryable.length) continue;
      for (const result of retryable) await ctx.db.patch("extractionResults", result._id, { status: "pending", lastError: undefined });
      if (paper.status === "completed" || paper.status === "failed") {
        assertValidPaperTransition(paper.status, "extracting");
        await ctx.db.patch("extractionPapers", paper._id, { status: "extracting", completedAt: undefined });
        await recomputePaperListProjection(ctx, paper._id);
      }
      retryPapers.push({ paperId: paper._id, questionKeys: retryable.map((result) => result.questionKey) });
    }
    if (retryPapers.length) {
      const runtime = await resolveRetryQueueRuntime(ctx, job);
      await enqueueRetryPapersForJobTx(ctx, { jobId, expectedEpoch: epoch, retryPapers, priority: 0 });
      await dispatchPaperQueueWindowTx(ctx, {
        jobId,
        expectedEpoch: epoch,
        paperConcurrency: runtime.paperConcurrency,
        leaseOwner: `retry:${jobId}:${epoch}`,
        leaseMs: 60_000,
        questionConcurrency: runtime.questionConcurrency,
        pdfEnabled: runtime.pdfEnabled,
      });
    }
    if (!page.isDone) {
      await ctx.db.patch("extractionJobs", jobId, { retryReset: { cursor: page.continueCursor } });
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.retry.resetRetryBatch, { jobId, epoch });
      return null;
    }
    await ctx.db.patch("extractionJobs", jobId, { retryReset: undefined });
    // Retried papers may all have finished while later batches ran.
    await ctx.scheduler.runAfter(0, internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, { jobId, expectedEpoch: epoch });
    return null;
  },
});

async function resolveRetryQueueRuntime(
  ctx: MutationCtx,
  job: Doc<"extractionJobs">,
): Promise<{
  pdfEnabled: boolean;
  questionConcurrency: number;
  paperConcurrency: number;
}> {
  const pdfFlag = await getFlag(ctx, "extraction.pdf");
  return {
    pdfEnabled: (pdfFlag?.enabled ?? true) && (job.usePdfs ?? false),
    questionConcurrency: EXTRACTION_QUESTION_CONCURRENCY,
    paperConcurrency: EXTRACTION_PAPER_CONCURRENCY,
  };
}

export const retryFailedQuestions = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    jobId: v.id("extractionJobs"),
    retryableCount: v.number(),
  }),
  handler: async (ctx, { jobId }) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);

    const job = await assertJobOwnership(ctx, user._id, jobId);

    if (job.mode !== "extraction") {
      throw createError(
        "VALIDATION_ERROR",
        "Retry only applies to extraction jobs",
      );
    }

    await requireFeature(ctx, "extraction.start", user._id);
    await rateLimit(ctx, {
      name: "start-extraction",
      key: user._id,
      throws: true,
    });

    if (
      !job.status ||
      !ALLOWED_RETRY_STATUSES.includes(job.status as JobStatus)
    ) {
      throw createError(
        "VALIDATION_ERROR",
        `Cannot retry job in status ${job.status ?? "unknown"}`,
      );
    }

    // The job's counters give the retryable count without reading its results.
    const { retryable: retryableCount } = await readResultCounts(ctx, jobId);

    if (retryableCount === 0) {
      throw createError("VALIDATION_ERROR", "No retryable failures to retry");
    }

    const usePdfs = job.usePdfs ?? false;
    const estimate = estimateRetryCredits({
      retryableCount,
      usePdfs,
      avgPaperKind: usePdfs ? "pdf" : "abstract",
    });

    if (estimate.high > 0) {
      const totalAvailable = await readAvailableCredits(ctx, user._id);
      if (totalAvailable < estimate.high) {
        throw createError(
          "INSUFFICIENT_CREDITS",
          `Retry needs ~${estimate.mid} credits (up to ${estimate.high}) for ${retryableCount} questions but only have ${totalAvailable}`,
        );
      }
    }

    assertValidJobTransition(job.status as JobStatus, "extracting");
    const epoch = (job.runEpoch ?? 0) + 1;
    await ctx.db.patch("extractionJobs", jobId, {
      status: "extracting" as const,
      runEpoch: epoch,
      retryReset: { cursor: null },
      error: undefined,
      completedAt: undefined,
      pausedAt: undefined,
      pausedFromStatus: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.extraction.mutations.retry.resetRetryBatch, { jobId, epoch });

    return { jobId, retryableCount };
  },
});

