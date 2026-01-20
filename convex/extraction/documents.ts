/**
 * Documents - queries and mutations
 */
import { query, mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { documentInputValidator } from "./validators";

// ═══════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════

export const listByAnalysis = query({
  args: {
    analysisId: v.id("analyses"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("documents"),
      _creationTime: v.number(),
      externalId: v.string(),
      title: v.string(),
      abstract: v.optional(v.string()),
      authors: v.optional(v.array(v.string())),
      year: v.optional(v.number()),
      doi: v.optional(v.string()),
      processingStatus: v.string(),
      openAccessUrl: v.optional(v.string()),
      // RAG fields
      pdfStorageId: v.optional(v.id("_storage")),
      ragEntryId: v.optional(v.string()),
      ragIndexedAt: v.optional(v.number()),
      fullText: v.optional(v.string()),
    })
  ),
  handler: async (ctx, { analysisId, limit }) => {
    let q = ctx.db
      .query("documents")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .order("desc");

    const docs = limit ? await q.take(limit) : await q.collect();

    return docs.map((d) => ({
      _id: d._id,
      _creationTime: d._creationTime,
      externalId: d.externalId,
      title: d.title,
      abstract: d.abstract,
      authors: d.authors,
      year: d.year,
      doi: d.doi,
      processingStatus: d.processingStatus,
      openAccessUrl: d.openAccessUrl,
      // RAG fields
      pdfStorageId: d.pdfStorageId,
      ragEntryId: d.ragEntryId,
      ragIndexedAt: d.ragIndexedAt,
      fullText: d.fullText ? d.fullText.substring(0, 200) + "..." : undefined, // truncate for list view
    }));
  },
});

export const getExtractionTable = query({
  args: { analysisId: v.id("analyses") },
  returns: v.object({
    questions: v.array(
      v.object({
        id: v.string(),
        key: v.string(),
        question: v.string(),
        type: v.string(),
      })
    ),
    rows: v.array(
      v.object({
        documentId: v.id("documents"),
        title: v.string(),
        authors: v.optional(v.array(v.string())),
        year: v.optional(v.number()),
        extractions: v.record(
          v.string(),
          v.object({
            value: v.union(v.string(), v.number(), v.boolean(), v.null()),
            status: v.string(),
            confidence: v.optional(v.number()),
          })
        ),
      })
    ),
  }),
  handler: async (ctx, { analysisId }) => {
    const analysis = await ctx.db.get(analysisId);
    if (!analysis) return { questions: [], rows: [] };

    const documents = await ctx.db
      .query("documents")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .collect();

    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .collect();

    // Group results by document
    const resultsByDoc = new Map<string, typeof results>();
    for (const r of results) {
      const docId = r.documentId as string;
      if (!resultsByDoc.has(docId)) resultsByDoc.set(docId, []);
      resultsByDoc.get(docId)!.push(r);
    }

    const rows = documents.map((doc) => {
      const docResults = resultsByDoc.get(doc._id as string) || [];
      const extractions: Record<
        string,
        {
          value: string | number | boolean | null;
          status: string;
          confidence?: number;
        }
      > = {};

      for (const q of analysis.extractionQuestions) {
        const result = docResults.find((r) => r.questionId === q.id);
        extractions[q.id] = result
          ? {
              value: result.value,
              status: result.status,
              confidence: result.confidence,
            }
          : { value: null, status: "pending" };
      }

      return {
        documentId: doc._id,
        title: doc.title,
        authors: doc.authors,
        year: doc.year,
        extractions,
      };
    });

    return {
      questions: analysis.extractionQuestions,
      rows,
    };
  },
});

// ═══════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════

export const createBatch = internalMutation({
  args: {
    analysisId: v.id("analyses"),
    sourceId: v.id("analysisSources"),
    documents: v.array(documentInputValidator),
  },
  returns: v.array(v.id("documents")),
  handler: async (ctx, { analysisId, sourceId, documents }) => {
    const now = Date.now();
    const ids = await Promise.all(
      documents.map((doc) =>
        ctx.db.insert("documents", {
          analysisId,
          sourceId,
          externalId: doc.externalId,
          title: doc.title,
          abstract: doc.abstract,
          authors: doc.authors,
          year: doc.year,
          doi: doc.doi,
          processingStatus: "ready", // For Phase 1, no PDF processing
          createdAt: now,
        })
      )
    );
    return ids;
  },
});

export const setProcessingStatus = internalMutation({
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
 * Get full export data for an analysis.
 */
export const getExportData = query({
  args: { analysisId: v.id("analyses") },
  returns: v.object({
    analysis: v.object({
      name: v.string(),
      description: v.optional(v.string()),
      createdAt: v.number(),
    }),
    questions: v.array(
      v.object({
        id: v.string(),
        key: v.string(),
        question: v.string(),
        type: v.string(),
      })
    ),
    documents: v.array(
      v.object({
        externalId: v.string(),
        title: v.string(),
        abstract: v.optional(v.string()),
        authors: v.optional(v.array(v.string())),
        year: v.optional(v.number()),
        doi: v.optional(v.string()),
        extractions: v.record(
          v.string(),
          v.object({
            value: v.union(v.string(), v.number(), v.boolean(), v.null()),
            confidence: v.optional(v.number()),
            reasoning: v.optional(v.string()),
          })
        ),
      })
    ),
  }),
  handler: async (ctx, { analysisId }) => {
    const analysis = await ctx.db.get(analysisId);
    if (!analysis) {
      return {
        analysis: { name: "", createdAt: 0 },
        questions: [],
        documents: [],
      };
    }

    const documents = await ctx.db
      .query("documents")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .collect();

    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .collect();

    // Group results by document
    const resultsByDoc = new Map<string, typeof results>();
    for (const r of results) {
      const docId = r.documentId as string;
      if (!resultsByDoc.has(docId)) resultsByDoc.set(docId, []);
      resultsByDoc.get(docId)!.push(r);
    }

    const exportDocs = documents.map((doc) => {
      const docResults = resultsByDoc.get(doc._id as string) || [];
      const extractions: Record<
        string,
        {
          value: string | number | boolean | null;
          confidence?: number;
          reasoning?: string;
        }
      > = {};

      for (const q of analysis.extractionQuestions) {
        const result = docResults.find((r) => r.questionId === q.id);
        if (result && result.status === "completed") {
          extractions[q.key] = {
            value: result.value,
            confidence: result.confidence,
            reasoning: result.reasoning,
          };
        }
      }

      return {
        externalId: doc.externalId,
        title: doc.title,
        abstract: doc.abstract,
        authors: doc.authors,
        year: doc.year,
        doi: doc.doi,
        extractions,
      };
    });

    return {
      analysis: {
        name: analysis.name,
        description: analysis.description,
        createdAt: analysis.createdAt,
      },
      questions: analysis.extractionQuestions,
      documents: exportDocs,
    };
  },
});
