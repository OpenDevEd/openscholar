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

import { mutation } from "../../lib/functions";
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
import { refillPerson } from "../queue/dispatcher";
import { assistantMutation, defineUserMutation, userMutation } from "../../lib/userActions";
import { checkScreeningSelection } from "../sources/screening";
import { bucketItemFromRow } from "../jobSources";

function deriveSourceType(
  items: ReadonlyArray<BucketItemInput>,
): "history" | "zotero" | "manual" | "screening" | "mixed" {
  const kinds = new Set<"history" | "zotero" | "manual" | "screening">();
  for (const item of items) {
    if (item.source === "history") kinds.add("history");
    else if (item.source === "zotero") kinds.add("zotero");
    else if (item.source === "screening") kinds.add("screening");
    else kinds.add("manual");
  }
  if (kinds.size >= 2) return "mixed";
  if (kinds.has("history")) return "history";
  if (kinds.has("zotero")) return "zotero";
  if (kinds.has("screening")) return "screening";
  return "manual";
}

export const startJobAction = defineUserMutation({
  path: "extraction/mutations:startJob",
  description: "Start extraction or a source chat from selected sources. Screening sources use the owned job's current Included papers and require its decision revision. Extraction saves those papers unchanged by later screening edits. At most 1,000 papers per job.",
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
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
  run: async (ctx, userId, args): Promise<{ jobId: Id<"extractionJobs"> }> => {
    await requireFeature(ctx, "extraction.enabled", userId);
    if (args.mode === "extraction") {
      await requireFeature(ctx, "extraction.start", userId);
    } else {
      await requireFeature(ctx, "extraction.chat", userId);
    }
    await rateLimit(ctx, {
      name: "start-extraction",
      key: userId,
      throws: true,
    });

    // Shared: bucket validation + source persistence.
    if (args.bucketItems.length > PAPER_LIMIT) throw createError("VALIDATION_ERROR", `An extraction can hold up to ${PAPER_LIMIT} sources.`);
    const deduped = dedupeBucketItems(args.bucketItems);
    for (const item of deduped) {
      if (item.source !== "screening") continue;
      if (args.mode !== "extraction" || !item.screeningSelection) {
        throw createError("VALIDATION_ERROR", "Select a screening job and its decision revision for extraction.");
      }
      const selection = item.screeningSelection;
      selection.count = await checkScreeningSelection(ctx, userId, selection.jobId, selection.revision);
      item.sourceRefId = selection.jobId;
    }
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
        const totalAvailable = await readAvailableCredits(ctx, userId);
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
      : await resolveTaskPick(ctx, userId, "chat");

    // Stamp what extraction runs on (credits path), read back at run by paperWorker.
    const stamp = args.mode === "extraction" ? await extractionStamp(ctx, userId) : {};

    const now = Date.now();
    const jobId: Id<"extractionJobs"> = await ctx.db.insert("extractionJobs", {
      userId,
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

export const startJob = userMutation(startJobAction);
export const startJobForAssistant = assistantMutation(startJobAction);

export const duplicateJobAction = defineUserMutation({
  path: "extraction/mutations:duplicateJob",
  description: "Duplicate a job's questions and sources. Screening sources must still have the saved decision revision; if decisions changed, select the screening again in a new extraction.",
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  run: async (ctx, userId, args): Promise<{ jobId: Id<"extractionJobs"> }> => {
    await requireFeature(ctx, "extraction.enabled", userId);

    const oldJob = await ctx.db.get("extractionJobs", args.jobId);
    if (!oldJob || oldJob.userId !== userId) {
      throw createError("NOT_FOUND", "Job not found");
    }

    // Feature gate + rate limit, branched by mode.
    if (oldJob.mode === "chat") {
      await requireFeature(ctx, "extraction.chat", userId);
    } else {
      await requireFeature(ctx, "extraction.start", userId);
    }
    await rateLimit(ctx, {
      name: "start-extraction",
      key: userId,
      throws: true,
    });

    // Read old source rows in position order — we need _ids (not just
    // bucket-item shape) to build the old→new source mapping for the
    // chat-mode chatPapers clone.
    const oldSourceRows = await ctx.db
      .query("extractionJobSources")
      .withIndex("by_job_and_position", (q) => q.eq("jobId", args.jobId))
      .take(PAPER_LIMIT * 2);
    const bucketItems = oldSourceRows.map(bucketItemFromRow);
    for (const item of bucketItems) {
      if (item.source === "screening" && item.screeningSelection) await checkScreeningSelection(ctx, userId, item.screeningSelection.jobId, item.screeningSelection.revision);
    }
    assertBucketWithinLimits(bucketItems);

    const now = Date.now();

    if (oldJob.mode === "chat") {
      const newJobId = await ctx.db.insert("extractionJobs", {
        userId,
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
        .take(PAPER_LIMIT);
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
      .take(MAX_QUESTIONS_PER_JOB);

    const dupStamp = await extractionStamp(ctx, userId);
    const newJobId = await ctx.db.insert("extractionJobs", {
      userId,
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

export const duplicateJob = userMutation(duplicateJobAction);
export const duplicateJobForAssistant = assistantMutation(duplicateJobAction);

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
    // Its papers no longer count against the person's limit; their other jobs start in it.
    await refillPerson(ctx, job.userId);

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
    // Its papers stop holding the person's capacity now, not when the cascade reaches them.
    await cancelPaperQueueRowsForJobTx(ctx, { jobId: args.jobId });
    await refillPerson(ctx, user._id);

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
