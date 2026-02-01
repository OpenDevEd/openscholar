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
import { RAG } from "@convex-dev/rag";
import { components } from "../_generated/api";
import { openai } from "@ai-sdk/openai";
import { pdfProcessingPool } from "../workpool";
import { workflow } from "../workflow";

const rag = new RAG(components.rag, {
  textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  embeddingDimension: 1536,
});

// Start a new extraction job (public API)
export const startExtraction = mutation({
  args: {
    name: v.string(),
    sourceType: v.union(v.literal("history"), v.literal("zotero")),
    sourceHistoryId: v.optional(v.string()),
    searchFilters: v.optional(v.record(v.string(), v.any())),
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
  handler: async (ctx, args): Promise<{ jobId: Id<"extractionJobs"> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
      .unique();

    if (!user) {
      throw new Error("User not found");
    }

    const userId = user._id;

    // Create job record
    const jobId: Id<"extractionJobs"> = await ctx.db.insert("extractionJobs", {
      userId,
      name: args.name,
      sourceType: args.sourceType,
      sourceHistoryId: args.sourceHistoryId,
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
      { jobId, userId }
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
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
      .unique();

    if (!user) {
      throw new Error("User not found");
    }

    const job = await ctx.db.get(args.jobId);

    if (!job || job.userId !== user._id) {
      throw new Error("Job not found");
    }

    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });

    return { success: true };
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
      })
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    for (const paper of args.papers) {
      await ctx.db.insert("extractionPapers", {
        jobId: args.jobId,
        openalexId: paper.openalexId,
        title: paper.title,
        doi: paper.doi,
        publicationYear: paper.publicationYear,
        abstract: paper.abstract,
        authors: paper.authors,
        pdfUrl: paper.pdfUrl,
        status: "pending",
      });
    }
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
  handler: async (ctx, args): Promise<void> => {
    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.totalPapers !== undefined) {
      updates.totalPapers = args.totalPapers;
    }

    await ctx.db.patch(args.jobId, updates);
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
  handler: async (ctx, args): Promise<void> => {
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

    // Update job progress counters
    const paper = await ctx.db.get(args.paperId);
    if (paper) {
      const job = await ctx.db.get(paper.jobId);
      if (job) {
        if (args.status === "completed" || args.status === "failed") {
          const processedCount = await ctx.db
            .query("extractionPapers")
            .withIndex("by_job_status", (q) =>
              q
                .eq("jobId", paper.jobId)
                .eq("status", args.status === "completed" ? "completed" : "failed")
            )
            .collect()
            .then((papers) => papers.length);

          await ctx.db.patch(paper.jobId, {
            [args.status === "completed" ? "processedPapers" : "failedPapers"]:
              processedCount,
            updatedAt: Date.now(),
          });
        }
      }
    }
  },
});

export const setPaperStorage = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.paperId, {
      storageId: args.storageId,
    });
  },
});

export const setPaperWorkId = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    workId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.paperId, {
      workId: args.workId,
    });
  },
});

export const onRagIndexingComplete = rag.defineOnComplete(
  async (ctx, { entry, replacedEntry, namespace, error }) => {
    if (error) {
      console.error("RAG indexing failed:", error);
      return;
    }

    const paperId = entry.metadata?.paperId as string;
    const entryId = entry.entryId;

    if (paperId) {
      await ctx.db.patch(paperId as Id<"extractionPapers">, {
        ragEntryId: entryId,
        indexedAt: Date.now(),
      });
    }
  }
);

export const saveExtractionResults = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    results: v.array(
      v.object({
        questionKey: v.string(),
        answer: v.union(v.string(), v.boolean(), v.number(), v.array(v.string()), v.null()),
        confidence: v.optional(v.number()),
        reasoning: v.optional(v.string()),
        contextChunks: v.optional(v.array(v.string())),
        model: v.optional(v.string()),
        provider: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    for (const result of args.results) {
      await ctx.db.insert("extractionResults", {
        paperId: args.paperId,
        questionKey: result.questionKey,
        answer: result.answer,
        confidence: result.confidence,
        reasoning: result.reasoning,
        contextChunks: result.contextChunks,
        model: result.model,
        provider: result.provider,
        processedAt: Date.now(),
      });
    }
  },
});

export const finalizeJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
  },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return;

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
  },
});

// Delete old PDF files (called by cron)
export const cleanupOldPdfs = internalMutation({
  args: {
    maxAgeHours: v.number(),
  },
  handler: async (ctx, args): Promise<{ cleaned: number }> => {
    const cutoffTime = Date.now() - args.maxAgeHours * 60 * 60 * 1000;

    const oldPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_status")
      .filter((q) => q.eq(q.field("status"), "completed"))
      .filter((q) => q.lt(q.field("completedAt"), cutoffTime))
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
export const updateAllJobProgress = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    // Find all jobs that need paper processing
    const activeJobs = await ctx.db
      .query("extractionJobs")
      .withIndex("by_user_status")
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "downloading_pdfs"),
          q.eq(q.field("status"), "extracting")
        )
      )
      .take(10);

    for (const job of activeJobs) {
      // Check if we need to fetch papers from OpenAlex
      const existingPapers = await ctx.db
        .query("extractionPapers")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .collect();

      if (existingPapers.length === 0 && job.searchFilters) {
        // Enqueue paper fetching via workpool
        console.log(`[Cron] Enqueuing paper fetch for job ${job._id}`);
        try {
          await pdfProcessingPool.enqueueAction(
            ctx,
            internal.extraction.fetchPapersAction.fetchAndCreatePapers,
            {
              jobId: job._id,
              searchFilters: job.searchFilters,
            },
            {
              onComplete: internal.extraction.mutations.handlePaperFetchComplete,
              context: { jobId: job._id },
              retry: {
                maxAttempts: 3,
                initialBackoffMs: 2000,
                base: 2,
              },
            }
          );
        } catch (error) {
          console.error(`[Cron] Failed to enqueue paper fetch for job ${job._id}:`, error);
        }
        continue; // Skip to next job, papers will be processed in next cron run
      }

      // Get questions for this job
      const questions = await ctx.db
        .query("extractionQuestions")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .order("asc")
        .collect();

      // Get pending papers
      const pendingPapers = await ctx.db
        .query("extractionPapers")
        .withIndex("by_job_status", (q) =>
          q.eq("jobId", job._id).eq("status", "pending")
        )
        .take(5); // Process up to 5 papers per cron run

      // Enqueue papers for processing
      for (const paper of pendingPapers) {
        if (!paper.pdfUrl) {
          // Mark as failed if no PDF URL
          await ctx.db.patch(paper._id, {
            status: "download_failed",
            errorMessage: "No PDF URL available",
            completedAt: Date.now(),
          });
          continue;
        }

        // Update status to downloading
        await ctx.db.patch(paper._id, {
          status: "downloading",
        });

        // Enqueue for processing via workpool
        await pdfProcessingPool.enqueueAction(
          ctx,
          internal.extraction.workpoolActions.processPaperAction,
          {
            paperId: paper._id,
            jobId: job._id,
            pdfUrl: paper.pdfUrl,
            title: paper.title,
            questions: questions.map((q) => ({
              key: q.key,
              question: q.question,
              type: q.type,
              description: q.description,
            })),
          },
          {
            onComplete: internal.extraction.mutations.handlePaperComplete,
            context: { paperId: paper._id, jobId: job._id },
            retry: {
              maxAttempts: 3,
              initialBackoffMs: 2000,
              base: 2,
            },
          }
        );
      }

      // Update job progress
      await ctx.runMutation(internal.extraction.mutations.finalizeJob, {
        jobId: job._id,
      });
    }
  },
});

// Update job progress counters
export const updateJobProgress = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    processedPapers: v.number(),
    failedPapers: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.jobId, {
      processedPapers: args.processedPapers,
      failedPapers: args.failedPapers,
      updatedAt: Date.now(),
    });
  },
});

// Helper mutations for test job creation
export const createJobDirect = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    sourceType: v.union(v.literal("history"), v.literal("zotero")),
    searchFilters: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("extractionJobs", {
      userId: args.userId,
      name: args.name,
      sourceType: args.sourceType,
      searchFilters: args.searchFilters,
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
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, { workflowId: args.workflowId });
  },
});

// Enqueue paper for processing via workpool
export const enqueuePaperProcessing = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    pdfUrl: v.string(),
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
  handler: async (ctx, args) => {
    // Update status to downloading before enqueuing
    await ctx.db.patch(args.paperId, {
      status: "downloading",
    });

    // Enqueue via workpool
    await pdfProcessingPool.enqueueAction(
      ctx,
      internal.extraction.workpoolActions.processPaperAction,
      {
        paperId: args.paperId,
        abstract: args.abstract,
        doi: args.doi,
        jobId: args.jobId,
        pdfUrl: args.pdfUrl,
        title: args.title,
        questions: args.questions,
      },
      {
        onComplete: internal.extraction.mutations.handlePaperComplete,
        context: { paperId: args.paperId, jobId: args.jobId },
        retry: {
          maxAttempts: 3,
          initialBackoffMs: 2000,
          base: 2,
        },
      }
    );
  },
});

// Handle paper processing completion
export const handlePaperComplete = pdfProcessingPool.defineOnComplete({
  context: v.object({
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
  }),
  handler: async (ctx, { context, result }) => {
    const { paperId, jobId } = context;

    if (result.kind === "success") {
      const data = result.returnValue as {
        success: boolean;
        results?: Array<any>;
        error?: string;
        creditsUsed?: number;
      };

      if (data.success && data.results) {
        // Save extraction results
        for (const r of data.results) {
          await ctx.db.insert("extractionResults", {
            paperId,
            questionKey: r.questionKey,
            answer: r.answer,
            confidence: r.confidence,
            reasoning: r.reasoning,
            contextChunks: r.contextChunks,
            processedAt: Date.now(),
          });
        }

        // Mark paper as completed
        await ctx.db.patch(paperId, {
          status: "completed",
          completedAt: Date.now(),
          creditsUsed: data.creditsUsed || 0,
        });
      } else {
        // Mark paper as failed
        await ctx.db.patch(paperId, {
          status: "failed",
          errorMessage: data.error || "Processing failed",
          completedAt: Date.now(),
        });
      }
    } else if (result.kind === "failed") {
      // Action failed after retries
      await ctx.db.patch(paperId, {
        status: "failed",
        errorMessage: result.error || "Action failed",
        completedAt: Date.now(),
      });
    } else if (result.kind === "canceled") {
      // Action was canceled
      await ctx.db.patch(paperId, {
        status: "failed",
        errorMessage: "Processing was canceled",
        completedAt: Date.now(),
      });
    }

    // Note: Job progress is updated by the cron job (updateAllJobProgress)
    // to avoid OCC conflicts when many papers complete simultaneously
  },
});

// Create job by workosId (for actions that can't call queries)
export const createJobByWorkosId = internalMutation({
  args: {
    workosId: v.string(),
    name: v.string(),
    sourceType: v.union(v.literal("history"), v.literal("zotero")),
    searchFilters: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args) => {
    // Look up user by workosId
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", args.workosId))
      .unique();
    
    if (!user) {
      throw new Error("User not found");
    }
    
    const jobId = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      name: args.name,
      sourceType: args.sourceType,
      searchFilters: args.searchFilters,
      status: "downloading_pdfs",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    return jobId;
  },
});

// Get userId from job (for actions that can't call queries)
export const getUserIdFromJob = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error("Job not found");
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
        }>;
        count: number;
      };

      if (data.papers && data.papers.length > 0) {
        // Create paper records
        await ctx.runMutation(
          internal.extraction.mutations.createPaperRecords,
          {
            jobId,
            papers: data.papers,
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
