/**
 * RAG internal queries - for use by actions only.
 */
import { internalQuery, query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Get a document for RAG processing.
 */
export const getDocument = internalQuery({
  args: { documentId: v.id("documents") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("documents"),
      analysisId: v.id("analyses"),
      title: v.string(),
      abstract: v.optional(v.string()),
      fullText: v.optional(v.string()),
      authors: v.optional(v.array(v.string())),
      year: v.optional(v.number()),
      ragEntryId: v.optional(v.string()),
      ragIndexedAt: v.optional(v.number()),
      processingStatus: v.string(),
    })
  ),
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc) return null;

    return {
      _id: doc._id,
      analysisId: doc.analysisId,
      title: doc.title,
      abstract: doc.abstract,
      fullText: doc.fullText,
      authors: doc.authors,
      year: doc.year,
      ragEntryId: doc.ragEntryId,
      ragIndexedAt: doc.ragIndexedAt,
      processingStatus: doc.processingStatus,
    };
  },
});

/**
 * Get documents in an analysis that haven't been indexed yet.
 */
export const getUnindexedDocuments = internalQuery({
  args: { analysisId: v.id("analyses") },
  returns: v.array(
    v.object({
      _id: v.id("documents"),
      analysisId: v.id("analyses"),
      title: v.string(),
      abstract: v.optional(v.string()),
      fullText: v.optional(v.string()),
      authors: v.optional(v.array(v.string())),
      year: v.optional(v.number()),
    })
  ),
  handler: async (ctx, { analysisId }) => {
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .collect();

    // Filter to unindexed documents with content
    return docs
      .filter((doc) => !doc.ragEntryId && (doc.abstract || doc.fullText))
      .map((doc) => ({
        _id: doc._id,
        analysisId: doc.analysisId,
        title: doc.title,
        abstract: doc.abstract,
        fullText: doc.fullText,
        authors: doc.authors,
        year: doc.year,
      }));
  },
});

/**
 * Get documents that have open access URLs but haven't been processed yet.
 */
export const getDocumentsWithOpenAccessUrls = internalQuery({
  args: { 
    analysisId: v.id("analyses"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("documents"),
      analysisId: v.id("analyses"),
      title: v.string(),
      abstract: v.optional(v.string()),
      openAccessUrl: v.optional(v.string()),
      authors: v.optional(v.array(v.string())),
      year: v.optional(v.number()),
    })
  ),
  handler: async (ctx, { analysisId, limit = 50 }) => {
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .collect();

    // Filter to documents with open access URLs that don't have full text yet
    return docs
      .filter((doc) => doc.openAccessUrl && !doc.fullText && !doc.pdfStorageId)
      .slice(0, limit)
      .map((doc) => ({
        _id: doc._id,
        analysisId: doc.analysisId,
        title: doc.title,
        abstract: doc.abstract,
        openAccessUrl: doc.openAccessUrl,
        authors: doc.authors,
        year: doc.year,
      }));
  },
});

// ═══════════════════════════════════════════════════════════════
// PDF Download Job Queries
// ═══════════════════════════════════════════════════════════════

/**
 * Get PDF download job status (public query for UI polling).
 */
export const getPdfDownloadJobStatus = query({
  args: { jobId: v.id("pdfDownloadJobs") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("pdfDownloadJobs"),
      status: v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed")
      ),
      totalDocuments: v.number(),
      processed: v.number(),
      success: v.number(),
      failed: v.number(),
      skipped: v.number(),
      errors: v.array(v.string()),
      startedAt: v.number(),
      completedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const skipped: number = job.skipped ?? 0;
    return {
      _id: job._id,
      status: job.status,
      totalDocuments: job.totalDocuments,
      processed: job.processed,
      success: job.success,
      failed: job.failed,
      skipped,
      errors: job.errors,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  },
});

/**
 * Get the latest PDF download job for an analysis (for UI).
 */
export const getLatestPdfDownloadJob = query({
  args: { analysisId: v.id("analyses") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("pdfDownloadJobs"),
      status: v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed")
      ),
      totalDocuments: v.number(),
      processed: v.number(),
      success: v.number(),
      failed: v.number(),
      skipped: v.number(),
      errors: v.array(v.string()),
      startedAt: v.number(),
      completedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, { analysisId }) => {
    const jobs = await ctx.db
      .query("pdfDownloadJobs")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .order("desc")
      .first();
    if (!jobs) return null;
    const skipped: number = jobs.skipped ?? 0;
    return {
      _id: jobs._id,
      status: jobs.status,
      totalDocuments: jobs.totalDocuments,
      processed: jobs.processed,
      success: jobs.success,
      failed: jobs.failed,
      skipped,
      errors: jobs.errors,
      startedAt: jobs.startedAt,
      completedAt: jobs.completedAt,
    };
  },
});

/**
 * Get next document to process for a job (internal).
 */
export const getNextDocumentForJob = internalQuery({
  args: { 
    analysisId: v.id("analyses"),
    offset: v.number(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("documents"),
      analysisId: v.id("analyses"),
      title: v.string(),
      abstract: v.optional(v.string()),
      openAccessUrl: v.optional(v.string()),
      authors: v.optional(v.array(v.string())),
      year: v.optional(v.number()),
    })
  ),
  handler: async (ctx, { analysisId, offset }) => {
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .collect();

    // Filter to documents with open access URLs that don't have full text yet
    const eligibleDocs = docs.filter(
      (doc) => doc.openAccessUrl && !doc.fullText && !doc.pdfStorageId
    );

    const doc = eligibleDocs[offset];
    if (!doc) return null;
    
    return {
      _id: doc._id,
      analysisId: doc.analysisId,
      title: doc.title,
      abstract: doc.abstract,
      openAccessUrl: doc.openAccessUrl,
      authors: doc.authors,
      year: doc.year,
    };
  },
});
