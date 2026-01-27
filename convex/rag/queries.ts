/**
 * RAG internal queries - for use by actions only.
 */
import { internalQuery, query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Get a document for RAG processing (includes fullText - use sparingly).
 * Prefer getDocumentMetadata for searches/lookups to avoid memory bloat.
 */
export const getDocument = internalQuery({
  args: { documentId: v.id("documents") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("documents"),
      analysisId: v.id("analyses"),
      externalId: v.string(),
      title: v.string(),
      abstract: v.optional(v.string()),
      fullText: v.optional(v.string()),
      pdfPages: v.optional(
        v.array(
          v.object({
            pageNumber: v.number(),
            startChar: v.number(),
            endChar: v.number(),
          })
        )
      ),
      authors: v.optional(v.array(v.string())),
      year: v.optional(v.number()),
      ragEntryId: v.optional(v.string()),
      ragIndexedAt: v.optional(v.number()),
      processingStatus: v.string(),
      openAccessUrl: v.optional(v.string()),
      pdfStorageId: v.optional(v.id("_storage")),
    })
  ),
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc) return null;

    return {
      _id: doc._id,
      analysisId: doc.analysisId,
      externalId: doc.externalId,
      title: doc.title,
      abstract: doc.abstract,
      fullText: doc.fullText,
      pdfPages: doc.pdfPages,
      authors: doc.authors,
      year: doc.year,
      ragEntryId: doc.ragEntryId,
      ragIndexedAt: doc.ragIndexedAt,
      processingStatus: doc.processingStatus,
      openAccessUrl: doc.openAccessUrl,
      pdfStorageId: doc.pdfStorageId,
    };
  },
});

/**
 * Get document metadata WITHOUT fullText - use this for searches/lookups.
 * This prevents loading 100KB-500KB fullText into memory for each document.
 */
export const getDocumentMetadata = internalQuery({
  args: { documentId: v.id("documents") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("documents"),
      analysisId: v.id("analyses"),
      title: v.string(),
      abstract: v.optional(v.string()),
      pdfPages: v.optional(
        v.array(
          v.object({
            pageNumber: v.number(),
            startChar: v.number(),
            endChar: v.number(),
          })
        )
      ),
      authors: v.optional(v.array(v.string())),
      year: v.optional(v.number()),
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
      pdfPages: doc.pdfPages,
      authors: doc.authors,
      year: doc.year,
      // NO fullText - this is intentional to prevent memory bloat
    };
  },
});

/**
 * Get documents in an analysis that haven't been indexed yet.
 * NOTE: Does NOT return fullText to prevent memory bloat when listing many docs.
 * Uses hasFullText boolean flag instead.
 */
export const getUnindexedDocuments = internalQuery({
  args: { analysisId: v.id("analyses") },
  returns: v.array(
    v.object({
      _id: v.id("documents"),
      analysisId: v.id("analyses"),
      title: v.string(),
      abstract: v.optional(v.string()),
      hasFullText: v.boolean(), // Flag instead of actual content
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
        hasFullText: !!doc.fullText, // Boolean flag instead of 200KB string
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

/**
 * Debug: Get document statistics for an analysis.
 */
export const getDocumentStats = query({
  args: { analysisId: v.id("analyses") },
  returns: v.object({
    total: v.number(),
    withAbstract: v.number(),
    withFullText: v.number(),
    withPdfStorageId: v.number(),
    withRagEntryId: v.number(),
    eligibleForIndexing: v.number(),
  }),
  handler: async (ctx, { analysisId }) => {
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .collect();

    return {
      total: docs.length,
      withAbstract: docs.filter((d) => d.abstract && d.abstract.length > 0).length,
      withFullText: docs.filter((d) => d.fullText && d.fullText.length > 0).length,
      withPdfStorageId: docs.filter((d) => d.pdfStorageId).length,
      withRagEntryId: docs.filter((d) => d.ragEntryId).length,
      eligibleForIndexing: docs.filter((d) => !d.ragEntryId && (d.abstract || d.fullText)).length,
    };
  },
});


