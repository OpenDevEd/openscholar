/**
 * Internal job / question lifecycle mutations — the plumbing the
 * queue setup action calls between source fetch and paper processing.
 *
 *   - maybeFinalizeJob: O(1) "all done" check from extractionJobs counters.
 *   - createJobDirect / createQuestionDirect: test/queue job/question
 *     record creation used by fixtures and setup helpers.
 *   - clearAdmittedPaperCreditsForJob: clears per-paper admission markers
 *     that survived a terminal job transition.
 *
 * Plan-02 retires the per-paper workpool enqueue helper that used to
 * live here — paper queue workers call download/index and extraction
 * helpers directly through Workpool actions.
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
import { clearJobPaperQuestionAdmissionsTx } from "../../creditAdmissions";

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
      // while the job is parked — the resume path
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
      await ctx.scheduler.runAfter(
        0,
        internal.extraction.mutations.internal.lifecycle
          .clearAdmittedPaperCreditsForJob,
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
    await ctx.scheduler.runAfter(
      0,
      internal.extraction.mutations.internal.lifecycle
        .clearAdmittedPaperCreditsForJob,
      { jobId: args.jobId },
    );
    return null;
  },
});

/**
 * Clear per-paper admission markers that survived a terminal job
 * transition. This does not touch the credit ledger because admission is
 * only a start gate; final billing writes the settled usage transaction.
 */
export const clearAdmittedPaperCreditsForJob = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ cleared: v.number() }),
  handler: async (ctx, args): Promise<{ cleared: number }> => {
    return await clearJobPaperQuestionAdmissionsTx(ctx, args);
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
