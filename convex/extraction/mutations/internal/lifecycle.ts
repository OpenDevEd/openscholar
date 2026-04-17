/**
 * Internal job / question / enqueue lifecycle mutations — the plumbing
 * the workflow calls between source fetch and paper processing.
 *
 *   - maybeFinalizeJob: O(1) "all done" check from extractionJobs counters.
 *   - createJobDirect / createQuestionDirect: test-and-workflow job/question
 *     record creation used by fixtures and the workflow step.
 *   - setJobWorkflowId: patch the workflow handle after workflow.start().
 *   - enqueuePaperProcessing: bump paper to "downloading" and schedule
 *     Step 1 of the 3-step pipeline on pdfProcessingPool.
 */

import { internalMutation } from "../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { pdfProcessingPool } from "../../../workpool";
import { writeJobSources } from "../../jobSources";
import {
  assertValidJobTransition,
  type JobStatus,
} from "../../stateMachine";
import {
  historyEntryInputValidator,
  manualItemInputValidator,
  questionInputValidator,
  questionTypeValidator,
  sourceTypeValidator,
  zoteroSelectionInputValidator,
} from "../../validators";

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
    await ctx.db.patch("extractionJobs", args.jobId, {
      workflowId: args.workflowId,
    });
    return null;
  },
});

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
    console.log(
      `[enqueuePaperProcessing] START - Paper ${args.paperId}, PDF URL: ${args.pdfUrl ? "YES" : "NO"}`,
    );

    await ctx.db.patch("extractionPapers", args.paperId, {
      status: "downloading",
    });
    console.log(
      `[enqueuePaperProcessing] Status updated to 'downloading' for ${args.paperId}`,
    );

    // Enqueue Step 1: Download and index PDF. Capture the WorkId so
    // cancelExtraction can abort this specific item without touching other
    // jobs' in-flight work in the shared pool.
    console.log(
      `[enqueuePaperProcessing] Enqueuing Step 1 (Download & Index) for paper ${args.paperId}`,
    );
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
        onComplete:
          internal.extraction.mutations.internal.onComplete.handleDownloadAndIndexComplete,
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
      },
    );
    await ctx.db.patch("extractionPapers", args.paperId, { workId });
    console.log(
      `[enqueuePaperProcessing] SUCCESS - Paper ${args.paperId} enqueued for processing (workId ${workId})`,
    );
    return null;
  },
});
