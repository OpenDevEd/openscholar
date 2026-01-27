"use node";

/**
 * Universal Job System - Entry Points
 *
 * Public actions to start jobs for PDF download, RAG indexing, and extraction.
 * These replace the old job-specific entry points with the unified system.
 */
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { JOB_DEFAULTS, type JobType } from "./types";
import type { Id } from "../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// PDF DOWNLOAD JOB
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Start a PDF download job for all documents with open access URLs.
 */
export const startPdfDownloadJob = action({
  args: {
    analysisId: v.id("analyses"),
  },
  returns: v.object({
    jobId: v.id("jobs"),
    totalItems: v.number(),
  }),
  handler: async (
    ctx,
    { analysisId }
  ): Promise<{ jobId: Id<"jobs">; totalItems: number }> => {
    // Get documents with open access URLs that haven't been processed
    const docs = await ctx.runQuery(internal.rag.queries.getDocumentsWithOpenAccessUrls, {
      analysisId,
      limit: 500,
    });

    // Filter to only those without fullText or pdfStorageId
    const eligibleDocs = docs.filter(
      (doc: { _id: Id<"documents">; fullText?: string; pdfStorageId?: Id<"_storage"> }) =>
        !doc.fullText && !doc.pdfStorageId
    );

    const items = eligibleDocs.map(
      (doc: { _id: Id<"documents"> }) => ({
        type: "pdf_download" as const,
        documentId: doc._id,
      })
    );

    const defaults = JOB_DEFAULTS.pdf_download;

    const jobId = await ctx.runMutation(internal.jobs.mutations.createJob, {
      type: "pdf_download",
      analysisId,
      items,
      concurrencyLimit: defaults.concurrencyLimit,
      itemTimeoutMs: defaults.itemTimeoutMs,
      jobTimeoutMs: defaults.jobTimeoutMs,
      maxAttempts: defaults.maxAttempts,
    });

    console.log(`[Jobs] Started PDF download job ${jobId} with ${items.length} items`);

    return { jobId, totalItems: items.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// RAG INDEXING JOB
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Start a RAG indexing job for all unindexed documents.
 */
export const startRagIndexingJob = action({
  args: {
    analysisId: v.id("analyses"),
  },
  returns: v.object({
    jobId: v.id("jobs"),
    totalItems: v.number(),
  }),
  handler: async (
    ctx,
    { analysisId }
  ): Promise<{ jobId: Id<"jobs">; totalItems: number }> => {
    // Get unindexed documents with content
    const docs = await ctx.runQuery(internal.rag.queries.getUnindexedDocuments, {
      analysisId,
    });

    // Filter to only those with content (abstract or fullText)
    const eligibleDocs = docs.filter(
      (doc: { abstract?: string; hasFullText?: boolean }) =>
        doc.abstract || doc.hasFullText
    );

    const items = eligibleDocs.map(
      (doc: { _id: Id<"documents"> }) => ({
        type: "rag_indexing" as const,
        documentId: doc._id,
      })
    );

    const defaults = JOB_DEFAULTS.rag_indexing;

    const jobId = await ctx.runMutation(internal.jobs.mutations.createJob, {
      type: "rag_indexing",
      analysisId,
      items,
      concurrencyLimit: defaults.concurrencyLimit,
      itemTimeoutMs: defaults.itemTimeoutMs,
      jobTimeoutMs: defaults.jobTimeoutMs,
      maxAttempts: defaults.maxAttempts,
    });

    console.log(`[Jobs] Started RAG indexing job ${jobId} with ${items.length} items`);

    return { jobId, totalItems: items.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTION JOB
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Start an extraction job for all pending (document, question) pairs.
 */
export const startExtractionJob = action({
  args: {
    analysisId: v.id("analyses"),
  },
  returns: v.object({
    jobId: v.id("jobs"),
    totalItems: v.number(),
  }),
  handler: async (
    ctx,
    { analysisId }
  ): Promise<{ jobId: Id<"jobs">; totalItems: number }> => {
    // Get current user for credit tracking
    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Clean up orphaned results
    const cleanedUp = await ctx.runMutation(
      internal.extraction.results.cleanupIncompleteResults,
      { analysisId }
    );
    if (cleanedUp > 0) {
      console.log(`[Jobs] Cleaned up ${cleanedUp} incomplete extraction results`);
    }

    // Get pending extraction items
    const pendingItems = await ctx.runQuery(
      internal.extraction.internal.getPendingExtractionItems,
      { analysisId }
    );

    const items = pendingItems.map(
      (item: { documentId: Id<"documents">; questionId: string }) => ({
        type: "extraction" as const,
        documentId: item.documentId,
        questionId: item.questionId,
      })
    );

    const defaults = JOB_DEFAULTS.extraction;

    const jobId = await ctx.runMutation(internal.jobs.mutations.createJob, {
      type: "extraction",
      analysisId,
      userId: user._id,
      items,
      concurrencyLimit: defaults.concurrencyLimit,
      itemTimeoutMs: defaults.itemTimeoutMs,
      jobTimeoutMs: defaults.jobTimeoutMs,
      maxAttempts: defaults.maxAttempts,
    });

    // Update analysis status
    await ctx.runMutation(internal.extraction.analysesMutations.setStatus, {
      id: analysisId,
      status: "processing",
    });

    console.log(`[Jobs] Started extraction job ${jobId} with ${items.length} items`);

    return { jobId, totalItems: items.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// FULL PIPELINE (CHAINED JOBS)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Start a full pipeline: PDF download -> RAG indexing -> Extraction.
 * Jobs are chained so each starts after the previous completes.
 */
export const startFullPipeline = action({
  args: {
    analysisId: v.id("analyses"),
  },
  returns: v.object({
    chainId: v.string(),
    pdfDownloadJobId: v.id("jobs"),
    ragIndexingJobId: v.id("jobs"),
    extractionJobId: v.id("jobs"),
    totalItems: v.object({
      pdfDownload: v.number(),
      ragIndexing: v.number(),
      extraction: v.number(),
    }),
  }),
  handler: async (
    ctx,
    { analysisId }
  ): Promise<{
    chainId: string;
    pdfDownloadJobId: Id<"jobs">;
    ragIndexingJobId: Id<"jobs">;
    extractionJobId: Id<"jobs">;
    totalItems: { pdfDownload: number; ragIndexing: number; extraction: number };
  }> => {
    // Get current user for extraction credits
    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Generate chain ID
    const chainId = `chain_${analysisId}_${Date.now()}`;

    // ═══════════════════════════════════════════════════════════════
    // Step 1: Get items for all job types
    // ═══════════════════════════════════════════════════════════════

    // PDF download items
    const pdfDocs = await ctx.runQuery(internal.rag.queries.getDocumentsWithOpenAccessUrls, {
      analysisId,
      limit: 500,
    });
    const pdfItems = pdfDocs
      .filter(
        (doc: { _id: Id<"documents">; fullText?: string; pdfStorageId?: Id<"_storage"> }) =>
          !doc.fullText && !doc.pdfStorageId
      )
      .map((doc: { _id: Id<"documents"> }) => ({
        type: "pdf_download" as const,
        documentId: doc._id,
      }));

    // RAG indexing items (will index after PDFs are downloaded)
    const indexDocs = await ctx.runQuery(internal.rag.queries.getUnindexedDocuments, {
      analysisId,
    });
    const indexItems = indexDocs
      .filter(
        (doc: { abstract?: string; hasFullText?: boolean }) =>
          doc.abstract || doc.hasFullText
      )
      .map((doc: { _id: Id<"documents"> }) => ({
        type: "rag_indexing" as const,
        documentId: doc._id,
      }));

    // Extraction items
    await ctx.runMutation(internal.extraction.results.cleanupIncompleteResults, {
      analysisId,
    });
    const extractionPending = await ctx.runQuery(
      internal.extraction.internal.getPendingExtractionItems,
      { analysisId }
    );
    const extractionItems = extractionPending.map(
      (item: { documentId: Id<"documents">; questionId: string }) => ({
        type: "extraction" as const,
        documentId: item.documentId,
        questionId: item.questionId,
      })
    );

    // ═══════════════════════════════════════════════════════════════
    // Step 2: Create chained jobs
    // ═══════════════════════════════════════════════════════════════

    const pdfDefaults = JOB_DEFAULTS.pdf_download;
    const indexDefaults = JOB_DEFAULTS.rag_indexing;
    const extractDefaults = JOB_DEFAULTS.extraction;

    // Job 1: PDF Download (starts immediately)
    const pdfDownloadJobId = await ctx.runMutation(internal.jobs.mutations.createJob, {
      type: "pdf_download",
      analysisId,
      items: pdfItems,
      concurrencyLimit: pdfDefaults.concurrencyLimit,
      itemTimeoutMs: pdfDefaults.itemTimeoutMs,
      jobTimeoutMs: pdfDefaults.jobTimeoutMs,
      maxAttempts: pdfDefaults.maxAttempts,
      chainId,
      chainPosition: 0,
    });

    // Job 2: RAG Indexing (waits for PDF download)
    const ragIndexingJobId = await ctx.runMutation(internal.jobs.mutations.createJob, {
      type: "rag_indexing",
      analysisId,
      items: indexItems,
      concurrencyLimit: indexDefaults.concurrencyLimit,
      itemTimeoutMs: indexDefaults.itemTimeoutMs,
      jobTimeoutMs: indexDefaults.jobTimeoutMs,
      maxAttempts: indexDefaults.maxAttempts,
      dependsOn: pdfDownloadJobId,
      chainId,
      chainPosition: 1,
    });

    // Job 3: Extraction (waits for RAG indexing)
    const extractionJobId = await ctx.runMutation(internal.jobs.mutations.createJob, {
      type: "extraction",
      analysisId,
      userId: user._id,
      items: extractionItems,
      concurrencyLimit: extractDefaults.concurrencyLimit,
      itemTimeoutMs: extractDefaults.itemTimeoutMs,
      jobTimeoutMs: extractDefaults.jobTimeoutMs,
      maxAttempts: extractDefaults.maxAttempts,
      dependsOn: ragIndexingJobId,
      chainId,
      chainPosition: 2,
    });

    // Update analysis status
    await ctx.runMutation(internal.extraction.analysesMutations.setStatus, {
      id: analysisId,
      status: "processing",
    });

    console.log(
      `[Jobs] Started full pipeline chain ${chainId}: ` +
        `PDF(${pdfItems.length}) -> Index(${indexItems.length}) -> Extract(${extractionItems.length})`
    );

    return {
      chainId,
      pdfDownloadJobId,
      ragIndexingJobId,
      extractionJobId,
      totalItems: {
        pdfDownload: pdfItems.length,
        ragIndexing: indexItems.length,
        extraction: extractionItems.length,
      },
    };
  },
});
