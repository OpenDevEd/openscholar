/**
 * Plan-06 resume mutation.
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
 *      reach the next status. On ok: patches the job and sends the
 *      `resume:<jobId>` event that unblocks the workflow's `awaitEvent`
 *      gate. On !ok with reason `not_paused`: returns silently —
 *      idempotent per plan 06 § 'Idempotent mutations'.
 *
 * sendEvent contract: per the @convex-dev/workflow README, events
 * delivered before the workflow reaches the matching `awaitEvent` queue
 * and are consumed when it arrives. Race where resume fires before the
 * gate is therefore safe.
 */

import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { components } from "../../_generated/api";
import { sendEvent, type WorkflowId } from "@convex-dev/workflow";
import { requireAuth } from "../../lib/auth";
import { createError } from "../../lib/errors";
import { assertJobOwnership } from "../access";
import {
  assertValidJobTransition,
  type JobStatus,
} from "../stateMachine";
import { validateResumeTransition } from "../../../lib/extraction/transitions";
import { estimateRemainingCredits } from "../../../lib/extraction/cost-estimate";
import { PAPER_LIMIT_MAX } from "../bucket/limits";
import { MAX_QUESTIONS_PER_JOB } from "../validators";

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
      availableCredits =
        (credits?.freeBalance ?? 0) + (credits?.paidBalance ?? 0);

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
    await ctx.db.patch(jobId, {
      status: decision.nextStatus,
      runEpoch: (job.runEpoch ?? 0) + 1,
      pausedAt: undefined,
      pausedFromStatus: undefined,
      // Clear any stale creditsExhausted error so the UI doesn't show it
      // after resume.
      error: undefined,
      updatedAt: Date.now(),
    });

    // Wake the workflow's step.awaitEvent gate. Pre-existing events queue
    // through Convex workflow's event buffer, so a race where resume
    // fires before the gate is reached is safe. If the workflow already
    // terminated (e.g. user resumed a job whose workflow crashed), the
    // sendEvent call is ignored silently rather than surfacing here.
    if (job.workflowId) {
      try {
        await sendEvent(ctx, components.workflow, {
          name: `resume:${jobId}`,
          workflowId: job.workflowId as WorkflowId,
        });
      } catch (e) {
        console.warn(
          `[resumeExtraction] sendEvent failed for ${jobId}: ${String(e)}`,
        );
      }
    }

    return { resumed: true };
  },
});
