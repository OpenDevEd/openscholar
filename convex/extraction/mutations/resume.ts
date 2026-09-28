import { requireOrganizationFeature } from "../../organizationFeatures";
/**
 * Plan-06 resume mutation, queue-runtime version.
 *
 * `resumeExtraction(jobId)` un-pauses both user-initiated pauses (`paused`)
 * and auto-pauses (`creditsExhausted`, plan 03). It:
 *
 *   1. Owns auth + ownership checks (same shape as pauseExtraction).
 *   2. When currentStatus is `creditsExhausted`, checks the balance covers
 *      the next paper's estimate, which is what each paper holds before it
 *      runs, and otherwise throws INSUFFICIENT_CREDITS.
 *   3. Calls `validateResumeTransition` (the pure decision helper) to
 *      reach the next status. On ok: patches the job (status flip +
 *      `runEpoch` bump) and re-dispatches paper queue work. On !ok with
 *      reason `not_paused`: returns silently — idempotent per plan 06
 *      § 'Idempotent mutations'.
 *
 * Queue resume contract:
 *
 *   - Bump `runEpoch` and clear pause fields.
 *   - If no papers exist yet, the job paused before setup expansion
 *     persisted papers; schedule the setup action for the new epoch.
 *   - Otherwise enqueue current non-terminal papers for the new epoch and
 *     dispatch the first queue window. Stale in-flight paper workers
 *     self-terminate at their next action boundary via the expectedEpoch
 *     mismatch.
 *
 *   Idempotency on re-dispatch: PDF indexing short-circuits via
 *   `existingPaper.isIndexed`, and a paper that's mid-extraction re-runs
 *   only the questions without a saved answer, then finalises.
 */

import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { requireAuth } from "../../lib/auth";
import { createError } from "../../lib/errors";
import { assertJobOwnership } from "../access";
import {
  assertValidJobTransition,
  type JobStatus,
} from "../stateMachine";
import { validateResumeTransition } from "../../../lib/extraction/transitions";
import { estimatePaperCredits } from "../../../lib/extraction/cost-estimate";
import {
  EXTRACTION_PAPER_CONCURRENCY,
  EXTRACTION_QUESTION_CONCURRENCY,
  PAPER_LIMIT,
} from "../../../lib/extraction/limits";
import { MAX_QUESTIONS_PER_JOB } from "../validators";
import { availableCredits as readAvailableCredits } from "../../billing/accounts";
import { getFlag } from "../../featureFlags/guard";
import {
  dispatchPaperQueueWindowTx,
  enqueueInitialPapersForJobTx,
} from "../queue/mutations";

export const resumeExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    resumed: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, { jobId }): Promise<{
    resumed: boolean;
    reason?: string;
  }> => {
    const user = await requireAuth(ctx);
    const job = await assertJobOwnership(ctx, user._id, jobId);
    await requireOrganizationFeature(ctx, "extraction");

    if (job.mode !== "extraction") {
      throw createError(
        "VALIDATION_ERROR",
        "Only extraction jobs can be resumed",
      );
    }

    if (!job.status) {
      return { resumed: false, reason: "not_paused" };
    }

    // Compute remaining estimate. For paused (user-initiated), the pure
    // decision helper ignores balance, so we only need real numbers when
    // currentStatus === "creditsExhausted".
    let availableCredits = 0;
    let remainingEstimateHigh = 0;

    if (job.status === "creditsExhausted") {
      availableCredits = await readAvailableCredits(ctx, user._id);
      const questions = await ctx.db
        .query("extractionQuestions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      remainingEstimateHigh = estimatePaperCredits({
        questionCount: questions.length,
        pdf: job.usePdfs ?? false,
      });
    }

    const decision = validateResumeTransition({
      currentStatus: job.status as JobStatus,
      pausedFromStatus: job.pausedFromStatus as JobStatus | undefined,
      availableCredits,
      remainingEstimate: remainingEstimateHigh,
    });

    if (!decision.ok) {
      if (decision.reason === "insufficient_credits") {
        throw createError(
          "INSUFFICIENT_CREDITS",
          `Resume needs ~${decision.needed} credits but only ${decision.available} available`,
        );
      }
      // "not_paused" — idempotent no-op.
      return { resumed: false, reason: decision.reason };
    }

    assertValidJobTransition(job.status as JobStatus, decision.nextStatus);
    const nextEpoch = (job.runEpoch ?? 0) + 1;
    await ctx.db.patch(jobId, {
      status: decision.nextStatus,
      runEpoch: nextEpoch,
      pausedAt: undefined,
      pausedFromStatus: undefined,
      // Clear any stale creditsExhausted error so the UI doesn't show it
      // after resume.
      error: undefined,
      updatedAt: Date.now(),
    });

    // Effective pdfEnabled = admin flag × per-job opt-in (mirrors
    // `getJobAndFlagsInternal`). Question concurrency mirrors the
    // queue setup action.
    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    const pdfFlagOn = pdfFlag?.enabled ?? true;
    const pdfEnabled = pdfFlagOn && (job.usePdfs ?? false);

    const questionConcurrency = EXTRACTION_QUESTION_CONCURRENCY;
    const paperConcurrency = EXTRACTION_PAPER_CONCURRENCY;

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(PAPER_LIMIT);
    const nonTerminalPaperIds = papers
      .filter(
        (p) =>
          p.status !== "completed" &&
          p.status !== "failed" &&
          p.status !== "download_failed" &&
          p.status !== "indexing_failed",
      )
      .map((p) => p._id);

    if (papers.length === 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.extraction.actions.setupExtractionQueueJob,
        { jobId, expectedEpoch: nextEpoch },
      );
    } else if (nonTerminalPaperIds.length > 0) {
      await enqueueInitialPapersForJobTx(ctx, {
        jobId,
        paperIds: nonTerminalPaperIds,
        expectedEpoch: nextEpoch,
        priority: 0,
      });
      await dispatchPaperQueueWindowTx(ctx, {
        jobId,
        expectedEpoch: nextEpoch,
        paperConcurrency,
        leaseOwner: `resume:${jobId}:${nextEpoch}`,
        leaseMs: 60_000,
        questionConcurrency,
        pdfEnabled,
      });
    }

    return { resumed: true };
  },
});
