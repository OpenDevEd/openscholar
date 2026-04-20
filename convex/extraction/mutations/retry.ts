/**
 * Plan-05 retry mutation.
 *
 * `retryFailedQuestions(jobId)` re-runs only the failed-but-retryable
 * question results from a completed, failed, or credits-exhausted job.
 *
 * Mirrors the duplicateJob auth / rate-limit / ownership shape, but
 * does NOT duplicate the job row — it un-terminals the existing row
 * and re-dispatches a secondary `runRetryWorkflow`.
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
 *     `ragEntryId` + `indexingBilled=true` flag; the workflow branch for
 *     download/indexing is not entered.
 *   - Pre-flight credit check via `estimateRetryCredits` × balance.
 *
 * The state-mutation core is split out as `applyRetryResetTx` so tests
 * can run it in isolation via `t.run(ctx => applyRetryResetTx(ctx, …))`
 * without the outer mutation rolling back at `workflow.start` (the
 * workflow component is unregistered in convex-test, so the public
 * mutation's happy-path tx always rolls back in tests).
 */

import { mutation } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { workflow } from "../../workflow";
import { requireAuth } from "../../lib/auth";
import { requireFeature } from "../../featureFlags/guard";
import { rateLimit } from "../../lib/rateLimit";
import { createError } from "../../lib/errors";
import { assertJobOwnership } from "../access";
import {
  assertValidJobTransition,
  assertValidPaperTransition,
  type JobStatus,
} from "../stateMachine";
import { PAPER_LIMIT_MAX } from "../bucket/limits";
import { MAX_QUESTIONS_PER_JOB } from "../validators";
import { estimateRetryCredits } from "../../../lib/extraction/cost-estimate";
import { isResultRetryableFailure } from "../../../lib/extraction/retry-summary";

const ALLOWED_RETRY_STATUSES: readonly JobStatus[] = [
  "completed",
  "failed",
  "creditsExhausted",
];

/**
 * Reset retryable failed results on a job, flip the containing papers
 * and the job itself back to "extracting". Pure tx logic — no workflow
 * dispatch. Returns the count of rows reset (0 means nothing to retry).
 *
 * Pre-condition: caller has already asserted auth / ownership / job
 * status / preflight credits. Exported so tests can invoke it via
 * `t.run(…)`.
 */
export async function applyRetryResetTx(
  ctx: MutationCtx,
  job: Doc<"extractionJobs">,
): Promise<number> {
  const allResults = await ctx.db
    .query("extractionResults")
    .withIndex("by_job", (q) => q.eq("jobId", job._id))
    .take(PAPER_LIMIT_MAX * MAX_QUESTIONS_PER_JOB);

  const retryable = allResults.filter((r) => {
    if (r.status !== "failed") return false;
    if (r.billed === true) return false;
    return isResultRetryableFailure({
      status: r.status,
      lastError: r.lastError,
    });
  });

  if (retryable.length === 0) return 0;

  const now = Date.now();
  const paperIdsToReset = new Set<Id<"extractionPapers">>();

  for (const r of retryable) {
    await ctx.db.patch(r._id, {
      status: "pending" as const,
      lastError: undefined,
    });
    paperIdsToReset.add(r.paperId);
  }

  for (const paperId of paperIdsToReset) {
    const paper = await ctx.db.get("extractionPapers", paperId);
    if (!paper) continue;
    if (paper.status === "completed" || paper.status === "failed") {
      assertValidPaperTransition(paper.status, "extracting");
      await ctx.db.patch(paperId, {
        status: "extracting" as const,
        completedAt: undefined,
      });
    }
  }

  assertValidJobTransition(job.status as JobStatus, "extracting");
  await ctx.db.patch(job._id, {
    status: "extracting" as const,
    error: undefined,
    completedAt: undefined,
    updatedAt: now,
  });

  return retryable.length;
}

export const retryFailedQuestions = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    jobId: v.id("extractionJobs"),
    retryableCount: v.number(),
    workflowId: v.string(),
  }),
  handler: async (
    ctx,
    { jobId },
  ): Promise<{
    jobId: Id<"extractionJobs">;
    retryableCount: number;
    workflowId: string;
  }> => {
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

    if (!job.status || !ALLOWED_RETRY_STATUSES.includes(job.status as JobStatus)) {
      throw createError(
        "VALIDATION_ERROR",
        `Cannot retry job in status ${job.status ?? "unknown"}`,
      );
    }

    // Count retryable rows (for the preflight estimate). We re-scan
    // inside `applyRetryResetTx` — same tx, so the read is cheap and
    // keeps the preflight value source-of-truth aligned with the reset.
    const allResults = await ctx.db
      .query("extractionResults")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(PAPER_LIMIT_MAX * MAX_QUESTIONS_PER_JOB);
    const retryableCount = allResults.filter((r) => {
      if (r.status !== "failed") return false;
      if (r.billed === true) return false;
      return isResultRetryableFailure({
        status: r.status,
        lastError: r.lastError,
      });
    }).length;

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
      const credits = await ctx.db
        .query("credits")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique();
      const totalAvailable =
        (credits?.freeBalance ?? 0) + (credits?.paidBalance ?? 0);
      if (totalAvailable < estimate.high) {
        throw createError(
          "INSUFFICIENT_CREDITS",
          `Retry needs ~${estimate.mid} credits (up to ${estimate.high}) for ${retryableCount} questions but only have ${totalAvailable}`,
        );
      }
    }

    const applied = await applyRetryResetTx(ctx, job);

    if (job.workflowId) {
      try {
        await workflow.cancel(ctx, job.workflowId as never);
      } catch {
        // Already finished — nothing to cancel.
      }
    }

    const workflowId = await workflow.start(
      ctx,
      internal.extraction.workflow.runRetryWorkflow,
      { jobId },
      {
        onComplete:
          internal.extraction.mutations.internal.onComplete
            .handleExtractionJobComplete,
        context: { jobId },
      },
    );

    await ctx.db.patch(jobId, {
      workflowId,
      updatedAt: Date.now(),
    });

    return {
      jobId,
      retryableCount: applied,
      workflowId,
    };
  },
});
