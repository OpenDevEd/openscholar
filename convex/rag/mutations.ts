/**
 * RAG internal mutations - for use by actions only.
 */
import { internalMutation, mutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Generate a short-lived upload URL for PDF files.
 */
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Update document processing status.
 */
export const updateDocumentStatus = internalMutation({
  args: {
    documentId: v.id("documents"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("error")
    ),
  },
  returns: v.null(),
  handler: async (ctx, { documentId, status }) => {
    await ctx.db.patch(documentId, { processingStatus: status });
    return null;
  },
});

/**
 * Save extracted full text to document.
 */
export const saveFullText = internalMutation({
  args: {
    documentId: v.id("documents"),
    fullText: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { documentId, fullText }) => {
    await ctx.db.patch(documentId, { fullText });
    return null;
  },
});

/**
 * Set the RAG entry ID after indexing.
 */
export const setRagEntryId = internalMutation({
  args: {
    documentId: v.id("documents"),
    ragEntryId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { documentId, ragEntryId }) => {
    await ctx.db.patch(documentId, {
      ragEntryId,
      ragIndexedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Save PDF storage ID to document.
 */
export const savePdfStorageId = internalMutation({
  args: {
    documentId: v.id("documents"),
    pdfStorageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, { documentId, pdfStorageId }) => {
    await ctx.db.patch(documentId, { pdfStorageId });
    return null;
  },
});

/**
 * Create a source for PDF uploads.
 */
export const createPdfSource = internalMutation({
  args: {
    analysisId: v.id("analyses"),
    name: v.string(),
    fileCount: v.number(),
  },
  returns: v.id("analysisSources"),
  handler: async (ctx, { analysisId, name, fileCount }) => {
    const now = Date.now();
    return await ctx.db.insert("analysisSources", {
      analysisId,
      sourceType: "upload",
      sourceRef: `pdf-upload-${now}`,
      status: "importing",
      sourceMeta: {
        name,
        count: fileCount,
      },
      createdAt: now,
    });
  },
});

/**
 * Create a document from an uploaded PDF.
 */
export const createDocumentFromPdf = internalMutation({
  args: {
    analysisId: v.id("analyses"),
    sourceId: v.id("analysisSources"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    title: v.string(),
    abstract: v.optional(v.string()),
    authors: v.optional(v.array(v.string())),
    year: v.optional(v.number()),
    fullText: v.string(),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("documents", {
      analysisId: args.analysisId,
      sourceId: args.sourceId,
      externalId: `pdf-${args.storageId}`,
      title: args.title,
      abstract: args.abstract,
      authors: args.authors,
      year: args.year,
      fullText: args.fullText,
      pdfStorageId: args.storageId,
      processingStatus: "ready",
      createdAt: now,
    });
  },
});

/**
 * Update source status after processing.
 */
export const updateSourceStatus = internalMutation({
  args: {
    sourceId: v.id("analysisSources"),
    status: v.union(
      v.literal("pending"),
      v.literal("importing"),
      v.literal("ready"),
      v.literal("error")
    ),
    documentCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { sourceId, status, documentCount }) => {
    const updates: any = { status };
    if (documentCount !== undefined) {
      updates.documentCount = documentCount;
    }
    await ctx.db.patch(sourceId, updates);
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════
// PDF Download Job Management
// ═══════════════════════════════════════════════════════════════

/**
 * Create a new PDF download job.
 */
export const createPdfDownloadJob = internalMutation({
  args: {
    analysisId: v.id("analyses"),
    totalDocuments: v.number(),
    concurrencyLimit: v.number(),
  },
  returns: v.id("pdfDownloadJobs"),
  handler: async (ctx, { analysisId, totalDocuments, concurrencyLimit }) => {
    return await ctx.db.insert("pdfDownloadJobs", {
      analysisId,
      status: "pending",
      totalDocuments,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      concurrencyLimit,
      activeWorkers: 0,
      nextIndex: 0,
      errors: [],
      startedAt: Date.now(),
    });
  },
});

/**
 * Update job status to running.
 */
export const startPdfDownloadJob = internalMutation({
  args: {
    jobId: v.id("pdfDownloadJobs"),
    currentDocumentId: v.optional(v.id("documents")),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, currentDocumentId }) => {
    await ctx.db.patch(jobId, {
      status: "running",
      currentDocumentId,
    });
    return null;
  },
});

/**
 * Record result of processing a single PDF.
 */
export const recordPdfProcessingResult = internalMutation({
  args: {
    jobId: v.id("pdfDownloadJobs"),
    success: v.boolean(),
    error: v.optional(v.string()),
  },
  returns: v.object({
    processed: v.number(),
    total: v.number(),
    isComplete: v.boolean(),
  }),
  handler: async (ctx, { jobId, success, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");

    const newProcessed = job.processed + 1;
    const newSuccess = success ? job.success + 1 : job.success;
    const newFailed = success ? job.failed : job.failed + 1;
    const errors = error ? [...job.errors.slice(-49), error] : job.errors; // Keep last 50 errors
    const isComplete = newProcessed >= job.totalDocuments;

    await ctx.db.patch(jobId, {
      processed: newProcessed,
      success: newSuccess,
      failed: newFailed,
      errors,
      status: isComplete ? "completed" : "running",
      completedAt: isComplete ? Date.now() : undefined,
      currentDocumentId: isComplete ? undefined : job.currentDocumentId,
    });

    return {
      processed: newProcessed,
      total: job.totalDocuments,
      isComplete,
    };
  },
});

/**
 * Mark job as failed.
 */
export const failPdfDownloadJob = internalMutation({
  args: {
    jobId: v.id("pdfDownloadJobs"),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;

    await ctx.db.patch(jobId, {
      status: "failed",
      errors: [...job.errors, error],
      completedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Claim a worker slot for parallel processing.
 * Returns the index to process, or null if job is complete/at capacity.
 */
export const claimWorkerSlot = internalMutation({
  args: {
    jobId: v.id("pdfDownloadJobs"),
  },
  returns: v.union(
    v.null(),
    v.object({
      index: v.number(),
      canContinue: v.boolean(),
    })
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;

    // Job already complete or failed
    if (job.status === "completed" || job.status === "failed") {
      return null;
    }

    const activeWorkers = job.activeWorkers ?? 0;
    const concurrencyLimit = job.concurrencyLimit ?? 10;
    const nextIndex = job.nextIndex ?? 0;

    // Check if at capacity
    if (activeWorkers >= concurrencyLimit) {
      return { index: -1, canContinue: false };
    }

    // Check if all documents assigned
    if (nextIndex >= job.totalDocuments) {
      return null;
    }

    // Claim the slot and increment counters
    const claimedIndex = nextIndex;
    await ctx.db.patch(jobId, {
      status: "running",
      activeWorkers: activeWorkers + 1,
      nextIndex: nextIndex + 1,
    });

    return { index: claimedIndex, canContinue: true };
  },
});

/**
 * Release a worker slot after processing.
 */
export const releaseWorkerSlot = internalMutation({
  args: {
    jobId: v.id("pdfDownloadJobs"),
    success: v.boolean(),
    skipped: v.boolean(),
    error: v.optional(v.string()),
  },
  returns: v.object({
    processed: v.number(),
    total: v.number(),
    isComplete: v.boolean(),
    activeWorkers: v.number(),
  }),
  handler: async (ctx, { jobId, success, skipped, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");

    const currentActiveWorkers = job.activeWorkers ?? 0;
    const currentSkipped = job.skipped ?? 0;
    const nextIndex = job.nextIndex ?? 0;

    const newProcessed = job.processed + 1;
    const newSuccess = success ? job.success + 1 : job.success;
    const newFailed = !success && !skipped ? job.failed + 1 : job.failed;
    const newSkipped = skipped ? currentSkipped + 1 : currentSkipped;
    const newActiveWorkers = Math.max(0, currentActiveWorkers - 1);
    const errors = error ? [...job.errors.slice(-99), error] : job.errors; // Keep last 100 errors
    
    // Complete when all processed OR all assigned and no active workers
    const allAssigned = nextIndex >= job.totalDocuments;
    const isComplete = newProcessed >= job.totalDocuments || (allAssigned && newActiveWorkers === 0);

    await ctx.db.patch(jobId, {
      processed: newProcessed,
      success: newSuccess,
      failed: newFailed,
      skipped: newSkipped,
      activeWorkers: newActiveWorkers,
      errors,
      status: isComplete ? "completed" : "running",
      completedAt: isComplete ? Date.now() : undefined,
    });

    return {
      processed: newProcessed,
      total: job.totalDocuments,
      isComplete,
      activeWorkers: newActiveWorkers,
    };
  },
});
