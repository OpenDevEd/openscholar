/**
 * Extraction job lifecycle mutations (public API).
 *
 * startExtraction / duplicateExtraction / startExtractionFromTemplate own
 * the workflow-start path; cancelExtraction / deleteExtraction own the
 * terminal paths. The surviving mutations.ts barrel re-exports all five
 * at `api.extraction.mutations.<fn>`, so external callers don't change.
 */

import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { WorkflowId } from "@convex-dev/workflow";
import type { WorkId } from "@convex-dev/workpool";
import { pdfProcessingPool } from "../../workpool";
import { workflow } from "../../workflow";
import { requireAuth } from "../../lib/auth";
import { requireFeature } from "../../featureFlags/guard";
import { rateLimit } from "../../lib/rateLimit";
import { createError } from "../../lib/errors";
import { PAPER_LIMIT_MAX, assertBucketWithinLimits } from "../bucket/limits";
import { dedupeBucketItems } from "../../../lib/bucket/dedupe";
import { assertValidJobTransition, type JobStatus } from "../stateMachine";
import {
  bucketItemInputValidator,
  questionInputValidator,
  MAX_QUESTIONS_PER_JOB,
  MAX_QUESTION_TEXT_LENGTH,
} from "../validators";
import {
  readJobSources,
  writeJobSources,
  type BucketItemInput,
} from "../jobSources";

function deriveSourceType(
  items: ReadonlyArray<BucketItemInput>,
): "history" | "zotero" | "manual" | "mixed" {
  const kinds = new Set<"history" | "zotero" | "manual">();
  for (const item of items) {
    if (item.source === "history") kinds.add("history");
    else if (item.source === "zotero") kinds.add("zotero");
    else kinds.add("manual");
  }
  if (kinds.size >= 2) return "mixed";
  if (kinds.has("history")) return "history";
  if (kinds.has("zotero")) return "zotero";
  return "manual";
}

export const startExtraction = mutation({
  args: {
    name: v.string(),
    bucketItems: v.array(bucketItemInputValidator),
    questions: v.array(questionInputValidator),
  },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  handler: async (ctx, args): Promise<{ jobId: Id<"extractionJobs"> }> => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await requireFeature(ctx, "extraction.start", user._id);
    await rateLimit(ctx, {
      name: "start-extraction",
      key: user._id,
      throws: true,
    });

    if (args.questions.length > MAX_QUESTIONS_PER_JOB) {
      throw createError(
        "VALIDATION_ERROR",
        `questions exceeds maximum of ${MAX_QUESTIONS_PER_JOB}`,
      );
    }
    for (const q of args.questions) {
      if (q.question.length > MAX_QUESTION_TEXT_LENGTH) {
        throw createError(
          "VALIDATION_ERROR",
          `question text exceeds maximum length of ${MAX_QUESTION_TEXT_LENGTH}`,
        );
      }
    }

    // Validate post-dedupe so duplicate rows don't double-count toward
    // the cap (matches the workflow's actual paper-creation set).
    const deduped = dedupeBucketItems(args.bucketItems);
    await assertBucketWithinLimits(ctx, user._id, deduped);
    const sourceType = deriveSourceType(deduped);

    const jobId: Id<"extractionJobs"> = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      mode: "extraction" as const,
      name: args.name,
      sourceType,
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await writeJobSources(ctx, jobId, deduped);

    for (let i = 0; i < args.questions.length; i++) {
      await ctx.db.insert("extractionQuestions", {
        jobId,
        key: args.questions[i].key,
        question: args.questions[i].question,
        type: args.questions[i].type,
        description: args.questions[i].description,
        order: i,
        createdAt: Date.now(),
      });
    }

    const workflowId = await workflow.start(
      ctx,
      internal.extraction.workflow.runExtractionWorkflow,
      { jobId },
      {
        onComplete:
          internal.extraction.mutations.internal.onComplete
            .handleExtractionJobComplete,
        context: { jobId },
      },
    );

    await ctx.db.patch("extractionJobs", jobId, {
      workflowId,
      updatedAt: Date.now(),
    });

    return { jobId };
  },
});

export const cancelExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const user = await requireAuth(ctx);

    const job = await ctx.db.get("extractionJobs", args.jobId);

    if (!job || job.userId !== user._id) {
      throw createError("NOT_FOUND", "Job not found");
    }

    if (job.status && ["completed", "failed", "cancelled"].includes(job.status)) {
      return { success: true };
    }

    assertValidJobTransition(job.status as JobStatus, "cancelled");
    await ctx.db.patch("extractionJobs", args.jobId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });

    if (job.workflowId) {
      try {
        await workflow.cancel(ctx, job.workflowId as WorkflowId);
      } catch (e) {
        console.warn(`[cancelExtraction] Failed to cancel workflow: ${e}`);
      }
    }

    // The pdfProcessingPool is shared across tenants; cancelAll() would be a
    // cross-tenant DoS. Cancel only this job's stored workId values; cancels
    // are idempotent per workpool contract.
    //
    // Bound by `PAPER_LIMIT_MAX` (the cross-plan ceiling), NOT by the
    // user's current `getPaperLimit` — a plan downgrade between job-start
    // and cancel must still cancel every workpool item the job created,
    // and `assertBucketWithinLimits` already prevents jobs from exceeding
    // `PAPER_LIMIT_MAX` rows at submit time.
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(PAPER_LIMIT_MAX);

    for (const paper of papers) {
      if (!paper.workId) continue;
      if (
        paper.status === "completed" ||
        paper.status === "failed" ||
        paper.status === "download_failed" ||
        paper.status === "indexing_failed"
      ) {
        continue;
      }
      try {
        await pdfProcessingPool.cancel(ctx, paper.workId as WorkId);
      } catch (e) {
        console.warn(
          `[cancelExtraction] Failed to cancel workpool item ${paper.workId} for paper ${paper._id}: ${e}`,
        );
      }
    }

    return { success: true };
  },
});

export const duplicateExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  handler: async (ctx, args): Promise<{ jobId: Id<"extractionJobs"> }> => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await requireFeature(ctx, "extraction.start", user._id);
    await rateLimit(ctx, {
      name: "start-extraction",
      key: user._id,
      throws: true,
    });

    const oldJob = await ctx.db.get("extractionJobs", args.jobId);
    if (!oldJob || oldJob.userId !== user._id) {
      throw createError("NOT_FOUND", "Job not found");
    }

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

    // Bound the read by the cross-plan ceiling so a downgrade between
    // original-job-creation and duplication can't truncate the source set
    // before validation. The validator below rejects oversized buckets
    // outright, so honest jobs round-trip and bypass-jobs surface as a
    // VALIDATION_ERROR instead of silently shrinking.
    const bucketItems = await readJobSources(
      ctx,
      args.jobId,
      PAPER_LIMIT_MAX * 2,
    );
    await assertBucketWithinLimits(ctx, user._id, bucketItems);

    const newJobId = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      mode: "extraction" as const,
      name: `${oldJob.name} (Copy)`,
      sourceType: oldJob.sourceType,
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await writeJobSources(ctx, newJobId, bucketItems);

    for (const q of questions) {
      await ctx.db.insert("extractionQuestions", {
        jobId: newJobId,
        key: q.key,
        question: q.question,
        type: q.type,
        description: q.description,
        order: q.order,
        createdAt: Date.now(),
      });
    }

    const workflowId = await workflow.start(
      ctx,
      internal.extraction.workflow.runExtractionWorkflow,
      { jobId: newJobId },
      {
        onComplete:
          internal.extraction.mutations.internal.onComplete
            .handleExtractionJobComplete,
        context: { jobId: newJobId },
      },
    );

    await ctx.db.patch("extractionJobs", newJobId, {
      workflowId,
      updatedAt: Date.now(),
    });

    return { jobId: newJobId };
  },
});

export const startExtractionFromTemplate = mutation({
  args: {
    templateId: v.id("extractionWorkflowTemplates"),
    name: v.optional(v.string()),
  },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await requireFeature(ctx, "extraction.start", user._id);
    await rateLimit(ctx, {
      name: "start-extraction",
      key: user._id,
      throws: true,
    });
    const template = await ctx.db.get(
      "extractionWorkflowTemplates",
      args.templateId,
    );
    if (!template || template.userId !== user._id) {
      throw createError("NOT_FOUND", "Template not found");
    }

    const deduped = dedupeBucketItems(template.bucketItems);
    await assertBucketWithinLimits(ctx, user._id, deduped);
    const sourceType = deriveSourceType(deduped);

    const jobId: Id<"extractionJobs"> = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      mode: "extraction" as const,
      name: args.name?.trim() || `${template.name} (Rerun)`,
      sourceType,
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await writeJobSources(ctx, jobId, deduped);

    for (let i = 0; i < template.questions.length; i++) {
      const question = template.questions[i];
      await ctx.db.insert("extractionQuestions", {
        jobId,
        key: question.key,
        question: question.question,
        type: question.type,
        description: question.description,
        order: i,
        createdAt: Date.now(),
      });
    }

    const workflowId = await workflow.start(
      ctx,
      internal.extraction.workflow.runExtractionWorkflow,
      { jobId },
      {
        onComplete:
          internal.extraction.mutations.internal.onComplete
            .handleExtractionJobComplete,
        context: { jobId },
      },
    );
    await ctx.db.patch("extractionJobs", jobId, {
      workflowId,
      updatedAt: Date.now(),
    });

    return { jobId };
  },
});

export const deleteExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const job = await ctx.db.get("extractionJobs", args.jobId);
    if (!job || job.userId !== user._id) {
      throw createError("NOT_FOUND", "Job not found");
    }

    // Schedule the cascade delete as an independent mutation to avoid
    // transaction limits on a large job's child tables.
    await ctx.scheduler.runAfter(
      0,
      internal.extraction.mutations.internal.admin.deleteExtractionInternal,
      { jobId: args.jobId },
    );

    return null;
  },
});
