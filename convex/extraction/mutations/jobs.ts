/**
 * Job lifecycle mutations (public API).
 *
 * startJob / duplicateJob own the job-start path; cancelExtraction /
 * deleteExtraction own the terminal paths.
 *
 * startJob is mode-aware: `mode: "extraction"` schedules the app-owned
 * paper queue setup action; `mode: "chat"` schedules thread creation.
 * Validation, auth, rate-limit and bucket persistence are shared between
 * both branches.
 *
 * cancelExtraction and deleteExtraction stay extraction-specific.
 * cancelExtraction rejects chat jobs up front; deleteExtraction
 * cascades for both modes (cascade is mode-agnostic).
 */

import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { requireFeature } from "../../featureFlags/guard";
import { extractionStamp, resolveTaskPick } from "../../ai/serverModel";
import { requireAvailableModel, requireTaskModel } from "../../models/catalog";
import { rateLimit } from "../../lib/rateLimit";
import { createError } from "../../lib/errors";
import { assertBucketWithinLimits } from "../bucket/limits";
import { PAPER_LIMIT } from "@/lib/extraction/limits";
import { availableCredits as readAvailableCredits } from "../../billing/accounts";
import { dedupeBucketItems } from "../../../lib/bucket/dedupe";
import { assertValidJobTransition, type JobStatus } from "../stateMachine";
import {
  bucketItemInputValidator,
  questionInputValidator,
  MAX_QUESTIONS_PER_JOB,
  MAX_QUESTION_TEXT_LENGTH,
} from "../validators";
import { writeJobSources, type BucketItemInput } from "../jobSources";
import { cloneChatPapersForDuplicate } from "../../chat/chatPapersDuplicate";
import {
  estimateExtractionCredits,
  type ExtractionCostEstimate,
} from "../../../lib/extraction/cost-estimate";
import { cancelPaperQueueRowsForJobTx } from "../queue/mutations";

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
    const bucketLimits = assertBucketWithinLimits(deduped);
    const sourceType = deriveSourceType(deduped);

    // Extraction-mode question validation happens after bucket validation
    // so an empty bucket throws first (consistent with the old path).
    let estimate: ExtractionCostEstimate | undefined;
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

      // Pre-flight credit check. Block against the high end of the estimate
      // — better to block at submission than fail mid-run. Mirrors the
      // screening pattern at convex/screening/mutations.ts:93-108 (reads
      // the credits row directly — avoids a sub-transaction round-trip).
      const usePdfs = args.usePdfs ?? false;
      estimate = estimateExtractionCredits({
        papers: bucketLimits.effectiveCount,
        questions: qs.length,
        usePdfs,
        avgPaperKind: usePdfs ? "pdf" : "abstract",
      });

      if (estimate.high > 0) {
        const totalAvailable = await readAvailableCredits(ctx, user._id);
        if (totalAvailable < estimate.high) {
          throw createError(
            "INSUFFICIENT_CREDITS",
            `Need ~${estimate.mid} credits (up to ${estimate.high}) for ${bucketLimits.effectiveCount} papers × ${qs.length} questions but only have ${totalAvailable}`,
          );
        }
      }
    }

    // Pre-resolve so the composer's controlled value is never null. A new chat
    // starts on the model and effort the user's choice gives chat, which
    // swapModel can still change per conversation.
    if (args.mode === "chat" && args.chatModelId !== undefined) {
      requireTaskModel(await requireAvailableModel(ctx, args.chatModelId), "chat");
    }
    const chatPick =
      args.mode !== "chat" ? null
      : args.chatModelId !== undefined ? { modelId: args.chatModelId }
      : await resolveTaskPick(ctx, user._id, "chat");

    // Stamp what extraction runs on (credits path), read back at run by paperWorker.
    const stamp = args.mode === "extraction" ? await extractionStamp(ctx, user._id) : {};

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
            runEpoch: 0,
            usePdfs: args.usePdfs ?? false,
            ...stamp,
            ...(estimate !== undefined && { estimatedCredits: estimate }),
          }
        : {
            messageCount: 0,
            chatModelId: chatPick?.modelId,
            ...(chatPick?.effort && { chatEffort: chatPick.effort }),
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

      await ctx.scheduler.runAfter(
        0,
        internal.extraction.actions.setupExtractionQueueJob,
        { jobId, expectedEpoch: 0 },
      );
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
      .take(PAPER_LIMIT * 2);
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
    assertBucketWithinLimits(bucketItems);

    const now = Date.now();

    if (oldJob.mode === "chat") {
      const newJobId = await ctx.db.insert("extractionJobs", {
        userId: user._id,
        mode: "chat" as const,
        name: `${oldJob.name} (Copy)`,
        sourceType: oldJob.sourceType,
        messageCount: 0,
        chatModelId: oldJob.chatModelId,
        ...(oldJob.chatEffort && { chatEffort: oldJob.chatEffort }),
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

    const dupStamp = await extractionStamp(ctx, user._id);
    const newJobId = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      mode: "extraction" as const,
      name: `${oldJob.name} (Copy)`,
      sourceType: oldJob.sourceType,
      status: "pending",
      totalPapers: 0,
      runEpoch: 0,
      usePdfs: oldJob.usePdfs ?? false,
      ...dupStamp,
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

    await ctx.scheduler.runAfter(
      0,
      internal.extraction.actions.setupExtractionQueueJob,
      { jobId: newJobId, expectedEpoch: 0 },
    );

    return { jobId: newJobId };
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

    if (
      job.status &&
      ["completed", "failed", "cancelled"].includes(job.status)
    ) {
      return { success: true };
    }

    assertValidJobTransition(job.status as JobStatus, "cancelled");
    await ctx.db.patch("extractionJobs", args.jobId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
    await cancelPaperQueueRowsForJobTx(ctx, { jobId: args.jobId });

    // Any in-flight paper action sees the cancelled job on its next
    // status check and returns without persisting.
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

    await ctx.db.delete(args.jobId);

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
