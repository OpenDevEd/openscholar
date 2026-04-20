/**
 * Job lifecycle mutations (public API).
 *
 * startJob / duplicateJob / startJobFromTemplate own the job-start path;
 * cancelExtraction / deleteExtraction own the terminal paths. The
 * surviving mutations.ts barrel re-exports all five at
 * `api.extraction.mutations.<fn>`, so external callers don't change.
 *
 * startJob is mode-aware: `mode: "extraction"` launches the data
 * extraction workflow (existing behaviour); `mode: "chat"` schedules
 * the P9.T10 ensureThreadForJob stub. Validation, auth, rate-limit
 * and bucket persistence are shared between both branches.
 *
 * cancelExtraction and deleteExtraction stay extraction-specific.
 * cancelExtraction rejects chat jobs up front; deleteExtraction
 * cascades for both modes (cascade is mode-agnostic).
 */

import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { WorkflowId } from "@convex-dev/workflow";
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
  writeJobSources,
  type BucketItemInput,
} from "../jobSources";
import { cloneChatPapersForDuplicate } from "../../chat/chatPapersDuplicate";

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

export const startJob = mutation({
  args: {
    name: v.string(),
    mode: v.union(v.literal("extraction"), v.literal("chat")),
    bucketItems: v.array(bucketItemInputValidator),
    // extraction-only
    questions: v.optional(v.array(questionInputValidator)),
    usePdfs: v.optional(v.boolean()),
    // chat-only
    chatModelId: v.optional(v.id("models")),
  },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  handler: async (ctx, args): Promise<{ jobId: Id<"extractionJobs"> }> => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    if (args.mode === "extraction") {
      await requireFeature(ctx, "extraction.start", user._id);
    } else {
      await requireFeature(ctx, "extraction.chat", user._id);
    }
    await rateLimit(ctx, {
      name: "start-extraction",
      key: user._id,
      throws: true,
    });

    // Shared: bucket validation + source persistence.
    const deduped = dedupeBucketItems(args.bucketItems);
    await assertBucketWithinLimits(ctx, user._id, deduped);
    const sourceType = deriveSourceType(deduped);

    // Extraction-mode question validation happens after bucket validation
    // so an empty bucket throws first (consistent with the old path).
    if (args.mode === "extraction") {
      const qs = args.questions ?? [];
      if (qs.length > MAX_QUESTIONS_PER_JOB) {
        throw createError(
          "VALIDATION_ERROR",
          `questions exceeds maximum of ${MAX_QUESTIONS_PER_JOB}`,
        );
      }
      for (const q of qs) {
        if (q.question.length > MAX_QUESTION_TEXT_LENGTH) {
          throw createError(
            "VALIDATION_ERROR",
            `question text exceeds maximum length of ${MAX_QUESTION_TEXT_LENGTH}`,
          );
        }
      }
    }

    const now = Date.now();
    const jobId: Id<"extractionJobs"> = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      mode: args.mode,
      name: args.name,
      sourceType,
      createdAt: now,
      updatedAt: now,
      ...(args.mode === "extraction"
        ? {
            status: "pending" as const,
            totalPapers: 0,
            processedPapers: 0,
            failedPapers: 0,
            usePdfs: args.usePdfs ?? false,
          }
        : {
            messageCount: 0,
            chatModelId: args.chatModelId,
          }),
    });

    await writeJobSources(ctx, jobId, deduped);

    if (args.mode === "extraction") {
      const qs = args.questions ?? [];
      for (let i = 0; i < qs.length; i++) {
        await ctx.db.insert("extractionQuestions", {
          jobId,
          key: qs[i].key,
          question: qs[i].question,
          type: qs[i].type,
          description: qs[i].description,
          order: i,
          createdAt: now,
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
    } else {
      // Chat branch: schedule thread creation. The scheduler target is the
      // P9.T10 stub for now — it throws FEATURE_DISABLED. The job row
      // still lands so the UI has something to navigate to; chat is
      // gated behind the extraction.chat flag (default OFF) at entry.
      await ctx.scheduler.runAfter(
        0,
        internal.chat.threads.ensureThreadForJob,
        { jobId },
      );
    }

    return { jobId };
  },
});

export const duplicateJob = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  handler: async (ctx, args): Promise<{ jobId: Id<"extractionJobs"> }> => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);

    const oldJob = await ctx.db.get("extractionJobs", args.jobId);
    if (!oldJob || oldJob.userId !== user._id) {
      throw createError("NOT_FOUND", "Job not found");
    }

    // Feature gate + rate limit, branched by mode.
    if (oldJob.mode === "chat") {
      await requireFeature(ctx, "extraction.chat", user._id);
    } else {
      await requireFeature(ctx, "extraction.start", user._id);
    }
    await rateLimit(ctx, {
      name: "start-extraction",
      key: user._id,
      throws: true,
    });

    // Read old source rows in position order — we need _ids (not just
    // bucket-item shape) to build the old→new source mapping for the
    // chat-mode chatPapers clone.
    const oldSourceRows = await ctx.db
      .query("extractionJobSources")
      .withIndex("by_job_and_position", (q) => q.eq("jobId", args.jobId))
      .take(PAPER_LIMIT_MAX * 2);
    const bucketItems: BucketItemInput[] = oldSourceRows.map((row) => ({
      bucketKey: row.bucketKey,
      source: row.source,
      sourceRefId: row.sourceRefId,
      title: row.title,
      authors: row.authors,
      year: row.year,
      doi: row.doi,
      openalexId: row.openalexId,
      abstract: row.abstract,
      pdfUrl: row.pdfUrl,
      storageId: row.storageId,
      searchFilters: row.searchFilters,
      libraryType: row.libraryType,
      groupId: row.groupId,
      zoteroUserId: row.zoteroUserId,
      collectionKey: row.collectionKey,
      includeDescendants: row.includeDescendants,
    }));
    await assertBucketWithinLimits(ctx, user._id, bucketItems);

    const now = Date.now();

    if (oldJob.mode === "chat") {
      const newJobId = await ctx.db.insert("extractionJobs", {
        userId: user._id,
        mode: "chat" as const,
        name: `${oldJob.name} (Copy)`,
        sourceType: oldJob.sourceType,
        messageCount: 0,
        chatModelId: oldJob.chatModelId,
        createdAt: now,
        updatedAt: now,
      });

      const newSourceIds = await writeJobSources(ctx, newJobId, bucketItems);
      const sourceIdMap = new Map<
        Id<"extractionJobSources">,
        Id<"extractionJobSources">
      >();
      for (let i = 0; i < oldSourceRows.length; i++) {
        sourceIdMap.set(oldSourceRows[i]._id, newSourceIds[i]);
      }

      const oldChatPapers = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
        .collect();
      const newChatPaperRows = cloneChatPapersForDuplicate(
        newJobId,
        oldChatPapers.map((r) => ({
          sourceId: r.sourceId,
          included: r.included,
        })),
        sourceIdMap,
      );
      for (const row of newChatPaperRows) {
        await ctx.db.insert("chatPapers", row);
      }

      await ctx.scheduler.runAfter(
        0,
        internal.chat.threads.createThreadForDuplicatedJob,
        { jobId: newJobId },
      );

      return { jobId: newJobId };
    }

    // Extraction-mode duplicate.
    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

    const newJobId = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      mode: "extraction" as const,
      name: `${oldJob.name} (Copy)`,
      sourceType: oldJob.sourceType,
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      usePdfs: oldJob.usePdfs ?? false,
      createdAt: now,
      updatedAt: now,
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
        createdAt: now,
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

export const startJobFromTemplate = mutation({
  args: {
    templateId: v.id("extractionWorkflowTemplates"),
    name: v.optional(v.string()),
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

    const now = Date.now();
    const jobId: Id<"extractionJobs"> = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      mode: "extraction" as const,
      name: args.name?.trim() || `${template.name} (Rerun)`,
      sourceType,
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      usePdfs: false,
      createdAt: now,
      updatedAt: now,
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
        createdAt: now,
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

    if (job.mode === "chat") {
      throw createError(
        "VALIDATION_ERROR",
        "Chat jobs cannot be cancelled this way",
      );
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

    // Plan-02 removed the workpool-driven per-paper pipeline — the
    // workflow handler now owns every paper via step.runAction. The
    // workflow.cancel call above short-circuits queued steps; any
    // in-flight action sees the cancelled job on its next status check
    // and returns without persisting.
    return { success: true };
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
    // transaction limits on a large job's child tables. Cascade is
    // mode-agnostic — chat jobs carry extractionJobSources too.
    await ctx.scheduler.runAfter(
      0,
      internal.extraction.mutations.internal.admin.deleteExtractionInternal,
      { jobId: args.jobId },
    );

    return null;
  },
});
