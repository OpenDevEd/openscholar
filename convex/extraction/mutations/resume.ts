/**
 * Plan-06 resume mutation, retrofitted for Tier E.1 detach.
 *
 * `resumeExtraction(jobId)` un-pauses both user-initiated pauses (`paused`)
 * and auto-pauses (`creditsExhausted`, plan 03). It:
 *
 *   1. Owns auth + ownership checks (same shape as pauseExtraction).
 *   2. When currentStatus is `creditsExhausted`, runs a credit pre-flight
 *      by counting non-completed extractionResults + non-indexed papers
 *      and feeding them through `estimateRemainingCredits`. If the
 *      user's balance < estimate.high, the mutation throws
 *      INSUFFICIENT_CREDITS (conservative — better to block than
 *      immediately re-exhaust mid-run).
 *   3. Calls `validateResumeTransition` (the pure decision helper) to
 *      reach the next status. On ok: patches the job (status flip +
 *      `runEpoch` bump) and re-launches per-paper workflows. On !ok with
 *      reason `not_paused`: returns silently — idempotent per plan 06
 *      § 'Idempotent mutations'.
 *
 * Detach-aware resume contract (Tier E.1):
 *
 *   - The pre-detach gate fired `sendEvent` against the setup workflow
 *     to wake its `step.awaitEvent` park. After detach, the setup
 *     workflow exits on its own after fan-out, and per-paper workflows
 *     don't `awaitEvent` at all — they park cleanly via `classifyWorkerSkip`.
 *   - On resume we therefore:
 *       a. Cancel `job.workflowId` (the setup workflow). If the user
 *          paused BEFORE fan-out, the setup workflow is parked on the
 *          pre-fan-out `waitWhilePausedOrCancelled` gate; cancelling
 *          stops it from re-fanning out duplicates when it wakes.
 *          If fan-out already happened, the setup workflow has long
 *          since exited and `workflow.cancel` is a silent no-op.
 *       b. Bump `runEpoch` and clear the pause fields.
 *       c. Schedule `launchPaperWorkflowsForJob` against every
 *          non-terminal paper. Stale in-flight paper workflows
 *          self-terminate at their next action boundary via the
 *          `expectedEpoch` mismatch detected by `getWorkerSkipReason`;
 *          the freshly launched workflows pick up the work.
 *
 *   Idempotency on re-launch: `downloadAndIndexPdfAction` short-circuits
 *   via `existingPaper.isIndexed || existingPaper.indexingBilled`, and
 *   `extractOneQuestion` short-circuits via `existingResult?.billed`.
 *   A paper that's mid-extraction re-enters the pipeline harmlessly,
 *   re-runs only the question(s) that hadn't yet billed, then finalises.
 */

import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { WorkflowId } from "@convex-dev/workflow";
import { workflow } from "../../workflow";
import { requireAuth } from "../../lib/auth";
import { createError } from "../../lib/errors";
import { assertJobOwnership } from "../access";
import {
  assertValidJobTransition,
  type JobStatus,
} from "../stateMachine";
import { validateResumeTransition } from "../../../lib/extraction/transitions";
import { estimateRemainingCredits } from "../../../lib/extraction/cost-estimate";
import {
  EXTRACTION_QUESTION_CONCURRENCY_INFRA_CLAMP,
  getExtractionExecutionLimits,
  PAPER_LIMIT_MAX,
} from "../bucket/limits";
import { resolveBoundedConcurrency } from "../batching";
import { MAX_QUESTIONS_PER_JOB } from "../validators";
import { readBalance } from "../../credits/balanceCounter";
import { getFlag } from "../../featureFlags/guard";

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
      const credits = await ctx.db
        .query("credits")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique();
      availableCredits = credits
        ? (await readBalance(ctx, credits._id)).total
        : 0;

      // Count remaining work inline — resume is a single-row-trigger
      // operation so one round of scans is cheaper than a dedicated
      // internal query + cross-mutation call.
      const unresolvedResults = (
        await Promise.all([
          ctx.db
            .query("extractionResults")
            .withIndex("by_job_status", (q) =>
              q.eq("jobId", jobId).eq("status", "pending"),
            )
            .take(PAPER_LIMIT_MAX * MAX_QUESTIONS_PER_JOB),
          ctx.db
            .query("extractionResults")
            .withIndex("by_job_status", (q) =>
              q.eq("jobId", jobId).eq("status", "extracting"),
            )
            .take(PAPER_LIMIT_MAX * MAX_QUESTIONS_PER_JOB),
          ctx.db
            .query("extractionResults")
            .withIndex("by_job_status", (q) =>
              q.eq("jobId", jobId).eq("status", "failed"),
            )
            .take(PAPER_LIMIT_MAX * MAX_QUESTIONS_PER_JOB),
        ])
      ).flat();
      const remainingQuestions = unresolvedResults.filter(
        (result) => result.billed !== true,
      ).length;

      const papers = await ctx.db
        .query("extractionPapers")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .take(PAPER_LIMIT_MAX);
      const unindexedPapers = papers.filter(
        (p) =>
          p.indexingBilled !== true &&
          p.status !== "download_failed" &&
          p.status !== "indexing_failed",
      ).length;

      const usePdfs = job.usePdfs ?? false;
      const estimate = estimateRemainingCredits({
        remainingQuestions,
        unindexedPapers,
        usePdfs,
        avgPaperKind: usePdfs ? "pdf" : "abstract",
      });
      remainingEstimateHigh = estimate.high;
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

    // Cancel the setup workflow. If we paused BEFORE fan-out, it's parked
    // on `waitWhilePausedOrCancelled` via `step.awaitEvent` — cancelling
    // stops it from waking and re-fanning out duplicates. If fan-out
    // already happened the setup workflow has long since exited and
    // `workflow.cancel` is a silent no-op.
    if (job.workflowId) {
      try {
        await workflow.cancel(ctx, job.workflowId as WorkflowId);
      } catch (e) {
        console.warn(
          `[resumeExtraction] workflow.cancel failed for ${jobId}: ${String(e)}`,
        );
      }
    }

    // Effective pdfEnabled = admin flag × per-job opt-in (mirrors
    // `getJobAndFlagsInternal`). Question concurrency mirrors the
    // workflow's own `getEffectiveQuestionConcurrency`.
    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    const pdfFlagOn = pdfFlag?.enabled ?? true;
    const pdfEnabled = pdfFlagOn && (job.usePdfs ?? false);

    const executionLimits = await getExtractionExecutionLimits(ctx, user._id);
    const questionConcurrency = resolveBoundedConcurrency(
      executionLimits.questionConcurrencyPerPaper,
      EXTRACTION_QUESTION_CONCURRENCY_INFRA_CLAMP,
    );

    // Re-launch a paper workflow for every non-terminal paper. Stale
    // in-flight workflows from the prior epoch self-terminate at their
    // next action via the `expectedEpoch` mismatch in
    // `getWorkerSkipReason` (skipped:stale_epoch -> park). The freshly
    // launched workflows pick up the work; idempotency guards in
    // `downloadAndIndexPdfAction` (existingPaper.isIndexed ||
    // indexingBilled) and `extractOneQuestion` (existingResult?.billed)
    // short-circuit any already-done sub-step.
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(PAPER_LIMIT_MAX);
    const nonTerminalPaperIds = papers
      .filter(
        (p) =>
          p.status !== "completed" &&
          p.status !== "failed" &&
          p.status !== "download_failed" &&
          p.status !== "indexing_failed",
      )
      .map((p) => p._id);

    if (nonTerminalPaperIds.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.extraction.mutations.internal.fanout.launchPaperWorkflowsForJob,
        {
          jobId,
          paperIds: nonTerminalPaperIds,
          expectedEpoch: nextEpoch,
          pdfEnabled,
          questionConcurrency,
        },
      );
    }

    return { resumed: true };
  },
});
