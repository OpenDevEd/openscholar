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
import { getPaperLimit } from "../bucket/limits";
import { buildDedupeKey } from "../dedupe";
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
  type JobSourceHistoryEntry,
  type JobSourceManualItem,
  type JobSourceZoteroSelection,
  type JobSourceZoteroItem,
  type JobSourcesInput,
} from "../jobSources";

type BucketItemInput = {
  bucketKey: string;
  source: "history" | "library" | "collection" | "zotero" | "upload";
  sourceRefId: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  openalexId?: string;
  abstract?: string;
  storageId?: Id<"_storage">;
  pdfUrl?: string;
  searchFilters?: JobSourceHistoryEntry["searchFilters"];
  libraryType?: "user" | "group";
  groupId?: string;
  zoteroUserId?: string;
  collectionKey?: string;
};

function bucketToJobSources(
  items: ReadonlyArray<BucketItemInput>,
): JobSourcesInput {
  const historyEntries: JobSourceHistoryEntry[] = [];
  const zoteroItems: JobSourceZoteroItem[] = [];
  let zoteroContext: Omit<JobSourceZoteroSelection, "items"> | undefined;
  const manualItems: JobSourceManualItem[] = [];

  for (const item of items) {
    if (item.source === "history") {
      if (!item.searchFilters) continue;
      historyEntries.push({
        historyId: item.sourceRefId,
        searchFilters: item.searchFilters,
      });
    } else if (item.source === "zotero") {
      if (!item.libraryType) continue;
      if (!zoteroContext) {
        zoteroContext = {
          libraryType: item.libraryType,
          groupId: item.groupId,
          zoteroUserId: item.zoteroUserId,
          collectionKey: item.collectionKey,
        };
      }
      zoteroItems.push({
        itemKey: item.sourceRefId,
        title: item.title,
        abstract: item.abstract,
        authors: item.authors,
        year: item.year,
        doi: item.doi,
      });
    } else {
      // library / collection / upload — all flow through the existing
      // manual-item schema. openalexId on library/collection rows is
      // preserved on the server-side paper lookup via DOI; the manual
      // row id falls back to the bucket's sourceRefId.
      manualItems.push({
        id: item.sourceRefId,
        title: item.title,
        abstract: item.abstract,
        authors: item.authors,
        year: item.year,
        doi: item.doi,
        pdfUrl: item.pdfUrl,
        storageId: item.storageId,
      });
    }
  }

  return {
    historyEntries: historyEntries.length > 0 ? historyEntries : undefined,
    zoteroSelection: zoteroContext
      ? { ...zoteroContext, items: zoteroItems }
      : undefined,
    manualItems: manualItems.length > 0 ? manualItems : undefined,
  };
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

    // Cap check via plan-aware helper.
    const limit = await getPaperLimit(ctx, user._id);
    if (args.bucketItems.length > limit) {
      throw createError(
        "VALIDATION_ERROR",
        `Bucket exceeds plan limit of ${limit} papers`,
      );
    }
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

    // Server-side dedup — defense in depth. If the client submits two
    // items that collapse to the same key, we keep the first and drop
    // the rest silently.
    const seen = new Set<string>();
    const deduped: BucketItemInput[] = [];
    for (const item of args.bucketItems) {
      const key = buildDedupeKey({
        openalexId: item.openalexId,
        doi: item.doi,
        title: item.title,
        year: item.year,
      });
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    // Derive sourceType from the distinct bucket sources. Library /
    // collection / upload all pipeline-wise are "manual", so three
    // post-collapse kinds are possible on the job row.
    const kinds = new Set<"history" | "zotero" | "manual">();
    for (const item of deduped) {
      if (item.source === "history") kinds.add("history");
      else if (item.source === "zotero") kinds.add("zotero");
      else kinds.add("manual");
    }
    const sourceType: "history" | "zotero" | "manual" | "mixed" =
      kinds.size >= 2
        ? "mixed"
        : kinds.has("history")
          ? "history"
          : kinds.has("zotero")
            ? "zotero"
            : "manual";

    const userId = user._id;

    const jobId: Id<"extractionJobs"> = await ctx.db.insert("extractionJobs", {
      userId,
      name: args.name,
      sourceType,
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await writeJobSources(ctx, jobId, bucketToJobSources(deduped));

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

    if (["completed", "failed", "cancelled"].includes(job.status)) {
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
    const limit = await getPaperLimit(ctx, user._id);
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(limit);

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

    const duplicateLimit = await getPaperLimit(ctx, user._id);
    const { historyEntries, zoteroSelection, manualItems } =
      await readJobSources(ctx, args.jobId, duplicateLimit * 2);

    const newJobId = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      name: `${oldJob.name} (Copy)`,
      sourceType: oldJob.sourceType,
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await writeJobSources(ctx, newJobId, {
      historyEntries,
      zoteroSelection,
      manualItems,
    });

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

    const jobId: Id<"extractionJobs"> = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      name: args.name?.trim() || `${template.name} (Rerun)`,
      sourceType: template.sourceType,
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await writeJobSources(ctx, jobId, {
      historyEntries: template.sourceHistoryEntries as
        | JobSourceHistoryEntry[]
        | undefined,
      zoteroSelection: template.sourceZoteroSelection as
        | JobSourceZoteroSelection
        | undefined,
      manualItems: template.sourceManualItems as
        | JobSourceManualItem[]
        | undefined,
    });

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
