/**
 * Plan-05 retry mutation.
 *
 * `retryFailedQuestions(jobId)` re-runs only the failed-but-retryable
 * question results from a completed, failed, or credits-exhausted job.
 *
 * Mirrors the duplicateJob auth / rate-limit / ownership shape, but
 * does NOT duplicate the job row — it un-terminals the existing row
 * and re-dispatches retry paper queue rows.
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
 *   - Pre-flight credit check via `estimateRetryCredits` × balance.
 *
 * The state-mutation core is split out as `applyRetryResetTx` so tests
 * can run it in isolation via `t.run(ctx => applyRetryResetTx(ctx, …))`
 * without requiring the public mutation's auth/rate-limit shell.
 */

import { mutation } from "../../_generated/server";
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
  PAPER_LIMIT,
} from "../../../lib/extraction/limits";
import { MAX_QUESTIONS_PER_JOB } from "../validators";
import { estimateRetryCredits } from "../../../lib/extraction/cost-estimate";
import { availableCredits as readAvailableCredits } from "../../billing/accounts";
import { isResultRetryableFailure } from "../../../lib/extraction/retry-summary";
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

async function listRetryableFailures(
  ctx: MutationCtx,
  jobId: Id<"extractionJobs">,
): Promise<Doc<"extractionResults">[]> {
  const failedResults = await ctx.db
    .query("extractionResults")
    .withIndex("by_job_status", (q) =>
      q.eq("jobId", jobId).eq("status", "failed"),
    )
    .take(PAPER_LIMIT * MAX_QUESTIONS_PER_JOB);

  return failedResults.filter((result) => {
    if (result.billed === true) return false;
    return isResultRetryableFailure({
      status: result.status,
      lastError: result.lastError,
    });
  });
}

type RetryPaperWork = {
  paperId: Id<"extractionPapers">;
  questionKeys: string[];
};

type RetryResetResult = {
  retryableCount: number;
  retryPapers: RetryPaperWork[];
  nextEpoch: number;
};

function groupRetryableFailuresByPaper(
  retryable: ReadonlyArray<Doc<"extractionResults">>,
): RetryPaperWork[] {
  const byPaper = new Map<Id<"extractionPapers">, string[]>();
  for (const result of retryable) {
    const existing = byPaper.get(result.paperId);
    if (existing) existing.push(result.questionKey);
    else byPaper.set(result.paperId, [result.questionKey]);
  }
  return Array.from(byPaper.entries()).map(([paperId, questionKeys]) => ({
    paperId,
    questionKeys,
  }));
}

async function applyRetryResetForRowsTx(
  ctx: MutationCtx,
  job: Doc<"extractionJobs">,
  retryable: ReadonlyArray<Doc<"extractionResults">>,
): Promise<RetryResetResult> {
  const retryPapers = groupRetryableFailuresByPaper(retryable);
  if (retryable.length === 0) {
    return {
      retryableCount: 0,
      retryPapers,
      nextEpoch: job.runEpoch ?? 0,
    };
  }

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
      await recomputePaperListProjection(ctx, paperId);
    }
  }

  assertValidJobTransition(job.status as JobStatus, "extracting");
  const nextEpoch = (job.runEpoch ?? 0) + 1;
  await ctx.db.patch(job._id, {
    status: "extracting" as const,
    runEpoch: nextEpoch,
    error: undefined,
    completedAt: undefined,
    pausedAt: undefined,
    pausedFromStatus: undefined,
    updatedAt: now,
  });

  return {
    retryableCount: retryable.length,
    retryPapers,
    nextEpoch,
  };
}

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

/**
 * Reset retryable failed results on a job, flip the containing papers
 * and the job itself back to "extracting". Pure tx logic — no dispatch
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
  const retryable = await listRetryableFailures(ctx, job._id);
  const reset = await applyRetryResetForRowsTx(ctx, job, retryable);
  return reset.retryableCount;
}

export const retryFailedQuestions = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    jobId: v.id("extractionJobs"),
    retryableCount: v.number(),
    queued: v.number(),
    dispatched: v.number(),
  }),
  handler: async (
    ctx,
    { jobId },
  ): Promise<{
    jobId: Id<"extractionJobs">;
    retryableCount: number;
    queued: number;
    dispatched: number;
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

    if (
      !job.status ||
      !ALLOWED_RETRY_STATUSES.includes(job.status as JobStatus)
    ) {
      throw createError(
        "VALIDATION_ERROR",
        `Cannot retry job in status ${job.status ?? "unknown"}`,
      );
    }

    // Count retryable rows (for the preflight estimate). We re-scan
    // inside `applyRetryResetTx` — same tx, so the read is cheap and
    // keeps the preflight value source-of-truth aligned with the reset.
    const retryableFailures = await listRetryableFailures(ctx, jobId);
    const retryableCount = retryableFailures.length;

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

    const reset = await applyRetryResetForRowsTx(ctx, job, retryableFailures);
    const runtime = await resolveRetryQueueRuntime(ctx, job);
    const queued = await enqueueRetryPapersForJobTx(ctx, {
      jobId,
      expectedEpoch: reset.nextEpoch,
      retryPapers: reset.retryPapers,
      priority: 0,
    });
    const dispatch = await dispatchPaperQueueWindowTx(ctx, {
      jobId,
      expectedEpoch: reset.nextEpoch,
      paperConcurrency: runtime.paperConcurrency,
      leaseOwner: `retry:${jobId}:${reset.nextEpoch}`,
      leaseMs: 60_000,
      questionConcurrency: runtime.questionConcurrency,
      pdfEnabled: runtime.pdfEnabled,
    });

    return {
      jobId,
      retryableCount: reset.retryableCount,
      queued: queued.enqueued + queued.existing,
      dispatched: dispatch.dispatched,
    };
  },
});
