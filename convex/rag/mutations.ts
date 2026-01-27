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
 * Save PDF with page boundaries for citation tracking.
 */
export const savePdfWithPages = internalMutation({
  args: {
    documentId: v.id("documents"),
    pdfStorageId: v.id("_storage"),
    fullText: v.string(),
    pdfPages: v.array(
      v.object({
        pageNumber: v.number(),
        startChar: v.number(),
        endChar: v.number(),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, { documentId, pdfStorageId, fullText, pdfPages }) => {
    await ctx.db.patch(documentId, {
      pdfStorageId,
      fullText,
      pdfPages,
    });
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
// DATA CLEARING - For development/testing only
// ═══════════════════════════════════════════════════════════════

/**
 * NUCLEAR OPTION: Delete ALL analysis data in batches.
 * This clears: analyses, analysisSources, documents, extractionResults,
 * jobs, jobItems, and storage files.
 * Call repeatedly until hasMore is false.
 */
export const nukeAllDataBatch = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.object({
      extractionResults: v.number(),
      documents: v.number(),
      analysisSources: v.number(),
      analyses: v.number(),
      jobs: v.number(),
      jobItems: v.number(),
      storageFiles: v.number(),
    }),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, { batchSize = 50 }) => {
    const deleted = {
      extractionResults: 0,
      documents: 0,
      analysisSources: 0,
      analyses: 0,
      jobs: 0,
      jobItems: 0,
      storageFiles: 0,
    };
    let hasMore = false;

    // 1. Delete extractionResults first (foreign key to documents)
    const results = await ctx.db.query("extractionResults").take(batchSize);
    for (const r of results) {
      await ctx.db.delete(r._id);
      deleted.extractionResults++;
    }
    if (results.length === batchSize) hasMore = true;

    // 2. Delete documents (collect storage IDs first)
    const docs = await ctx.db.query("documents").take(batchSize);
    for (const doc of docs) {
      // Delete associated storage file if exists
      if (doc.pdfStorageId) {
        try {
          await ctx.storage.delete(doc.pdfStorageId);
          deleted.storageFiles++;
        } catch (e) {
          // Storage file might already be deleted
        }
      }
      await ctx.db.delete(doc._id);
      deleted.documents++;
    }
    if (docs.length === batchSize) hasMore = true;

    // 3. Delete analysisSources (foreign key to analyses)
    const sources = await ctx.db.query("analysisSources").take(batchSize);
    for (const s of sources) {
      await ctx.db.delete(s._id);
      deleted.analysisSources++;
    }
    if (sources.length === batchSize) hasMore = true;

    // 4. Delete analyses (only after documents and sources are gone)
    if (deleted.documents === 0 && deleted.analysisSources === 0) {
      const analyses = await ctx.db.query("analyses").take(batchSize);
      for (const a of analyses) {
        await ctx.db.delete(a._id);
        deleted.analyses++;
      }
      if (analyses.length === batchSize) hasMore = true;
    }

    // 5. Delete jobItems first (foreign key to jobs)
    const jobItems = await ctx.db.query("jobItems").take(batchSize);
    for (const ji of jobItems) {
      await ctx.db.delete(ji._id);
      deleted.jobItems++;
    }
    if (jobItems.length === batchSize) hasMore = true;

    // 6. Delete jobs (only after jobItems are gone)
    if (deleted.jobItems === 0) {
      const jobs = await ctx.db.query("jobs").take(batchSize);
      for (const j of jobs) {
        await ctx.db.delete(j._id);
        deleted.jobs++;
      }
      if (jobs.length === batchSize) hasMore = true;
    }

    return { deleted, hasMore };
  },
});

/**
 * Clear extraction-related data in batches for fresh start.
 * Call repeatedly until all data is cleared.
 */
export const clearExtractionDataBatch = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    extractionResults: v.number(),
    jobs: v.number(),
    jobItems: v.number(),
    documentsReset: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, { batchSize = 100 }) => {
    let extractionResults = 0;
    let jobs = 0;
    let jobItems = 0;
    let documentsReset = 0;
    let hasMore = false;

    // Clear extractionResults (batch)
    const results = await ctx.db.query("extractionResults").take(batchSize);
    for (const result of results) {
      await ctx.db.delete(result._id);
      extractionResults++;
    }
    if (results.length === batchSize) hasMore = true;

    // Clear jobItems first (batch)
    const items = await ctx.db.query("jobItems").take(batchSize);
    for (const item of items) {
      await ctx.db.delete(item._id);
      jobItems++;
    }
    if (items.length === batchSize) hasMore = true;

    // Clear jobs (only after jobItems are gone)
    if (jobItems === 0) {
      const jobsList = await ctx.db.query("jobs").take(batchSize);
      for (const job of jobsList) {
        await ctx.db.delete(job._id);
        jobs++;
      }
      if (jobsList.length === batchSize) hasMore = true;
    }

    // Reset document RAG fields (batch) - only those with data
    const docs = await ctx.db.query("documents").take(batchSize * 2);
    for (const doc of docs) {
      if (doc.ragEntryId || doc.ragIndexedAt || doc.fullText || doc.pdfStorageId) {
        await ctx.db.patch(doc._id, {
          ragEntryId: undefined,
          ragIndexedAt: undefined,
          fullText: undefined,
          pdfStorageId: undefined,
        });
        documentsReset++;
        if (documentsReset >= batchSize) {
          hasMore = true;
          break;
        }
      }
    }

    return { extractionResults, jobs, jobItems, documentsReset, hasMore };
  },
});

// ═══════════════════════════════════════════════════════════════
// RAG CLEANUP - Prevent database bloat from replaced entries
// ═══════════════════════════════════════════════════════════════

import { rag } from "./index";

/**
 * Clean up old replaced RAG entries to prevent database bloat.
 * Deletes entries that have been replaced.
 * Call repeatedly with cursor until complete.
 */
export const cleanupOldRagEntries = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    deleted: v.number(),
    hasMore: v.boolean(),
    nextCursor: v.optional(v.string()),
  }),
  handler: async (ctx, { cursor }) => {
    let deleted = 0;

    try {
      const toDelete = await rag.list(ctx, {
        status: "replaced",
        paginationOpts: { cursor: cursor ?? null, numItems: 50 },
      });

      // Delete all replaced entries (they're already replaced, safe to delete)
      for (const entry of toDelete.page) {
        await rag.delete(ctx, { entryId: entry.entryId });
        deleted++;
      }

      return {
        deleted,
        hasMore: !toDelete.isDone,
        nextCursor: toDelete.isDone ? undefined : toDelete.continueCursor,
      };
    } catch (error) {
      console.error("[RAG Cleanup] Error:", error);
      return {
        deleted,
        hasMore: false,
        nextCursor: undefined,
      };
    }
  },
});
