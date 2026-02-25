/**
 * Extraction Mutations
 * Public and internal mutations for data extraction jobs
 * Using Workflows and Workpools for durable execution
 */

import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { PaperData, ExtractionResult } from "./types";
import type { Doc, Id } from "../_generated/dataModel";
import { pdfProcessingPool } from "../workpool";
import { getProcessableFlags } from "./content";
import { workflow } from "../workflow";
import { requireAuth } from "../lib/auth";
import { requireExtractionEnabled, requireProPlan } from "./guard";
import {
  aggregateQuestionInsights,
  buildDisagreementClusters,
  buildRunDiff,
  formatAnswerForDisplay,
  type InsightEntry,
  type RunDiffRecord,
} from "../../lib/extraction/insights";

import { createError } from "../lib/errors";

async function assertJobOwnership(
  ctx: any,
  userId: Id<"users">,
  jobId: Id<"extractionJobs">
) {
  const job = await ctx.db.get(jobId);
  if (!job || job.userId !== userId) {
    throw createError("NOT_FOUND", "Job not found");
  }
  return job;
}

async function loadJobDataForReporting(
  ctx: any,
  jobId: Id<"extractionJobs">
) {
  const [questions, papers] = await Promise.all([
    ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q: any) => q.eq("jobId", jobId))
      .order("asc")
      .collect(),
    ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q: any) => q.eq("jobId", jobId))
      .collect(),
  ]);

  const resultsByPaper = new Map<string, Doc<"extractionResults">[]>();
  const reviewsByResult = new Map<string, Doc<"extractionResultReviews">>();

  for (const paper of papers) {
    const [results, reviews] = await Promise.all([
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q: any) => q.eq("paperId", paper._id))
        .collect(),
      ctx.db
        .query("extractionResultReviews")
        .withIndex("by_paper", (q: any) => q.eq("paperId", paper._id))
        .collect(),
    ]);
    resultsByPaper.set(paper._id, results);
    for (const review of reviews) {
      reviewsByResult.set(review.resultId, review);
    }
  }

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
    citationStatus: result?.citationStatus as any,
    pdfContentUsed: Boolean(result?.pdfContentUsed),
    reviewState: (review?.state as any) || "unreviewed",
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
    searchFilters: v.optional(v.record(v.string(), v.any())),
    sourceHistoryEntries: v.optional(
      v.array(
        v.object({
          historyId: v.string(),
          searchFilters: v.record(v.string(), v.any()),
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
    requireExtractionEnabled();
    const user = await requireAuth(ctx);
    await requireProPlan(ctx, user._id, "Data extraction");

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
    await ctx.db.patch(jobId, { 
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
    requireExtractionEnabled();
    const user = await requireAuth(ctx);

    const job = await ctx.db.get(args.jobId);

    if (!job || job.userId !== user._id) {
      throw createError("NOT_FOUND", "Job not found");
    }

    // Only allow cancelling pending or active jobs
    if (["completed", "failed", "cancelled"].includes(job.status)) {
       // Already done, just return success
       return { success: true };
    }

    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const duplicateExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  handler: async (ctx, args): Promise<{ jobId: Id<"extractionJobs"> }> => {
    requireExtractionEnabled();
    const user = await requireAuth(ctx);
    await requireProPlan(ctx, user._id, "Data extraction");

    const oldJob = await ctx.db.get(args.jobId);
    if (!oldJob || oldJob.userId !== user._id) {
      throw createError("NOT_FOUND", "Job not found");
    }

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

    await ctx.db.patch(newJobId, { 
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
    requireExtractionEnabled();
    const user = await requireAuth(ctx);
    const result = await ctx.db.get(args.resultId);
    if (!result) throw createError("NOT_FOUND", "Result not found");

    const paper = await ctx.db.get(result.paperId);
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
        await ctx.db.delete(existing._id);
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
      await ctx.db.patch(existing._id, patchData);
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
    requireExtractionEnabled();
    const user = await requireAuth(ctx);
    await requireProPlan(ctx, user._id, "Data extraction");
    const template = await ctx.db.get(args.templateId);
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
    await ctx.db.patch(jobId, {
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
    requireExtractionEnabled();
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
      await ctx.db.patch(existing._id, {
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
    requireExtractionEnabled();
    const user = await requireAuth(ctx);

    const view = await ctx.db.get(args.viewId);
    if (!view) throw createError("NOT_FOUND", "Saved view not found");

    await assertJobOwnership(ctx, user._id, view.jobId);

    await ctx.db.delete(args.viewId);
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
    requireExtractionEnabled();
    const user = await requireAuth(ctx);
    await requireProPlan(ctx, user._id, "Workflow templates");
    const job = await assertJobOwnership(ctx, user._id, args.jobId);

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
      await ctx.db.patch(existing._id, templateFields);
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
          searchFilters: v.record(v.string(), v.any()),
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
    requireExtractionEnabled();
    const user = await requireAuth(ctx);
    await requireProPlan(ctx, user._id, "Workflow templates");

    const existing = await ctx.db
      .query("extractionWorkflowTemplates")
      .withIndex("by_user_name", (q) =>
        q.eq("userId", user._id).eq("name", args.name.trim())
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
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
    requireExtractionEnabled();
    const user = await requireAuth(ctx);

    const template = await ctx.db.get(args.templateId);
    if (!template || template.userId !== user._id) {
      throw createError("NOT_FOUND", "Template not found");
    }

    await ctx.db.delete(args.templateId);
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
    requireExtractionEnabled();
    const user = await requireAuth(ctx);
    const job = await assertJobOwnership(ctx, user._id, args.jobId);
    const { questions, papers, resultsByPaper, reviewsByResult } =
      await loadJobDataForReporting(ctx, args.jobId);

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
        aggregate: aggregateQuestionInsights(entries, question.type as any),
        disagreements: buildDisagreementClusters(entries, question.type as any),
        entries,
      };
    });

    const keyFindingsLines = insightByQuestion.map((row: any) => {
      const top = row.aggregate.topAnswers[0];
      const topText = top ? `"${top.display}" (${top.count})` : "No dominant answer";
      return `- ${row.question.question}: ${topText}`;
    });

    const disagreementLines = insightByQuestion
      .filter((row: any) => row.disagreements.length > 1)
      .map((row: any) => {
        const topCluster = row.disagreements
          .slice(0, 2)
          .map((cluster: any) => `${cluster.displayAnswer} (${cluster.count})`)
          .join(" vs ");
        return `- ${row.question.question}: ${topCluster}`;
      });

    const evidenceHighlights = insightByQuestion
      .flatMap((row: any) => {
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
              row.question.type as any
            )} (${entry.title})`
        );
      })
      .slice(0, 12);

    const totalExpected = scopedPapers.length * Math.max(scopedQuestions.length, 1);
    const answeredTotal = insightByQuestion.reduce(
      (sum: number, row: any) => sum + row.aggregate.answered,
      0
    );
    const groundedTotal = insightByQuestion.reduce(
      (sum: number, row: any) => sum + row.aggregate.grounded,
      0
    );
    const bestEffortTotal = insightByQuestion.reduce(
      (sum: number, row: any) => sum + row.aggregate.citationStatusMix.best_effort,
      0
    );

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
            `- Answered rate: ${Math.round(
              (totalExpected > 0 ? answeredTotal / totalExpected : 0) * 100
            )}%.`,
            `- Grounded rate: ${Math.round(
              (totalExpected > 0 ? groundedTotal / totalExpected : 0) * 100
            )}%.`,
            `- Best-effort rate: ${Math.round(
              (totalExpected > 0 ? bestEffortTotal / totalExpected : 0) * 100
            )}%.`,
          ].join("\n"),
        },
      ],
      metrics: {
        totalPapers: scopedPapers.length,
        answeredRate: totalExpected > 0 ? answeredTotal / totalExpected : 0,
        groundedRate: totalExpected > 0 ? groundedTotal / totalExpected : 0,
        bestEffortRate: totalExpected > 0 ? bestEffortTotal / totalExpected : 0,
      },
      generatedAt: Date.now(),
      createdAt: Date.now(),
    });

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
    requireExtractionEnabled();
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
            citationStatus: result.citationStatus as any,
          });
        }
      }
      return rows;
    };

    const { summary, changes } = buildRunDiff(
      toDiffRecords(baselineData.papers, baselineData.resultsByPaper),
      toDiffRecords(currentData.papers, currentData.resultsByPaper)
    );

    const diffId = await ctx.db.insert("extractionRunDiffs", {
      jobId: args.jobId,
      baselineJobId: args.baselineJobId,
      userId: user._id,
      summary,
      changes: changes.slice(0, 1000),
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
    requireExtractionEnabled();
    const user = await requireAuth(ctx);

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) throw createError("NOT_FOUND", "Job not found");

    // Defer the cascade delete to an internal mutation so it doesn't hit transaction limits
    await ctx.runMutation(internal.extraction.mutations.deleteExtractionInternal, {
      jobId: args.jobId
    });
    
    return null;
  }
});

export const deleteExtractionInternal = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Delete in batches to avoid hitting transaction limits
    const BATCH_SIZE = 100;
    
    // 1. Delete Results
    const papers = await ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", args.jobId)).collect();
    for (const paper of papers) {
      const results = await ctx.db.query("extractionResults").withIndex("by_paper", (q) => q.eq("paperId", paper._id)).take(BATCH_SIZE);
      if (results.length > 0) {
        for (const res of results) await ctx.db.delete(res._id);
        // Reschedule ourselves if we hit the batch limit to continue deleting
        await ctx.runMutation(internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
        return null;
      }
    }

    // 2. Delete Papers
    const remainingPapers = await ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", args.jobId)).take(BATCH_SIZE);
    if (remainingPapers.length > 0) {
       for (const paper of remainingPapers) await ctx.db.delete(paper._id);
       await ctx.runMutation(internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
       return null;
    }

    // 3. Delete Questions
    const questions = await ctx.db.query("extractionQuestions").withIndex("by_job", (q) => q.eq("jobId", args.jobId)).take(BATCH_SIZE);
    if (questions.length > 0) {
      for (const q of questions) await ctx.db.delete(q._id);
      await ctx.runMutation(internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
      return null;
    }
    
    // 4. Delete the job itself now that everything is cleaned up
    const job = await ctx.db.get(args.jobId);
    if (job) await ctx.db.delete(args.jobId);

    return null;
  }
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
    for (const paper of args.papers) {
      const { processable } = getProcessableFlags({
        pdfUrl: paper.pdfUrl,
        storageId: paper.storageId,
        abstract: paper.abstract,
      });
      await ctx.db.insert("extractionPapers", {
        jobId: args.jobId,
        openalexId: paper.openalexId,
        title: paper.title,
        doi: paper.doi,
        publicationYear: paper.publicationYear,
        abstract: paper.abstract,
        authors: paper.authors,
        pdfUrl: paper.pdfUrl,
        storageId: paper.storageId,
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

    await ctx.db.patch(args.jobId, updates);
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

    await ctx.db.patch(args.paperId, updates);
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
    await ctx.db.patch(args.paperId, {
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
    await ctx.db.patch(args.paperId, {
      storageId: args.storageId,
      processable: true,
    });
    return null;
  },
});

export const setPaperWorkId = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    workId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.paperId, {
      workId: args.workId,
    });
    return null;
  },
});

export const markPaperIndexed = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    ragEntryId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const updates: Record<string, unknown> = {
      isIndexed: true,
      indexedAt: Date.now(),
    };

    if (args.ragEntryId) {
      updates.ragEntryId = args.ragEntryId;
    }

    await ctx.db.patch(args.paperId, updates);
    return null;
  },
});

export const finalizeJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;

    // Count final stats
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

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

    await ctx.db.patch(args.jobId, {
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

    const oldPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_status_completedAt", (q) => 
        q.eq("status", "completed").lt("completedAt", cutoffTime)
      )
      .collect();

    for (const paper of oldPapers) {
      if (paper.storageId) {
        try {
          await ctx.storage.delete(paper.storageId);
          await ctx.db.patch(paper._id, {
            storageId: undefined,
          });
        } catch (error) {
          console.error(`Failed to delete PDF for paper ${paper._id}:`, error);
        }
      }
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
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    if (papers.length === 0) return null;

    const processablePapers = papers.filter((p) => p.processable !== false);
    if (processablePapers.length === 0) {
      await ctx.db.patch(args.jobId, {
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
      await ctx.db.patch(args.jobId, {
        updatedAt: Date.now(),
      });
      return null;
    }

    const status =
      failedCount === processablePapers.length ? "failed" : "completed";

    await ctx.db.patch(args.jobId, {
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
    searchFilters: v.optional(v.record(v.string(), v.any())),
    sourceHistoryEntries: v.optional(
      v.array(
        v.object({
          historyId: v.string(),
          searchFilters: v.record(v.string(), v.any()),
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
    await ctx.db.patch(args.jobId, { workflowId: args.workflowId });
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
    await ctx.db.patch(args.paperId, {
      status: "downloading",
    });
    console.log(`[enqueuePaperProcessing] Status updated to 'downloading' for ${args.paperId}`);

    // Enqueue Step 1: Download and index PDF
    console.log(`[enqueuePaperProcessing] Enqueuing Step 1 (Download & Index) for paper ${args.paperId}`);
    await pdfProcessingPool.enqueueAction(
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
    console.log(`[enqueuePaperProcessing] SUCCESS - Paper ${args.paperId} enqueued for processing`);
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
        await ctx.db.patch(paperId, {
          status: "indexing",
        });

        if ((data.chunksCount ?? 0) === 0) {
          await ctx.db.patch(paperId, {
            isIndexed: false,
          });
        }

        // Step 2: Wait for indexing and extract
        await pdfProcessingPool.enqueueAction(
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
      } else {
        // Download failed - mark as failed
        console.log(`[handleDownloadAndIndexComplete] Download failed for ${paperId}: ${data.error}`);
        await ctx.db.patch(paperId, {
          status: "download_failed",
          errorMessage: data.error || "Download failed",
          completedAt: Date.now(),
        });
        await ctx.runMutation(internal.extraction.mutations.finalizeJobIfDone, {
          jobId,
        });
      }
    } else if (result.kind === "failed") {
      await ctx.db.patch(paperId, {
        status: "failed",
        errorMessage: result.error || "Download/index action failed",
        completedAt: Date.now(),
      });
      await ctx.runMutation(internal.extraction.mutations.finalizeJobIfDone, {
        jobId,
      });
    } else if (result.kind === "canceled") {
      await ctx.db.patch(paperId, {
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
        results?: Array<any>;
        creditsUsed?: number;
        pdfContentUsed?: boolean;
        error?: string;
      };

    if (data.success && data.results) {
        await ctx.runMutation(
          internal.extraction.mutations.saveExtractionResultsAndComplete,
          {
            paperId,
            results: data.results,
            creditsUsed: data.creditsUsed || 0,
            pdfContentUsed: data.pdfContentUsed || false,
          }
        );
        await ctx.runMutation(internal.extraction.mutations.finalizeJobIfDone, {
          jobId,
        });
        console.log(`[handleExtractionComplete] Paper ${paperId} completed successfully`);
      } else {
        await ctx.db.patch(paperId, {
          status: "failed",
          errorMessage: data.error || "Extraction failed",
          completedAt: Date.now(),
        });
        await ctx.runMutation(internal.extraction.mutations.finalizeJobIfDone, {
          jobId,
        });
      }
    } else if (result.kind === "failed") {
      await ctx.db.patch(paperId, {
        status: "failed",
        errorMessage: result.error || "Extraction action failed",
        completedAt: Date.now(),
      });
      await ctx.runMutation(internal.extraction.mutations.finalizeJobIfDone, {
        jobId,
      });
    } else if (result.kind === "canceled") {
      await ctx.db.patch(paperId, {
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
    const job = await ctx.db.get(args.jobId);
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
        await ctx.db.patch(jobId, {
          totalPapers: data.papers.length,
          updatedAt: Date.now(),
        });

        console.log(`[handlePaperFetchComplete] Created ${data.papers.length} papers for job ${jobId}`);
      } else {
        // No papers found
        await ctx.db.patch(jobId, {
          status: "failed",
          updatedAt: Date.now(),
        });
        console.log(`[handlePaperFetchComplete] No papers found for job ${jobId}`);
      }
    } else if (result.kind === "failed") {
      // Action failed
      await ctx.db.patch(jobId, {
        status: "failed",
        updatedAt: Date.now(),
      });
      console.error(`[handlePaperFetchComplete] Failed to fetch papers for job ${jobId}:`, result.error);
    } else if (result.kind === "canceled") {
      // Action was canceled
      await ctx.db.patch(jobId, {
        status: "failed",
        updatedAt: Date.now(),
      });
      console.log(`[handlePaperFetchComplete] Paper fetch canceled for job ${jobId}`);
    }
  },
});

  // Backfill mutation to set isIndexed for papers with existing ragEntryId
export const backfillIsIndexed = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ updated: number; hasMore: boolean }> => {
    const batchSize = args.batchSize ?? 100;
    
    // Find papers with ragEntryId but no isIndexed flag
    // Without an explicit equality check on ragEntryId, we might not be able to fully query by index.
    // However, if we need to query by index, we can just do a full table scan since it's a backfill,
    // or collect everything. Let's just collect all papers and array filter them to avoid DB filters.
    // But since it's a large table, we should just use collect and slice.
    const papers = await ctx.db
      .query("extractionPapers")
      .collect();

    const targetPapers = papers.filter((p) => p.ragEntryId != null && p.isIndexed == null).slice(0, batchSize);
    
    let updated = 0;
    for (const paper of targetPapers) {
      await ctx.db.patch(paper._id, {
        isIndexed: true,
      });
      updated++;
    }
    
    console.log(`[backfillIsIndexed] Updated ${updated} papers`);
    return { updated, hasMore: targetPapers.length === batchSize };
  },
});

export const backfillProcessable = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
  },
  handler: async (ctx, args): Promise<{ updated: number; total: number }> => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    let updated = 0;
    for (const paper of papers) {
      const { processable } = getProcessableFlags({
        pdfUrl: paper.pdfUrl,
        abstract: paper.abstract,
      });
      if (paper.processable !== processable) {
        await ctx.db.patch(paper._id, { processable });
        updated++;
      }
    }

    return { updated, total: papers.length };
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

    // Mark paper as completed
    const patchData: any = {
      status: "completed",
      completedAt: Date.now(),
      creditsUsed: args.creditsUsed,
    };

    if (args.storageId) {
      patchData.storageId = args.storageId;
    }

    if (args.pdfContentUsed) {
      patchData.pdfContentUsed = true;
    }

    const paper = await ctx.db.get(args.paperId);
    if (!paper) return;

    await ctx.db.patch(args.paperId, patchData);
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
      .collect();

    for (const row of existing) {
      await ctx.db.delete(row._id);
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

export const resetExtractionMvpData = internalMutation({
  args: {
    jobId: v.optional(v.id("extractionJobs")),
  },
  handler: async (ctx, args): Promise<{ deletedResults: number; deletedUnits: number; updatedJobs: number }> => {
    const targetJobs = args.jobId
      ? [await ctx.db.get(args.jobId)].filter((job): job is NonNullable<typeof job> => Boolean(job))
      : await ctx.db.query("extractionJobs").collect();

    let deletedResults = 0;
    let deletedUnits = 0;
    let updatedJobs = 0;

    for (const job of targetJobs) {
      if (!job) continue;

      const papers = await ctx.db
        .query("extractionPapers")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .collect();

      for (const paper of papers) {
        const results = await ctx.db
          .query("extractionResults")
          .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
          .collect();
        for (const result of results) {
          await ctx.db.delete(result._id);
          deletedResults++;
        }

        const units = await ctx.db
          .query("extractionEvidenceUnits")
          .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
          .collect();
        for (const unit of units) {
          await ctx.db.delete(unit._id);
          deletedUnits++;
        }

        await ctx.db.patch(paper._id, {
          status: "pending",
          errorMessage: undefined,
          completedAt: undefined,
          creditsUsed: undefined,
          pdfContentUsed: false,
          isIndexed: false,
          ragEntryId: undefined,
        });
      }

      await ctx.db.patch(job._id, {
        status: "pending",
        processedPapers: 0,
        failedPapers: 0,
        updatedAt: Date.now(),
        completedAt: undefined,
      });
      updatedJobs++;
    }

    return { deletedResults, deletedUnits, updatedJobs };
  },
});

export const purgeLegacyExtractionRowsBatch = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    deletedResults: number;
    deletedUnits: number;
    hasMoreResults: boolean;
    hasMoreUnits: boolean;
  }> => {
    const limit = Math.max(1, Math.min(args.limit ?? 400, 1000));

    const results = await ctx.db.query("extractionResults").take(limit);
    for (const result of results) {
      await ctx.db.delete(result._id);
    }

    const units = await ctx.db.query("extractionEvidenceUnits").take(limit);
    for (const unit of units) {
      await ctx.db.delete(unit._id);
    }

    const hasMoreResults =
      (await ctx.db.query("extractionResults").take(1)).length > 0;
    const hasMoreUnits =
      (await ctx.db.query("extractionEvidenceUnits").take(1)).length > 0;

    return {
      deletedResults: results.length,
      deletedUnits: units.length,
      hasMoreResults,
      hasMoreUnits,
    };
  },
});
