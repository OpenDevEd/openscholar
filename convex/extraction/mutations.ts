/**
 * Extraction Mutations
 * Public and internal mutations for data extraction jobs
 * Using Workflows and Workpools for durable execution
 */

import { mutation, internalMutation, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { PaperData, ExtractionResult } from "./types";
import type { Doc, Id } from "../_generated/dataModel";
import type { WorkflowId } from "@convex-dev/workflow";
import type { WorkId } from "@convex-dev/workpool";
import { pdfProcessingPool } from "../workpool";
import { getProcessableFlags } from "./content";
import { workflow } from "../workflow";
import { requireAuth } from "../lib/auth";
import { requireFeature, getFlag } from "../featureFlags/guard";
import { rateLimit } from "../lib/rateLimit";
import {
  aggregateQuestionInsights,
  buildDisagreementClusters,
  buildRunDiff,
  formatAnswerForDisplay,
  type DisagreementCluster,
  type InsightEntry,
  type QuestionInsightAggregate,
  type RunDiffRecord,
} from "../../lib/extraction/insights";

import { createError } from "../lib/errors";
import {
  assertExtractionInputLimits,
  searchFiltersValidator,
} from "./validators";
import { MAX_EVIDENCE_UNITS_PER_PAPER } from "../lib/queryBounds";

/** Safety bound for per-job paper queries to prevent unbounded memory usage. */
const MAX_PAPERS_PER_JOB = 500;

async function assertJobOwnership(
  ctx: MutationCtx,
  userId: Id<"users">,
  jobId: Id<"extractionJobs">
) {
  const job = await ctx.db.get("extractionJobs", jobId);
  if (!job || job.userId !== userId) {
    throw createError("NOT_FOUND", "Job not found");
  }
  return job;
}

async function loadJobDataForReporting(
  ctx: MutationCtx,
  jobId: Id<"extractionJobs">
) {
  // Cardinality: ~5-20 questions per extraction job
  const [questions, papers] = await Promise.all([
    ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .order("asc")
      .collect(),
    ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(MAX_PAPERS_PER_JOB),
  ]);

  const resultsByPaper = new Map<string, Doc<"extractionResults">[]>();
  const reviewsByResult = new Map<string, Doc<"extractionResultReviews">>();

  await Promise.all(papers.map(async (paper) => {
    const [results, reviews] = await Promise.all([
      // Cardinality: ~5-20 results per paper
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect(),
      // Cardinality: ~5-20 reviews per paper
      ctx.db
        .query("extractionResultReviews")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect(),
    ]);
    resultsByPaper.set(paper._id, results);
    for (const review of reviews) {
      reviewsByResult.set(review.resultId, review);
    }
  }));

  return { questions, papers, resultsByPaper, reviewsByResult };
}

function toInsightEntry(
  paper: Doc<"extractionPapers">,
  questionKey: string,
  result: Doc<"extractionResults"> | undefined,
  review?: Doc<"extractionResultReviews">
): InsightEntry {
  return {
    paperId: paper._id,
    title: paper.title,
    openalexId: paper.openalexId,
    questionKey,
    answer: review?.correctedAnswer ?? result?.answer ?? null,
    confidence: result?.confidence,
    citationStatus: result?.citationStatus,
    pdfContentUsed: Boolean(result?.pdfContentUsed),
    reviewState: review?.state || "unreviewed",
  };
}


// Start a new extraction job (public API)
export const startExtraction = mutation({
  args: {
    name: v.string(),
    sourceType: v.union(
      v.literal("history"),
      v.literal("zotero"),
      v.literal("manual"),
      v.literal("mixed")
    ),
    sourceHistoryId: v.optional(v.string()),
    searchFilters: v.optional(searchFiltersValidator),
    sourceHistoryEntries: v.optional(
      v.array(
        v.object({
          historyId: v.string(),
          searchFilters: searchFiltersValidator,
        })
      )
    ),
    sourceZoteroSelection: v.optional(
      v.object({
        libraryType: v.union(v.literal("user"), v.literal("group")),
        groupId: v.optional(v.string()),
        zoteroUserId: v.optional(v.string()),
        collectionKey: v.optional(v.string()),
        includeDescendants: v.optional(v.boolean()),
        items: v.array(
          v.object({
            itemKey: v.string(),
            title: v.string(),
            abstract: v.optional(v.string()),
            authors: v.array(v.string()),
            year: v.optional(v.number()),
            doi: v.optional(v.string()),
          })
        ),
      })
    ),
    sourceManualItems: v.optional(
      v.array(
        v.object({
          id: v.string(),
          title: v.string(),
          abstract: v.optional(v.string()),
          authors: v.optional(v.array(v.string())),
          year: v.optional(v.number()),
          doi: v.optional(v.string()),
          pdfUrl: v.optional(v.string()),
          storageId: v.optional(v.id("_storage")),
        })
      )
    ),
    questions: v.array(
      v.object({
        key: v.string(),
        question: v.string(),
        type: v.union(
          v.literal("string"),
          v.literal("boolean"),
          v.literal("number"),
          v.literal("array")
        ),
        description: v.optional(v.string()),
      })
    ),
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

    assertExtractionInputLimits(args);

    const userId = user._id;

    // Create job record
    const jobId: Id<"extractionJobs"> = await ctx.db.insert("extractionJobs", {
      userId,
      name: args.name,
      sourceType: args.sourceType,
      sourceHistoryId: args.sourceHistoryId,
      sourceHistoryEntries: args.sourceHistoryEntries,
      sourceZoteroSelection: args.sourceZoteroSelection,
      sourceManualItems: args.sourceManualItems,
      searchFilters: args.searchFilters,
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Create question records
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

    // Start the extraction workflow
    // Workflow handles: fetch papers -> create records -> enqueue via workpool -> process
    const workflowId = await workflow.start(
      ctx,
      internal.extraction.workflow.runExtractionWorkflow,
      { jobId }
    );

    // Update job with workflow ID
    await ctx.db.patch("extractionJobs", jobId, { 
      workflowId,
      updatedAt: Date.now(),
    });

    return { jobId };
  },
});

// Cancel a running job (public API)
export const cancelExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const user = await requireAuth(ctx);

    const job = await ctx.db.get("extractionJobs", args.jobId);

    if (!job || job.userId !== user._id) {
      throw createError("NOT_FOUND", "Job not found");
    }

    // Only allow cancelling pending or active jobs
    if (["completed", "failed", "cancelled"].includes(job.status)) {
       // Already done, just return success
       return { success: true };
    }

    await ctx.db.patch("extractionJobs", args.jobId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });

    // Cancel the workflow to prevent new steps from starting
    if (job.workflowId) {
      try {
        await workflow.cancel(ctx, job.workflowId as WorkflowId);
      } catch (e) {
        // Workflow may have already completed -- safe to ignore
        console.warn(`[cancelExtraction] Failed to cancel workflow: ${e}`);
      }
    }

    // Cancel only this job's in-flight workpool items. The pdfProcessingPool
    // is shared across all users and jobs, so cancelAll() would abort every
    // tenant's work — cross-tenant denial of service. Instead, we stored the
    // WorkId of each paper's currently-active pool item and cancel exactly
    // those. Cancels are idempotent per workpool contract.
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_PAPERS_PER_JOB);

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

    // Cardinality: ~5-20 questions per extraction job
    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

    // Create new job record (similar to startExtraction)
    const newJobId = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      name: `${oldJob.name} (Copy)`,
      sourceType: oldJob.sourceType,
      sourceHistoryId: oldJob.sourceHistoryId,
      sourceZoteroCollection: oldJob.sourceZoteroCollection,
      sourceHistoryEntries: oldJob.sourceHistoryEntries,
      sourceZoteroSelection: oldJob.sourceZoteroSelection,
      sourceManualItems: oldJob.sourceManualItems,
      searchFilters: oldJob.searchFilters,
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Copy questions
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

    // Start workflow
    const workflowId = await workflow.start(
      ctx,
      internal.extraction.workflow.runExtractionWorkflow,
      { jobId: newJobId }
    );

    await ctx.db.patch("extractionJobs", newJobId, { 
      workflowId,
      updatedAt: Date.now(),
    });

    return { jobId: newJobId };
  },
});

export const setResultReviewState = mutation({
  args: {
    resultId: v.id("extractionResults"),
    state: v.union(
      v.literal("unreviewed"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("needs_followup")
    ),
    note: v.optional(v.string()),
    correctedAnswer: v.optional(
      v.union(v.string(), v.boolean(), v.number(), v.array(v.string()), v.null())
    ),
  },
  returns: v.union(
    v.object({
      cleared: v.boolean(),
      state: v.literal("unreviewed"),
    }),
    v.object({
      reviewId: v.id("extractionResultReviews"),
      state: v.union(
        v.literal("unreviewed"),
        v.literal("accepted"),
        v.literal("rejected"),
        v.literal("needs_followup")
      ),
    })
  ),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const result = await ctx.db.get("extractionResults", args.resultId);
    if (!result) throw createError("NOT_FOUND", "Result not found");

    const paper = await ctx.db.get("extractionPapers", result.paperId);
    if (!paper) throw createError("NOT_FOUND", "Paper not found");

    const job = await assertJobOwnership(ctx, user._id, paper.jobId);
    const existing = await ctx.db
      .query("extractionResultReviews")
      .withIndex("by_result", (q) => q.eq("resultId", args.resultId))
      .first();

    const note = args.note?.trim() || undefined;
    const hasCorrection = args.correctedAnswer !== undefined;

    if (args.state === "unreviewed" && !note && !hasCorrection) {
      if (existing) {
        await ctx.db.delete("extractionResultReviews", existing._id);
      }
      return {
        cleared: true,
        state: "unreviewed" as const,
      };
    }

    const patchData = {
      state: args.state,
      note,
      correctedAnswer: args.correctedAnswer,
      reviewedBy: user._id,
      reviewedAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch("extractionResultReviews", existing._id, patchData);
      return {
        reviewId: existing._id,
        state: args.state,
      };
    }

    const reviewId = await ctx.db.insert("extractionResultReviews", {
      jobId: job._id,
      paperId: paper._id,
      resultId: result._id,
      questionKey: result.questionKey,
      ...patchData,
      createdAt: Date.now(),
    });

    return {
      reviewId,
      state: args.state,
    };
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
    const template = await ctx.db.get("extractionWorkflowTemplates", args.templateId);
    if (!template || template.userId !== user._id) {
      throw createError("NOT_FOUND", "Template not found");
    }

    const jobId: Id<"extractionJobs"> = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      name: args.name?.trim() || `${template.name} (Rerun)`,
      sourceType: template.sourceType,
      sourceHistoryEntries: template.sourceHistoryEntries,
      sourceZoteroSelection: template.sourceZoteroSelection,
      sourceManualItems: template.sourceManualItems,
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
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
      { jobId }
    );
    await ctx.db.patch("extractionJobs", jobId, {
      workflowId,
      updatedAt: Date.now(),
    });

    return { jobId };
  },
});

export const saveExtractionSavedView = mutation({
  args: {
    jobId: v.id("extractionJobs"),
    name: v.string(),
    filters: v.object({
      searchQuery: v.string(),
      confidenceRange: v.array(v.number()),
      statusFilters: v.array(v.string()),
    }),
    sortBy: v.optional(v.string()),
    viewMode: v.optional(v.string()),
    selectedQuestionKeys: v.optional(v.array(v.string())),
  },
  returns: v.object({ viewId: v.id("extractionSavedViews") }),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    await assertJobOwnership(ctx, user._id, args.jobId);

    const existing = await ctx.db
      .query("extractionSavedViews")
      .withIndex("by_job_name", (q) =>
        q.eq("jobId", args.jobId).eq("name", args.name.trim())
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch("extractionSavedViews", existing._id, {
        filters: args.filters,
        sortBy: args.sortBy,
        viewMode: args.viewMode,
        selectedQuestionKeys: args.selectedQuestionKeys,
        updatedAt: now,
      });
      return { viewId: existing._id };
    }

    const viewId = await ctx.db.insert("extractionSavedViews", {
      jobId: args.jobId,
      userId: user._id,
      name: args.name.trim(),
      filters: args.filters,
      sortBy: args.sortBy,
      viewMode: args.viewMode,
      selectedQuestionKeys: args.selectedQuestionKeys,
      createdAt: now,
      updatedAt: now,
    });
    return { viewId };
  },
});

export const deleteExtractionSavedView = mutation({
  args: { viewId: v.id("extractionSavedViews") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const view = await ctx.db.get("extractionSavedViews", args.viewId);
    if (!view) throw createError("NOT_FOUND", "Saved view not found");

    await assertJobOwnership(ctx, user._id, view.jobId);

    await ctx.db.delete("extractionSavedViews", args.viewId);
    return null;
  },
});

export const saveWorkflowTemplateFromJob = mutation({
  args: {
    jobId: v.id("extractionJobs"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.object({ templateId: v.id("extractionWorkflowTemplates") }),
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await requireFeature(ctx, "extraction.templates", user._id);
    const job = await assertJobOwnership(ctx, user._id, args.jobId);

    // Cardinality: ~5-20 questions per extraction job
    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

    const existing = await ctx.db
      .query("extractionWorkflowTemplates")
      .withIndex("by_user_name", (q) =>
        q.eq("userId", user._id).eq("name", args.name.trim())
      )
      .first();

    const now = Date.now();
    const templateFields = {
      description: args.description,
      sourceType: job.sourceType,
      sourceHistoryEntries: job.sourceHistoryEntries,
      sourceZoteroSelection: job.sourceZoteroSelection,
      sourceManualItems: job.sourceManualItems,
      questions: questions.map((q) => ({
        key: q.key,
        question: q.question,
        type: q.type,
        description: q.description,
      })),
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch("extractionWorkflowTemplates", existing._id, templateFields);
      return { templateId: existing._id };
    }

    const templateId = await ctx.db.insert("extractionWorkflowTemplates", {
      userId: user._id,
      name: args.name.trim(),
      ...templateFields,
      createdAt: now,
    });
    return { templateId };
  },
});

export const saveWorkflowTemplate = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    sourceType: v.union(
      v.literal("history"),
      v.literal("zotero"),
      v.literal("manual"),
      v.literal("mixed")
    ),
    sourceHistoryEntries: v.optional(
      v.array(
        v.object({
          historyId: v.string(),
          searchFilters: searchFiltersValidator,
        })
      )
    ),
    sourceZoteroSelection: v.optional(
      v.object({
        libraryType: v.union(v.literal("user"), v.literal("group")),
        groupId: v.optional(v.string()),
        zoteroUserId: v.optional(v.string()),
        collectionKey: v.optional(v.string()),
        includeDescendants: v.optional(v.boolean()),
        items: v.array(
          v.object({
            itemKey: v.string(),
            title: v.string(),
            abstract: v.optional(v.string()),
            authors: v.array(v.string()),
            year: v.optional(v.number()),
            doi: v.optional(v.string()),
          })
        ),
      })
    ),
    sourceManualItems: v.optional(
      v.array(
        v.object({
          id: v.string(),
          title: v.string(),
          abstract: v.optional(v.string()),
          authors: v.optional(v.array(v.string())),
          year: v.optional(v.number()),
          doi: v.optional(v.string()),
          pdfUrl: v.optional(v.string()),
          storageId: v.optional(v.id("_storage")),
        })
      )
    ),
    questions: v.array(
      v.object({
        key: v.string(),
        question: v.string(),
        type: v.union(
          v.literal("string"),
          v.literal("boolean"),
          v.literal("number"),
          v.literal("array")
        ),
        description: v.optional(v.string()),
      })
    ),
  },
  returns: v.object({ templateId: v.id("extractionWorkflowTemplates") }),
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await requireFeature(ctx, "extraction.templates", user._id);

    assertExtractionInputLimits(args);

    const existing = await ctx.db
      .query("extractionWorkflowTemplates")
      .withIndex("by_user_name", (q) =>
        q.eq("userId", user._id).eq("name", args.name.trim())
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch("extractionWorkflowTemplates", existing._id, {
        description: args.description,
        sourceType: args.sourceType,
        sourceHistoryEntries: args.sourceHistoryEntries,
        sourceZoteroSelection: args.sourceZoteroSelection,
        sourceManualItems: args.sourceManualItems,
        questions: args.questions,
        updatedAt: now,
      });
      return { templateId: existing._id };
    }

    const templateId = await ctx.db.insert("extractionWorkflowTemplates", {
      userId: user._id,
      name: args.name.trim(),
      description: args.description,
      sourceType: args.sourceType,
      sourceHistoryEntries: args.sourceHistoryEntries,
      sourceZoteroSelection: args.sourceZoteroSelection,
      sourceManualItems: args.sourceManualItems,
      questions: args.questions,
      createdAt: now,
      updatedAt: now,
    });
    return { templateId };
  },
});

export const deleteWorkflowTemplate = mutation({
  args: { templateId: v.id("extractionWorkflowTemplates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const template = await ctx.db.get("extractionWorkflowTemplates", args.templateId);
    if (!template || template.userId !== user._id) {
      throw createError("NOT_FOUND", "Template not found");
    }

    await ctx.db.delete("extractionWorkflowTemplates", args.templateId);
    return null;
  },
});

export const createExtractionReportSnapshot = mutation({
  args: {
    jobId: v.id("extractionJobs"),
    name: v.optional(v.string()),
    scope: v.optional(
      v.object({
        filteredPaperIds: v.optional(v.array(v.id("extractionPapers"))),
        selectedQuestionKeys: v.optional(v.array(v.string())),
        viewName: v.optional(v.string()),
      })
    ),
  },
  returns: v.object({ reportId: v.id("extractionReportSnapshots") }),
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await requireFeature(ctx, "extraction.reportBuilder", user._id);
    const job = await assertJobOwnership(ctx, user._id, args.jobId);
    const { questions, papers, resultsByPaper, reviewsByResult } =
      await loadJobDataForReporting(ctx, args.jobId);

    // Cardinality: ~1 stat record per question per job
    const jobStats = await ctx.db
      .query("extractionJobStats")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    const hasStats = jobStats.length > 0;

    const filteredPaperIds = new Set(
      args.scope?.filteredPaperIds || papers.map((p: Doc<"extractionPapers">) => p._id)
    );
    const selectedQuestions = new Set(
      args.scope?.selectedQuestionKeys ||
        questions.map((question: Doc<"extractionQuestions">) => question.key)
    );
    const scopedPapers = papers.filter((paper: Doc<"extractionPapers">) =>
      filteredPaperIds.has(paper._id)
    );
    const scopedQuestions = questions.filter((question: Doc<"extractionQuestions">) =>
      selectedQuestions.has(question.key)
    );

    const insightByQuestion = scopedQuestions.map((question: Doc<"extractionQuestions">) => {
      const entries: InsightEntry[] = scopedPapers.map((paper: Doc<"extractionPapers">) => {
        const result = (resultsByPaper.get(paper._id) || []).find(
          (row: Doc<"extractionResults">) => row.questionKey === question.key
        );
        const review = result ? reviewsByResult.get(result._id) : undefined;
        return toInsightEntry(paper, question.key, result, review);
      });

      return {
        question,
        aggregate: aggregateQuestionInsights(entries, question.type),
        disagreements: buildDisagreementClusters(entries, question.type),
        entries,
      };
    });

    type InsightRow = {
      question: Doc<"extractionQuestions">;
      aggregate: QuestionInsightAggregate;
      disagreements: DisagreementCluster[];
      entries: InsightEntry[];
    };

    const keyFindingsLines = insightByQuestion.map((row: InsightRow) => {
      const top = row.aggregate.topAnswers[0];
      const topText = top ? `"${top.display}" (${top.count})` : "No dominant answer";
      return `- ${row.question.question}: ${topText}`;
    });

    const disagreementLines = insightByQuestion
      .filter((row: InsightRow) => row.disagreements.length > 1)
      .map((row: InsightRow) => {
        const topCluster = row.disagreements
          .slice(0, 2)
          .map((cluster) => `${cluster.displayAnswer} (${cluster.count})`)
          .join(" vs ");
        return `- ${row.question.question}: ${topCluster}`;
      });

    const evidenceHighlights = insightByQuestion
      .flatMap((row: InsightRow) => {
        const groundedEntries = row.entries
          .filter(
            (entry: InsightEntry) =>
              entry.citationStatus === "grounded" && entry.answer !== null
          )
          .slice(0, 2);
        return groundedEntries.map(
          (entry: InsightEntry) =>
            `- ${row.question.question}: ${formatAnswerForDisplay(
              entry.answer,
              row.question.type
            )} (${entry.title})`
        );
      })
      .slice(0, 12);

    // Metrics: use pre-aggregated stats when available and unscoped, else fan-out
    let metricsAnsweredRate: number;
    let metricsGroundedRate: number;
    let metricsBestEffortRate: number;

    // Stats are only valid for whole-job aggregation (no paper-level or question-level filtering)
    const isUnscoped = !args.scope?.filteredPaperIds && !args.scope?.selectedQuestionKeys;
    if (hasStats && jobStats.length === scopedQuestions.length && isUnscoped) {
      // Fast path: metrics from pre-aggregated stats
      const totalFromStats = jobStats.reduce((sum, s) => sum + s.totalPapers, 0);
      const answeredFromStats = jobStats.reduce((sum, s) => sum + s.totalAnswered, 0);
      const groundedFromStats = jobStats.reduce((sum, s) => sum + s.groundedCount, 0);
      const bestEffortFromStats = jobStats.reduce((sum, s) => sum + s.bestEffortCount, 0);
      metricsAnsweredRate = totalFromStats > 0 ? answeredFromStats / totalFromStats : 0;
      metricsGroundedRate = totalFromStats > 0 ? groundedFromStats / totalFromStats : 0;
      metricsBestEffortRate = totalFromStats > 0 ? bestEffortFromStats / totalFromStats : 0;
    } else {
      // Fallback: compute from fan-out (existing behavior)
      const totalExpected = scopedPapers.length * Math.max(scopedQuestions.length, 1);
      const answeredTotal = insightByQuestion.reduce(
        (sum: number, row: InsightRow) => sum + row.aggregate.answered,
        0
      );
      const groundedTotal = insightByQuestion.reduce(
        (sum: number, row: InsightRow) => sum + row.aggregate.grounded,
        0
      );
      const bestEffortTotal = insightByQuestion.reduce(
        (sum: number, row: InsightRow) => sum + row.aggregate.citationStatusMix.best_effort,
        0
      );
      metricsAnsweredRate = totalExpected > 0 ? answeredTotal / totalExpected : 0;
      metricsGroundedRate = totalExpected > 0 ? groundedTotal / totalExpected : 0;
      metricsBestEffortRate = totalExpected > 0 ? bestEffortTotal / totalExpected : 0;
    }

    // Methods section uses the same rates for display
    const methodsAnsweredPct = Math.round(metricsAnsweredRate * 100);
    const methodsGroundedPct = Math.round(metricsGroundedRate * 100);
    const methodsBestEffortPct = Math.round(metricsBestEffortRate * 100);

    const reportId = await ctx.db.insert("extractionReportSnapshots", {
      jobId: job._id,
      userId: user._id,
      name:
        args.name?.trim() ||
        `${job.name} report ${new Date().toISOString().slice(0, 10)}`,
      scope: {
        filteredPaperIds: args.scope?.filteredPaperIds,
        selectedQuestionKeys: args.scope?.selectedQuestionKeys,
        viewName: args.scope?.viewName,
      },
      sections: [
        {
          id: "key-findings",
          title: "Key Findings",
          body: keyFindingsLines.length > 0 ? keyFindingsLines.join("\n") : "- No findings yet.",
        },
        {
          id: "conflicts-uncertainties",
          title: "Conflicts and Uncertainties",
          body:
            disagreementLines.length > 0
              ? disagreementLines.join("\n")
              : "- No major disagreements detected.",
        },
        {
          id: "evidence-highlights",
          title: "Evidence Highlights",
          body:
            evidenceHighlights.length > 0
              ? evidenceHighlights.join("\n")
              : "- No grounded evidence highlights available.",
        },
        {
          id: "methods-limitations",
          title: "Methods and Limitations",
          body: [
            `- Scope: ${scopedPapers.length} papers, ${scopedQuestions.length} questions.`,
            `- Answered rate: ${methodsAnsweredPct}%.`,
            `- Grounded rate: ${methodsGroundedPct}%.`,
            `- Best-effort rate: ${methodsBestEffortPct}%.`,
          ].join("\n"),
        },
      ],
      metrics: {
        totalPapers: scopedPapers.length,
        answeredRate: metricsAnsweredRate,
        groundedRate: metricsGroundedRate,
        bestEffortRate: metricsBestEffortRate,
      },
      generatedAt: Date.now(),
      createdAt: Date.now(),
    });

    // Schedule lazy backfill for legacy completed jobs without stats
    if (!hasStats && job.status === "completed") {
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.backfillJobStats, {
        jobId: args.jobId,
      });
    }

    return { reportId };
  },
});

export const createExtractionRunDiff = mutation({
  args: {
    jobId: v.id("extractionJobs"),
    baselineJobId: v.id("extractionJobs"),
  },
  returns: v.object({
    diffId: v.id("extractionRunDiffs"),
    summary: v.object({
      newAnswers: v.number(),
      changedAnswers: v.number(),
      removedAnswers: v.number(),
      confidenceShifts: v.number(),
      newlyInsufficientEvidence: v.number(),
      totalCompared: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await assertJobOwnership(ctx, user._id, args.jobId);
    await assertJobOwnership(ctx, user._id, args.baselineJobId);

    const currentData = await loadJobDataForReporting(ctx, args.jobId);
    const baselineData = await loadJobDataForReporting(ctx, args.baselineJobId);

    const toDiffRecords = (
      papers: Doc<"extractionPapers">[],
      resultsByPaper: Map<string, Doc<"extractionResults">[]>
    ): RunDiffRecord[] => {
      const rows: RunDiffRecord[] = [];
      for (const paper of papers.filter((row) => row.processable !== false)) {
        const results = resultsByPaper.get(paper._id) || [];
        for (const result of results) {
          rows.push({
            key: `${paper.openalexId}::${result.questionKey}`,
            openalexId: paper.openalexId,
            title: paper.title,
            questionKey: result.questionKey,
            answer: result.answer,
            confidence: result.confidence,
            citationStatus: result.citationStatus,
          });
        }
      }
      return rows;
    };

    const { summary, changes } = buildRunDiff(
      toDiffRecords(baselineData.papers, baselineData.resultsByPaper),
      toDiffRecords(currentData.papers, currentData.resultsByPaper)
    );

    const DIFF_CHANGES_CAP = 1000;
    const isTruncated = changes.length > DIFF_CHANGES_CAP;

    const diffId = await ctx.db.insert("extractionRunDiffs", {
      jobId: args.jobId,
      baselineJobId: args.baselineJobId,
      userId: user._id,
      summary,
      changes: changes.slice(0, DIFF_CHANGES_CAP),
      ...(isTruncated ? { isTruncated: true, totalChanges: changes.length } : {}),
      generatedAt: Date.now(),
      createdAt: Date.now(),
    });

    return { diffId, summary };
  },
});

export const deleteExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const job = await ctx.db.get("extractionJobs", args.jobId);
    if (!job || job.userId !== user._id) throw createError("NOT_FOUND", "Job not found");

    // Schedule the cascade delete as an independent mutation to avoid transaction limits
    await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, {
      jobId: args.jobId,
    });

    return null;
  },
});

export const deleteExtractionInternal = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const BATCH_SIZE = 100;

    // Step 1: Delete extractionEvidenceUnits (children of extractionPapers)
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_PAPERS_PER_JOB);
    for (const paper of papers) {
      const units = await ctx.db
        .query("extractionEvidenceUnits")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .take(BATCH_SIZE);
      if (units.length > 0) {
        for (const u of units) await ctx.db.delete("extractionEvidenceUnits", u._id);
        await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
        return null;
      }
    }

    // Step 2: Delete extractionResultReviews (children of extractionPapers)
    for (const paper of papers) {
      const reviews = await ctx.db
        .query("extractionResultReviews")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .take(BATCH_SIZE);
      if (reviews.length > 0) {
        for (const r of reviews) await ctx.db.delete("extractionResultReviews", r._id);
        await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
        return null;
      }
    }

    // Step 3: Delete extractionResults (children of extractionPapers)
    for (const paper of papers) {
      const results = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .take(BATCH_SIZE);
      if (results.length > 0) {
        for (const r of results) await ctx.db.delete("extractionResults", r._id);
        await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
        return null;
      }
    }

    // Step 4: Delete extractionPapers with inline storage cleanup
    const remainingPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(BATCH_SIZE);
    if (remainingPapers.length > 0) {
      for (const paper of remainingPapers) {
        if (paper.storageId) {
          try {
            await ctx.storage.delete(paper.storageId);
          } catch (e) {
            console.error(`Failed to delete PDF storage for paper ${paper._id}:`, e);
          }
        }
        await ctx.db.delete("extractionPapers", paper._id);
      }
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
      return null;
    }

    // Step 5: Delete extractionQuestions
    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(BATCH_SIZE);
    if (questions.length > 0) {
      for (const q of questions) await ctx.db.delete("extractionQuestions", q._id);
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
      return null;
    }

    // Step 6: Delete extractionSavedViews
    const savedViews = await ctx.db
      .query("extractionSavedViews")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(BATCH_SIZE);
    if (savedViews.length > 0) {
      for (const sv of savedViews) await ctx.db.delete("extractionSavedViews", sv._id);
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
      return null;
    }

    // Step 7: Delete extractionReportSnapshots
    const snapshots = await ctx.db
      .query("extractionReportSnapshots")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(BATCH_SIZE);
    if (snapshots.length > 0) {
      for (const s of snapshots) await ctx.db.delete("extractionReportSnapshots", s._id);
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
      return null;
    }

    // Step 7b: Delete extractionJobStats
    const jobStats = await ctx.db
      .query("extractionJobStats")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(BATCH_SIZE);
    if (jobStats.length > 0) {
      for (const s of jobStats) await ctx.db.delete("extractionJobStats", s._id);
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
      return null;
    }

    // Step 8: Delete extractionRunDiffs where this job is the PRIMARY job
    // NOTE: Step 8b below handles diffs where baselineJobId == args.jobId
    const runDiffs = await ctx.db
      .query("extractionRunDiffs")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(BATCH_SIZE);
    if (runDiffs.length > 0) {
      for (const d of runDiffs) await ctx.db.delete("extractionRunDiffs", d._id);
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
      return null;
    }

    // Step 8b: Delete extractionRunDiffs where this job is the BASELINE job
    // (BUG-03 fix: prevents orphaned diffs when a baseline job is deleted)
    const baselineDiffs = await ctx.db
      .query("extractionRunDiffs")
      .withIndex("by_baseline", (q) => q.eq("baselineJobId", args.jobId))
      .take(BATCH_SIZE);
    if (baselineDiffs.length > 0) {
      for (const d of baselineDiffs) await ctx.db.delete("extractionRunDiffs", d._id);
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
      return null;
    }

    // Step 9: Delete the job itself
    const job = await ctx.db.get("extractionJobs", args.jobId);
    if (job) await ctx.db.delete("extractionJobs", args.jobId);

    return null;
  },
});

export const cleanupFailedPaperStorage = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ cleaned: v.number() }),
  handler: async (ctx, args): Promise<{ cleaned: number }> => {
    const papersWithStorage = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .filter((q) => q.neq(q.field("storageId"), undefined))
      .take(MAX_PAPERS_PER_JOB);

    let cleaned = 0;
    for (const paper of papersWithStorage) {
      if (!paper.storageId) continue;
      try {
        await ctx.storage.delete(paper.storageId);
        await ctx.db.patch("extractionPapers", paper._id, { storageId: undefined });
        cleaned++;
      } catch (e) {
        console.error(`Failed to delete storage for paper ${paper._id}:`, e);
      }
    }

    return { cleaned };
  },
});

/**
 * Backfill pre-aggregated stats for a legacy completed job.
 * Idempotent: skips if stats already exist.
 * Scheduled from createExtractionReportSnapshot when stats are missing.
 */
export const backfillJobStats = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // Idempotent: skip if stats already exist
    const existingStats = await ctx.db
      .query("extractionJobStats")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .first();
    if (existingStats) return null;

    // Cardinality: ~5-20 questions per extraction job
    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_PAPERS_PER_JOB);

    for (const question of questions) {
      let totalPapers = 0;
      let totalAnswered = 0;
      let groundedCount = 0;
      let bestEffortCount = 0;
      let insufficientEvidenceCount = 0;
      let extractionErrorCount = 0;
      let confidenceSum = 0;
      let confidenceCount = 0;
      let highConfidenceCount = 0;
      let mediumConfidenceCount = 0;
      let lowConfidenceCount = 0;
      let unknownConfidenceCount = 0;

      for (const paper of papers) {
        if (paper.processable === false) continue;
        // Cardinality: ~5-20 results per paper
        const results = await ctx.db
          .query("extractionResults")
          .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
          .collect();
        const result = results.find((r) => r.questionKey === question.key);
        if (!result) {
          totalPapers += 1;
          unknownConfidenceCount += 1;
          continue;
        }

        totalPapers += 1;
        const isAnswered = result.answer !== null && result.answer !== undefined;
        totalAnswered += isAnswered ? 1 : 0;
        groundedCount += result.citationStatus === "grounded" ? 1 : 0;
        bestEffortCount += result.citationStatus === "best_effort" ? 1 : 0;
        insufficientEvidenceCount += result.citationStatus === "insufficient_evidence" ? 1 : 0;
        extractionErrorCount += result.citationStatus === "extraction_error" ? 1 : 0;

        const conf = typeof result.confidence === "number" ? result.confidence : undefined;
        if (conf !== undefined) {
          confidenceSum += conf;
          confidenceCount += 1;
          if (conf >= 0.8) highConfidenceCount += 1;
          else if (conf >= 0.5) mediumConfidenceCount += 1;
          else lowConfidenceCount += 1;
        } else {
          unknownConfidenceCount += 1;
        }
      }

      await ctx.db.insert("extractionJobStats", {
        jobId: args.jobId,
        questionKey: question.key,
        totalPapers,
        totalAnswered,
        groundedCount,
        bestEffortCount,
        insufficientEvidenceCount,
        extractionErrorCount,
        confidenceSum,
        confidenceCount,
        highConfidenceCount,
        mediumConfidenceCount,
        lowConfidenceCount,
        unknownConfidenceCount,
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

// Internal mutations (called by workflow/actions)

export const createPaperRecords = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    papers: v.array(
      v.object({
        openalexId: v.string(),
        title: v.string(),
        doi: v.optional(v.string()),
        publicationYear: v.optional(v.number()),
        abstract: v.optional(v.string()),
        authors: v.optional(v.array(v.string())),
        pdfUrl: v.optional(v.string()),
        storageId: v.optional(v.id("_storage")),
        isOpenAccess: v.optional(v.boolean()),
        sourceType: v.optional(
          v.union(v.literal("history"), v.literal("zotero"), v.literal("manual"))
        ),
        sourceId: v.optional(v.string()),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    const pdfEnabled = pdfFlag?.enabled ?? true;
    for (const paper of args.papers) {
      const sanitizedPdfUrl = pdfEnabled ? paper.pdfUrl : undefined;
      const sanitizedStorageId = pdfEnabled ? paper.storageId : undefined;
      const { processable } = getProcessableFlags({
        pdfUrl: sanitizedPdfUrl,
        storageId: sanitizedStorageId,
        abstract: paper.abstract,
        pdfEnabled,
      });

      if (!pdfEnabled && !processable) {
        continue;
      }

      await ctx.db.insert("extractionPapers", {
        jobId: args.jobId,
        openalexId: paper.openalexId,
        title: paper.title,
        doi: paper.doi,
        publicationYear: paper.publicationYear,
        abstract: paper.abstract,
        authors: paper.authors,
        pdfUrl: sanitizedPdfUrl,
        storageId: sanitizedStorageId,
        isOpenAccess: paper.isOpenAccess,
        sourceType: paper.sourceType,
        sourceId: paper.sourceId,
        processable,
        status: "pending",
      });
    }
    return null;
  },
});

export const updateJobStatus = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    status: v.union(
      v.literal("pending"),
      v.literal("downloading_pdfs"),
      v.literal("indexing"),
      v.literal("extracting"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    totalPapers: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.totalPapers !== undefined) {
      updates.totalPapers = args.totalPapers;
    }

    await ctx.db.patch("extractionJobs", args.jobId, updates);
    return null;
  },
});

export const updatePaperStatus = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    status: v.union(
      v.literal("pending"),
      v.literal("downloading"),
      v.literal("download_failed"),
      v.literal("indexing"),
      v.literal("indexing_failed"),
      v.literal("extracting"),
      v.literal("completed"),
      v.literal("failed")
    ),
    errorMessage: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    creditsUsed: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const updates: Record<string, unknown> = {
      status: args.status,
    };

    if (args.errorMessage !== undefined) {
      updates.errorMessage = args.errorMessage;
    }

    if (args.completedAt !== undefined) {
      updates.completedAt = args.completedAt;
    }

    if (args.creditsUsed !== undefined) {
      updates.creditsUsed = args.creditsUsed;
    }

    await ctx.db.patch("extractionPapers", args.paperId, updates);
    return null;
  },
});

export const updatePaperProcessable = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    processable: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch("extractionPapers", args.paperId, {
      processable: args.processable,
    });
    return null;
  },
});

export const setPaperStorage = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const paper = await ctx.db.get("extractionPapers", args.paperId);
    if (!paper) {
      return null;
    }
    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    const pdfEnabled = pdfFlag?.enabled ?? true;
    const { processable } = getProcessableFlags({
      pdfUrl: paper.pdfUrl,
      storageId: args.storageId,
      abstract: paper.abstract,
      pdfEnabled,
    });
    await ctx.db.patch("extractionPapers", args.paperId, {
      storageId: args.storageId,
      processable,
    });
    return null;
  },
});

export const markPaperIndexed = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    ragEntryId: v.optional(v.string()),
    // When provided, the embedding credits are deducted atomically with the
    // isIndexed flip. Gated on `indexingBilled` so a workpool retry that
    // replays the entire indexing action cannot re-charge the user.
    billing: v.optional(
      v.object({
        userId: v.id("users"),
        jobId: v.id("extractionJobs"),
        creditsToDeduct: v.number(),
        embeddingTokens: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const paper = await ctx.db.get("extractionPapers", args.paperId);
    if (!paper) return null;

    const updates: Partial<Doc<"extractionPapers">> = {
      isIndexed: true,
      indexedAt: Date.now(),
    };

    if (args.ragEntryId) {
      updates.ragEntryId = args.ragEntryId;
    }

    if (
      args.billing &&
      !paper.indexingBilled &&
      args.billing.creditsToDeduct > 0
    ) {
      await ctx.runMutation(internal.credits.internal.deductCredits, {
        userId: args.billing.userId,
        amount: args.billing.creditsToDeduct,
        description: "AI: Extraction embedding index",
        metadata: {
          billingType: "extraction_embedding",
          paperId: String(args.paperId),
          jobId: String(args.billing.jobId),
          embeddingTokens: String(args.billing.embeddingTokens),
        },
      });
      updates.indexingBilled = true;
    }

    await ctx.db.patch("extractionPapers", args.paperId, updates);
    return null;
  },
});

export const finalizeJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get("extractionJobs", args.jobId);
    if (!job) return null;

    // Terminal states are sticky: cancelled/failed/completed jobs must not be
    // resurrected by late-arriving workpool completions.
    if (
      job.status === "cancelled" ||
      job.status === "failed" ||
      job.status === "completed"
    ) {
      return null;
    }

    // Count final stats
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_PAPERS_PER_JOB);

    const completedCount = papers.filter((p) => p.status === "completed").length;
    const failedCount = papers.filter(
      (p) =>
        p.status === "failed" ||
        p.status === "download_failed" ||
        p.status === "indexing_failed"
    ).length;

    const status =
      failedCount === papers.length
        ? "failed"
        : completedCount + failedCount >= papers.length
        ? "completed"
        : job.status;

    await ctx.db.patch("extractionJobs", args.jobId, {
      status,
      processedPapers: completedCount,
      failedPapers: failedCount,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Delete old PDF files (called by cron)
export const cleanupOldPdfs = internalMutation({
  args: {
    maxAgeHours: v.number(),
  },
  returns: v.object({ cleaned: v.number() }),
  handler: async (ctx, args): Promise<{ cleaned: number }> => {
    const cutoffTime = Date.now() - args.maxAgeHours * 60 * 60 * 1000;
    const CLEANUP_BATCH = 500;

    const oldPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_status_completedAt", (q) =>
        q.eq("status", "completed").lt("completedAt", cutoffTime)
      )
      .take(CLEANUP_BATCH);

    for (const paper of oldPapers) {
      if (paper.storageId) {
        try {
          await ctx.storage.delete(paper.storageId);
          await ctx.db.patch("extractionPapers", paper._id, {
            storageId: undefined,
          });
        } catch (error) {
          console.error(`Failed to delete PDF for paper ${paper._id}:`, error);
        }
      }
    }

    // If we fetched a full batch, there might be more to process
    if (oldPapers.length >= CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.extraction.mutations.cleanupOldPdfs, {
        maxAgeHours: args.maxAgeHours,
      });
    }

    return { cleaned: oldPapers.length };
  },
});

// Process papers for active extraction jobs (called by cron every minute)
export const finalizeJobIfDone = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get("extractionJobs", args.jobId);
    if (!job) return null;

    // Terminal states are sticky: cancelled/failed/completed jobs must not be
    // resurrected by late-arriving workpool completions.
    if (
      job.status === "cancelled" ||
      job.status === "failed" ||
      job.status === "completed"
    ) {
      return null;
    }

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_PAPERS_PER_JOB);

    if (papers.length === 0) return null;

    const processablePapers = papers.filter((p) => p.processable !== false);
    if (processablePapers.length === 0) {
      await ctx.db.patch("extractionJobs", args.jobId, {
        status: "failed",
        processedPapers: 0,
        failedPapers: 0,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return null;
    }

    const completedCount = processablePapers.filter((p) => p.status === "completed").length;
    const failedCount = processablePapers.filter(
      (p) =>
        p.status === "failed" ||
        p.status === "download_failed" ||
        p.status === "indexing_failed"
    ).length;

    if (completedCount + failedCount < processablePapers.length) {
      await ctx.db.patch("extractionJobs", args.jobId, {
        updatedAt: Date.now(),
      });
      return null;
    }

    const status =
      failedCount === processablePapers.length ? "failed" : "completed";

    await ctx.db.patch("extractionJobs", args.jobId, {
      status,
      processedPapers: completedCount,
      failedPapers: failedCount,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Helper mutations for test job creation
export const createJobDirect = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    sourceType: v.union(
      v.literal("history"),
      v.literal("zotero"),
      v.literal("manual"),
      v.literal("mixed")
    ),
    searchFilters: v.optional(searchFiltersValidator),
    sourceHistoryEntries: v.optional(
      v.array(
        v.object({
          historyId: v.string(),
          searchFilters: searchFiltersValidator,
        })
      )
    ),
    sourceZoteroSelection: v.optional(
      v.object({
        libraryType: v.union(v.literal("user"), v.literal("group")),
        groupId: v.optional(v.string()),
        zoteroUserId: v.optional(v.string()),
        collectionKey: v.optional(v.string()),
        includeDescendants: v.optional(v.boolean()),
        items: v.array(
          v.object({
            itemKey: v.string(),
            title: v.string(),
            abstract: v.optional(v.string()),
            authors: v.array(v.string()),
            year: v.optional(v.number()),
            doi: v.optional(v.string()),
          })
        ),
      })
    ),
    sourceManualItems: v.optional(
      v.array(
        v.object({
          id: v.string(),
          title: v.string(),
          abstract: v.optional(v.string()),
          authors: v.optional(v.array(v.string())),
          year: v.optional(v.number()),
          doi: v.optional(v.string()),
          pdfUrl: v.optional(v.string()),
          storageId: v.optional(v.id("_storage")),
        })
      )
    ),
  },
  returns: v.id("extractionJobs"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("extractionJobs", {
      userId: args.userId,
      name: args.name,
      sourceType: args.sourceType,
      searchFilters: args.searchFilters,
      sourceHistoryEntries: args.sourceHistoryEntries,
      sourceZoteroSelection: args.sourceZoteroSelection,
      sourceManualItems: args.sourceManualItems,
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const createQuestionDirect = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    key: v.string(),
    question: v.string(),
    type: v.union(v.literal("string"), v.literal("boolean"), v.literal("number"), v.literal("array")),
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
    await ctx.db.patch("extractionJobs", args.jobId, { workflowId: args.workflowId });
    return null;
  },
});

// Enqueue paper for processing via workpool (3-step workflow)
export const enqueuePaperProcessing = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    pdfUrl: v.string(),
    storageId: v.optional(v.id("_storage")),
    title: v.string(),
    abstract: v.optional(v.string()),
    doi: v.optional(v.string()),
    questions: v.array(
      v.object({
        key: v.string(),
        question: v.string(),
        type: v.union(
          v.literal("string"),
          v.literal("boolean"),
          v.literal("number"),
          v.literal("array")
        ),
        description: v.optional(v.string()),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    console.log(`[enqueuePaperProcessing] START - Paper ${args.paperId}, PDF URL: ${args.pdfUrl ? "YES" : "NO"}`);
    
    // Update status to downloading before enqueuing
    await ctx.db.patch("extractionPapers", args.paperId, {
      status: "downloading",
    });
    console.log(`[enqueuePaperProcessing] Status updated to 'downloading' for ${args.paperId}`);

    // Enqueue Step 1: Download and index PDF. Capture the WorkId so
    // cancelExtraction can abort this specific item without touching other
    // jobs' in-flight work in the shared pool.
    console.log(`[enqueuePaperProcessing] Enqueuing Step 1 (Download & Index) for paper ${args.paperId}`);
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
        onComplete: internal.extraction.mutations.handleDownloadAndIndexComplete,
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
      }
    );
    await ctx.db.patch("extractionPapers", args.paperId, { workId });
    console.log(`[enqueuePaperProcessing] SUCCESS - Paper ${args.paperId} enqueued for processing (workId ${workId})`);
    return null;
  },
});

// Handle Step 1 completion: Download & Index
export const handleDownloadAndIndexComplete = pdfProcessingPool.defineOnComplete({
  context: v.object({
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    questions: v.array(
      v.object({
        key: v.string(),
        question: v.string(),
        type: v.union(
          v.literal("string"),
          v.literal("boolean"),
          v.literal("number"),
          v.literal("array")
        ),
        description: v.optional(v.string()),
      })
    ),
  }),
  handler: async (ctx, { context, result }) => {
    const { paperId, jobId, questions } = context;
    console.log(`[handleDownloadAndIndexComplete] Paper ${paperId}, result: ${result.kind}`);

    if (result.kind === "success") {
      const data = result.returnValue as {
        success: boolean;
        storageId?: string;
        chunksCount?: number;
        error?: string;
      };

      if (data.success) {
        console.log(`[handleDownloadAndIndexComplete] Download/index success for ${paperId}, chunks: ${data.chunksCount}`);
        
        // Update status to indexing
        await ctx.db.patch("extractionPapers", paperId, {
          status: "indexing",
        });

        if ((data.chunksCount ?? 0) === 0) {
          await ctx.db.patch("extractionPapers", paperId, {
            isIndexed: false,
          });
        }

        // Step 2: Wait for indexing and extract. Capture the WorkId so
        // cancelExtraction can abort only this paper's work item.
        const extractWorkId = await pdfProcessingPool.enqueueAction(
          ctx,
          internal.extraction.workpoolActions.waitAndExtractAction,
          {
            paperId,
            jobId,
            questions,
          },
          {
            onComplete: internal.extraction.mutations.handleExtractionComplete,
            context: { paperId, jobId },
            retry: {
              maxAttempts: 3,
              initialBackoffMs: 2000,
              base: 2,
            },
          }
        );
        await ctx.db.patch("extractionPapers", paperId, { workId: extractWorkId });
      } else {
        // Download failed - mark as failed
        console.log(`[handleDownloadAndIndexComplete] Download failed for ${paperId}: ${data.error}`);
        await ctx.db.patch("extractionPapers", paperId, {
          status: "download_failed",
          errorMessage: data.error || "Download failed",
          completedAt: Date.now(),
        });
        await ctx.runMutation(internal.extraction.mutations.finalizeJobIfDone, {
          jobId,
        });
      }
    } else if (result.kind === "failed") {
      await ctx.db.patch("extractionPapers", paperId, {
        status: "failed",
        errorMessage: result.error || "Download/index action failed",
        completedAt: Date.now(),
      });
      await ctx.runMutation(internal.extraction.mutations.finalizeJobIfDone, {
        jobId,
      });
    } else if (result.kind === "canceled") {
      await ctx.db.patch("extractionPapers", paperId, {
        status: "failed",
        errorMessage: "Download/index was canceled",
        completedAt: Date.now(),
      });
      await ctx.runMutation(internal.extraction.mutations.finalizeJobIfDone, {
        jobId,
      });
    }
  },
});

// Handle Step 2 completion: Wait & Extract
export const handleExtractionComplete = pdfProcessingPool.defineOnComplete({
  context: v.object({
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
  }),
  handler: async (ctx, { context, result }) => {
    const { paperId, jobId } = context;
    console.log(`[handleExtractionComplete] Paper ${paperId}, result: ${result.kind}`);

    if (result.kind === "success") {
      const data = result.returnValue as {
        success: boolean;
        results?: ExtractionResult[];
        creditsUsed?: number;
        pdfContentUsed?: boolean;
        error?: string;
      };

      if (data.success && data.results) {
        // saveExtractionResultsAndComplete already calls finalizeJobIfDone as
        // its last step. Calling it a second time here races with itself and
        // double-counts paper stats before the prior mutation's write lands.
        await ctx.runMutation(
          internal.extraction.mutations.saveExtractionResultsAndComplete,
          {
            paperId,
            results: data.results,
            creditsUsed: data.creditsUsed || 0,
            pdfContentUsed: data.pdfContentUsed || false,
          }
        );
        console.log(`[handleExtractionComplete] Paper ${paperId} completed successfully`);
      } else {
        await ctx.db.patch("extractionPapers", paperId, {
          status: "failed",
          errorMessage: data.error || "Extraction failed",
          completedAt: Date.now(),
        });
        await ctx.runMutation(internal.extraction.mutations.finalizeJobIfDone, {
          jobId,
        });
      }
    } else if (result.kind === "failed") {
      await ctx.db.patch("extractionPapers", paperId, {
        status: "failed",
        errorMessage: result.error || "Extraction action failed",
        completedAt: Date.now(),
      });
      await ctx.runMutation(internal.extraction.mutations.finalizeJobIfDone, {
        jobId,
      });
    } else if (result.kind === "canceled") {
      await ctx.db.patch("extractionPapers", paperId, {
        status: "failed",
        errorMessage: "Extraction was canceled",
        completedAt: Date.now(),
      });
      await ctx.runMutation(internal.extraction.mutations.finalizeJobIfDone, {
        jobId,
      });
    }
  },
});

// Get userId from job (for actions that can't call queries)
export const getUserIdFromJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("extractionJobs", args.jobId);
    if (!job) {
      throw createError("NOT_FOUND", "Job not found");
    }
    return job.userId;
  },
});

// Handle paper fetch completion from workpool
export const handlePaperFetchComplete = pdfProcessingPool.defineOnComplete({
  context: v.object({
    jobId: v.id("extractionJobs"),
  }),
  handler: async (ctx, { context, result }) => {
    const { jobId } = context;

    if (result.kind === "success") {
      const data = result.returnValue as {
        papers: Array<{
          openalexId: string;
          title: string;
          doi?: string;
          publicationYear?: number;
          abstract?: string;
          authors?: string[];
          pdfUrl?: string;
          isOpenAccess?: boolean;
        }>;
        count: number;
      };

      if (data.papers && data.papers.length > 0) {
        const validPapers = data.papers.filter((paper): paper is NonNullable<typeof paper> => Boolean(paper));
        // Create paper records
        await ctx.runMutation(
          internal.extraction.mutations.createPaperRecords,
          {
            jobId,
            papers: validPapers,
          }
        );

        // Update job with total papers
        await ctx.db.patch("extractionJobs", jobId, {
          totalPapers: data.papers.length,
          updatedAt: Date.now(),
        });

        console.log(`[handlePaperFetchComplete] Created ${data.papers.length} papers for job ${jobId}`);
      } else {
        // No papers found
        await ctx.db.patch("extractionJobs", jobId, {
          status: "failed",
          updatedAt: Date.now(),
        });
        console.log(`[handlePaperFetchComplete] No papers found for job ${jobId}`);
      }
    } else if (result.kind === "failed") {
      // Action failed
      await ctx.db.patch("extractionJobs", jobId, {
        status: "failed",
        updatedAt: Date.now(),
      });
      console.error(`[handlePaperFetchComplete] Failed to fetch papers for job ${jobId}:`, result.error);
    } else if (result.kind === "canceled") {
      // Action was canceled
      await ctx.db.patch("extractionJobs", jobId, {
        status: "failed",
        updatedAt: Date.now(),
      });
      console.log(`[handlePaperFetchComplete] Paper fetch canceled for job ${jobId}`);
    }
  },
});

// Save extraction results and mark paper complete (used by workflow)
export const saveExtractionResultsAndComplete = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    results: v.array(
      v.object({
        questionKey: v.string(),
        answer: v.union(v.string(), v.boolean(), v.number(), v.array(v.string()), v.null()),
        confidence: v.optional(v.number()),
        reasoning: v.optional(v.string()),
        citations: v.array(
          v.object({
            evidenceId: v.string(),
            page: v.number(),
            charRange: v.array(v.number()),
            quote: v.string(),
            retrieval: v.object({
              denseScore: v.optional(v.number()),
              lexicalScore: v.optional(v.number()),
              fusedScore: v.optional(v.number()),
              rerankScore: v.optional(v.number()),
            }),
            validated: v.boolean(),
          })
        ),
        citationStatus: v.union(
          v.literal("grounded"),
          v.literal("best_effort"),
          v.literal("insufficient_evidence"),
          v.literal("extraction_error")
        ),
        retrievalDiagnostics: v.optional(
          v.object({
            denseCandidates: v.number(),
            lexicalCandidates: v.number(),
            fusedCandidates: v.number(),
            rerankedCandidates: v.number(),
            validatedCitations: v.number(),
            strictNull: v.boolean(),
          })
        ),
        pdfContentUsed: v.optional(v.boolean()),
      })
    ),
    creditsUsed: v.number(),
    storageId: v.optional(v.id("_storage")),
    pdfContentUsed: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    // Terminal-state guard: if the job was already cancelled/failed/completed,
    // do not persist new results and do not trigger finalize. A late-arriving
    // workpool completion must not resurrect a terminated job.
    const paper = await ctx.db.get("extractionPapers", args.paperId);
    if (!paper) return;
    const parentJob = await ctx.db.get("extractionJobs", paper.jobId);
    if (
      parentJob &&
      (parentJob.status === "cancelled" ||
        parentJob.status === "failed" ||
        parentJob.status === "completed")
    ) {
      console.log(
        `[saveExtractionResultsAndComplete] Skipping ${args.paperId}; job ${paper.jobId} already ${parentJob.status}`,
      );
      return;
    }

    // Billing-idempotency guard: if we already persisted results + billed this
    // paper, a re-run from a late onComplete or OCC retry must not re-insert
    // results or re-charge the user.
    if (paper.status === "completed" || paper.extractionBilled) {
      console.log(
        `[saveExtractionResultsAndComplete] Skipping ${args.paperId}; already completed/billed`,
      );
      return;
    }

    // Save extraction results
    for (const result of args.results.filter(Boolean)) {
      await ctx.db.insert("extractionResults", {
        paperId: args.paperId,
        questionKey: result.questionKey,
        answer: result.answer,
        confidence: result.confidence,
        reasoning: result.reasoning,
        citations: result.citations,
        citationStatus: result.citationStatus,
        retrievalDiagnostics: result.retrievalDiagnostics,
        pdfContentUsed: result.pdfContentUsed,
        processedAt: Date.now(),
      });
    }

    // Deduct LLM credits atomically with persisting results. This transaction
    // either flips extractionBilled=true AND deducts, or neither. A retried
    // mutation (OCC) reads the committed extractionBilled=true and short-
    // circuits above.
    if (args.creditsUsed > 0 && parentJob) {
      await ctx.runMutation(internal.credits.internal.deductCredits, {
        userId: parentJob.userId,
        amount: args.creditsUsed,
        description: `AI: Extraction (${args.results.length} questions)`,
        metadata: {
          billingType: "extraction_llm",
          paperId: String(args.paperId),
          jobId: String(paper.jobId),
        },
      });
    }

    // Mark paper as completed
    const patchData: Partial<Doc<"extractionPapers">> = {
      status: "completed",
      completedAt: Date.now(),
      creditsUsed: args.creditsUsed,
      extractionBilled: true,
    };

    if (args.storageId) {
      patchData.storageId = args.storageId;
    }

    if (args.pdfContentUsed) {
      patchData.pdfContentUsed = true;
    }

    // Upsert extractionJobStats for each question result
    for (const result of args.results.filter(Boolean)) {
      const existingStat = await ctx.db
        .query("extractionJobStats")
        .withIndex("by_job_question", (q) =>
          q.eq("jobId", paper.jobId).eq("questionKey", result.questionKey))
        .unique();

      const isAnswered = result.answer !== null && result.answer !== undefined;
      const conf = typeof result.confidence === "number" ? result.confidence : undefined;
      const confBucket = conf === undefined ? "unknown"
        : conf >= 0.8 ? "high"
        : conf >= 0.5 ? "medium"
        : "low";

      const delta = {
        totalPapers: 1,
        totalAnswered: isAnswered ? 1 : 0,
        groundedCount: result.citationStatus === "grounded" ? 1 : 0,
        bestEffortCount: result.citationStatus === "best_effort" ? 1 : 0,
        insufficientEvidenceCount: result.citationStatus === "insufficient_evidence" ? 1 : 0,
        extractionErrorCount: result.citationStatus === "extraction_error" ? 1 : 0,
        confidenceSum: conf ?? 0,
        confidenceCount: conf !== undefined ? 1 : 0,
        highConfidenceCount: confBucket === "high" ? 1 : 0,
        mediumConfidenceCount: confBucket === "medium" ? 1 : 0,
        lowConfidenceCount: confBucket === "low" ? 1 : 0,
        unknownConfidenceCount: confBucket === "unknown" ? 1 : 0,
      };

      if (existingStat) {
        await ctx.db.patch("extractionJobStats", existingStat._id, {
          totalPapers: existingStat.totalPapers + delta.totalPapers,
          totalAnswered: existingStat.totalAnswered + delta.totalAnswered,
          groundedCount: existingStat.groundedCount + delta.groundedCount,
          bestEffortCount: existingStat.bestEffortCount + delta.bestEffortCount,
          insufficientEvidenceCount: existingStat.insufficientEvidenceCount + delta.insufficientEvidenceCount,
          extractionErrorCount: existingStat.extractionErrorCount + delta.extractionErrorCount,
          confidenceSum: existingStat.confidenceSum + delta.confidenceSum,
          confidenceCount: existingStat.confidenceCount + delta.confidenceCount,
          highConfidenceCount: existingStat.highConfidenceCount + delta.highConfidenceCount,
          mediumConfidenceCount: existingStat.mediumConfidenceCount + delta.mediumConfidenceCount,
          lowConfidenceCount: existingStat.lowConfidenceCount + delta.lowConfidenceCount,
          unknownConfidenceCount: existingStat.unknownConfidenceCount + delta.unknownConfidenceCount,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("extractionJobStats", {
          jobId: paper.jobId,
          questionKey: result.questionKey,
          ...delta,
          updatedAt: Date.now(),
        });
      }
    }

    await ctx.db.patch("extractionPapers", args.paperId, patchData);
    await ctx.runMutation(internal.extraction.mutations.finalizeJobIfDone, {
      jobId: paper.jobId,
    });
    console.log(`[saveExtractionResultsAndComplete] Paper ${args.paperId} completed with ${args.results.length} results`);
  },
});

export const replacePaperEvidenceUnits = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    units: v.array(
      v.object({
        evidenceId: v.string(),
        page: v.number(),
        charRange: v.array(v.number()),
        text: v.string(),
        section: v.optional(v.string()),
        tokens: v.array(v.string()),
        anchorConfidence: v.number(),
        source: v.string(),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query("extractionEvidenceUnits")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .take(MAX_EVIDENCE_UNITS_PER_PAPER);

    for (const row of existing) {
      await ctx.db.delete("extractionEvidenceUnits", row._id);
    }

    for (const unit of args.units) {
      await ctx.db.insert("extractionEvidenceUnits", {
        paperId: args.paperId,
        evidenceId: unit.evidenceId,
        page: unit.page,
        charRange: unit.charRange,
        text: unit.text,
        section: unit.section,
        tokens: unit.tokens,
        anchorConfidence: unit.anchorConfidence,
        source: unit.source,
        createdAt: Date.now(),
      });
    }
    return null;
  },
});

