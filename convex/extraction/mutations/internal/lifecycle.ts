/**
 * Internal job / question lifecycle mutations — the plumbing the
 * workflow calls between source fetch and paper processing.
 *
 *   - maybeFinalizeJob: O(1) "all done" check from extractionJobs counters.
 *   - createJobDirect / createQuestionDirect: test-and-workflow job/question
 *     record creation used by fixtures and the workflow step.
 *   - setJobWorkflowId: patch the workflow handle after workflow.start().
 *
 * Plan-02 retires the per-paper workpool enqueue helper that used to
 * live here — the workflow handler now calls downloadAndIndexPdfAction
 * and extractOneQuestion directly via step.runAction.
 */

import { internalMutation } from "../../../_generated/server";
import { v } from "convex/values";
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
    const processed = job.processedPapers ?? 0;
    const failed = job.failedPapers ?? 0;

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
      processedPapers: 0,
      failedPapers: 0,
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
