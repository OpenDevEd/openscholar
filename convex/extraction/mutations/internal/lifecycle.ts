/**
 * Internal job / question lifecycle mutations — the plumbing the
 * workflow calls between source fetch and paper processing.
 *
 *   - maybeFinalizeJob: O(1) "all done" check from extractionJobs counters.
 *   - createJobDirect / createQuestionDirect: test-and-workflow job/question
 *     record creation used by fixtures and the workflow step.
 *   - setJobWorkflowId: patch the workflow handle after workflow.start().
 *   - releaseUnsettledPaperReservationsForJob: Tier D sweep that releases
 *     every paper-level credit reservation that survived a terminal job
 *     transition (cancel, fail, complete-with-orphans, delete). Scheduled
 *     async from `maybeFinalizeJob` and `cancelExtraction` so the user
 *     mutation itself doesn't pay an O(P) tx cost.
 *
 * Plan-02 retires the per-paper workpool enqueue helper that used to
 * live here — the workflow handler now calls downloadAndIndexPdfAction
 * and extractOneQuestion directly via step.runAction.
 */

import { internalMutation } from "../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { writeJobSources } from "../../jobSources";
import {
  assertValidJobTransition,
  type JobStatus,
} from "../../stateMachine";
import {
  bucketItemInputValidator,
  questionTypeValidator,
  sourceTypeValidator,
} from "../../validators";
import { readJobCounters } from "../../jobCounters";
import { releaseReservationTransaction } from "../../../credits/reservation";
import { PAPER_LIMIT_MAX } from "../../bucket/limits";

export const maybeFinalizeJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    expectedEpoch: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get("extractionJobs", args.jobId);
    if (!job) return null;
    if (
      args.expectedEpoch !== undefined &&
      (job.runEpoch ?? 0) !== args.expectedEpoch
    ) {
      return null;
    }

    if (
      job.status === "cancelled" ||
      job.status === "failed" ||
      job.status === "completed" ||
      // Paused and creditsExhausted are non-terminal pauses. Do not let
      // a late counter-increment cascade through to `completed`/`failed`
      // while the workflow is blocked on awaitEvent — the resume path
      // owns status transitions back to active.
      job.status === "paused" ||
      job.status === "creditsExhausted"
    ) {
      return null;
    }

    const now = Date.now();
    const total = job.totalPapers ?? 0;

    // Degenerate case: every source was non-processable, so totalPapers was
    // set to 0 at enqueue time. Fail the job immediately so the UI is not
    // stuck on "extracting".
    if (total === 0) {
      assertValidJobTransition(job.status as JobStatus, "failed");
      await ctx.db.patch("extractionJobs", args.jobId, {
        status: "failed",
        completedAt: now,
        updatedAt: now,
      });
      // Tier D: release any reservations that survived the immediate-fail
      // path. With total === 0 the fan-out couldn't have run, but resume
      // / retry paths could have left reservations here in theory.
      await ctx.scheduler.runAfter(
        0,
        internal.extraction.mutations.internal.lifecycle
          .releaseUnsettledPaperReservationsForJob,
        { jobId: args.jobId },
      );
      return null;
    }

    const { processed, failed } = await readJobCounters(ctx, args.jobId);

    // Tier B: when the job is still mid-flight, do not patch the row.
    // Bumping `updatedAt` here would re-introduce per-paper OCC contention
    // on the same singleton row that the sharded counter just eliminated.
    // `updatedAt` is owned by genuine state transitions only — for "last
    // activity" the sharded counter values themselves are reactive.
    if (processed + failed < total) {
      return null;
    }

    const status: JobStatus = failed >= total ? "failed" : "completed";
    assertValidJobTransition(job.status as JobStatus, status);
    await ctx.db.patch("extractionJobs", args.jobId, {
      status,
      completedAt: now,
      updatedAt: now,
    });
    // Tier D: release any paper reservations that didn't settle on the
    // happy path. With `status === "completed"` every paper that landed
    // a terminal status went through `finalizePaper`, which settled and
    // cleared `reservationId` — so this is usually a no-op. The sweep
    // exists for `status === "failed"` (no per-paper settle ran) and for
    // edge cases where a paper terminalized via `markPaperTerminalTx`
    // without going through finalizePaper's settle branch.
    await ctx.scheduler.runAfter(
      0,
      internal.extraction.mutations.internal.lifecycle
        .releaseUnsettledPaperReservationsForJob,
      { jobId: args.jobId },
    );
    return null;
  },
});

/**
 * Tier D — sweep paper-level reservations that survived a terminal job
 * transition. Scheduled async from `maybeFinalizeJob` and
 * `cancelExtraction` so the user-facing mutation doesn't pay the O(P)
 * scan + release cost in its own tx.
 *
 * Idempotent: `releaseReservationTransaction` probes for an existing
 * `reservation_release` before inserting an offset, so re-running this
 * mutation (cron retry, replay) is a no-op. The paper-row clear is
 * unconditional but writing the same `reservationId: undefined` twice
 * is a no-op.
 *
 * Batched implicitly: PAPER_LIMIT_MAX is 1000 and most jobs are far
 * below it; if Convex's per-mutation write budget ever pushes back we
 * can split into a self-scheduling resume pattern, but that's premature.
 */
export const releaseUnsettledPaperReservationsForJob = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ released: v.number() }),
  handler: async (ctx, args): Promise<{ released: number }> => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(PAPER_LIMIT_MAX);

    let released = 0;
    for (const paper of papers) {
      if (paper.reservationId === undefined) continue;
      await releaseReservationTransaction(ctx, {
        reservationId: paper.reservationId,
        description: "Reservation released (job terminal)",
      });
      await ctx.db.patch(paper._id, { reservationId: undefined });
      released++;
    }

    return { released };
  },
});

export const createJobDirect = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    sourceType: sourceTypeValidator,
    bucketItems: v.array(bucketItemInputValidator),
  },
  returns: v.id("extractionJobs"),
  handler: async (ctx, args) => {
    const jobId = await ctx.db.insert("extractionJobs", {
      userId: args.userId,
      mode: "extraction" as const,
      name: args.name,
      sourceType: args.sourceType,
      status: "pending",
      totalPapers: 0,
      runEpoch: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await writeJobSources(ctx, jobId, args.bucketItems);
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
    await ctx.db.patch("extractionJobs", args.jobId, {
      workflowId: args.workflowId,
    });
    return null;
  },
});
