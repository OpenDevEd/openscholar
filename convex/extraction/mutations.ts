/**
 * Extraction Mutations
 * Public and internal mutations for data extraction jobs
 * Using Workflows and Workpools for durable execution
 */

import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { PaperData, ExtractionResult } from "./types";
import type { Id } from "../_generated/dataModel";
import { pdfProcessingPool } from "../workpool";
import { getProcessableFlags } from "./content";
import { workflow } from "../workflow";
import { requireAuth } from "../lib/auth";


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
  handler: async (ctx, args): Promise<{ jobId: Id<"extractionJobs"> }> => {
    const user = await requireAuth(ctx);

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
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const user = await requireAuth(ctx);

    const job = await ctx.db.get(args.jobId);

    if (!job || job.userId !== user._id) {
      throw new Error("Job not found");
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
  handler: async (ctx, args): Promise<{ jobId: Id<"extractionJobs"> }> => {
    const user = await requireAuth(ctx);

    const oldJob = await ctx.db.get(args.jobId);
    if (!oldJob || oldJob.userId !== user._id) {
      throw new Error("Job not found");
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

export const deleteExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) throw new Error("Job not found");

    // Helper to delete in batches
    const deleteBatch = async (table: string, index: string, field: string) => {
        const items = await ctx.db
            .query(table as any)
            .withIndex(index, (q) => q.eq(field as any, args.jobId))
            .collect();
        for (const item of items) {
            await ctx.db.delete(item._id);
        }
    };

    // Delete related data 
    // Note: detailed cleanup might need internal mutation if too many items, but for now strict delete
    await deleteBatch("extractionPapers", "by_job", "jobId");
    await deleteBatch("extractionQuestions", "by_job", "jobId");
    // extractionResults are linked to papers, so we might need to delete them first or cascade
    // Actually, extractionResults bind to paperId. We need to find papers first.
    // This simple delete might be too slow for large jobs.
    // Better to just delete the job and let a cron clean up orphans, OR use a recursive delete here.
    // Given the urgency, I'll delete the job and papers/questions. Results might be orphaned but that's acceptable for now or I can iterate papers.
    // Let's iterate papers to be clean.
    
    // Deleting papers and their results
    const papers = await ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", args.jobId)).collect();
    for (const paper of papers) {
        const results = await ctx.db.query("extractionResults").withIndex("by_paper", (q) => q.eq("paperId", paper._id)).collect();
        for (const res of results) await ctx.db.delete(res._id);
        await ctx.db.delete(paper._id);
    }

    await ctx.db.query("extractionQuestions").withIndex("by_job", (q) => q.eq("jobId", args.jobId)).collect().then(qs => qs.forEach(q => ctx.db.delete(q._id)));
    
    await ctx.db.delete(args.jobId);
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
  handler: async (ctx, args): Promise<void> => {
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
  },
});

export const updatePaperProcessable = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    processable: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.paperId, {
      processable: args.processable,
    });
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
      processable: true,
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

export const markPaperIndexed = internalMutation({
  args: {
    paperId: v.id("extractionPapers"),
    ragEntryId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const updates: Record<string, unknown> = {
      isIndexed: true,
      indexedAt: Date.now(),
    };

    if (args.ragEntryId) {
      updates.ragEntryId = args.ragEntryId;
    }

    await ctx.db.patch(args.paperId, updates);
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
export const finalizeJobIfDone = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
  },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return;

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    if (papers.length === 0) return;

    const processablePapers = papers.filter((p) => p.processable !== false);
    if (processablePapers.length === 0) {
      await ctx.db.patch(args.jobId, {
        status: "failed",
        processedPapers: 0,
        failedPapers: 0,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return;
    }

    const completedCount = processablePapers.filter(
      (p) => p.status === "completed"
    ).length;
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
      return;
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

// Create job by workosId (for actions that can't call queries)
export const createJobByWorkosId = internalMutation({
  args: {
    workosId: v.string(),
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
      sourceHistoryEntries: args.sourceHistoryEntries,
      sourceZoteroSelection: args.sourceZoteroSelection,
      sourceManualItems: args.sourceManualItems,
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
          isOpenAccess?: boolean;
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

// Backfill mutation to set isIndexed for papers with existing ragEntryId
export const backfillIsIndexed = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ updated: number; hasMore: boolean }> => {
    const batchSize = args.batchSize ?? 100;
    
    // Find papers with ragEntryId but no isIndexed flag
    const papers = await ctx.db
      .query("extractionPapers")
      .filter((q) => q.and(
        q.neq(q.field("ragEntryId"), null),
        q.eq(q.field("isIndexed"), null)
      ))
      .take(batchSize);
    
    let updated = 0;
    for (const paper of papers) {
      await ctx.db.patch(paper._id, {
        isIndexed: true,
      });
      updated++;
    }
    
    console.log(`[backfillIsIndexed] Updated ${updated} papers`);
    return { updated, hasMore: papers.length === batchSize };
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
    for (const result of args.results) {
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
  handler: async (ctx, args): Promise<void> => {
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
  },
});

export const resetExtractionMvpData = internalMutation({
  args: {
    jobId: v.optional(v.id("extractionJobs")),
  },
  handler: async (ctx, args): Promise<{ deletedResults: number; deletedUnits: number; updatedJobs: number }> => {
    const targetJobs = args.jobId
      ? [await ctx.db.get(args.jobId)].filter(Boolean)
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
