/**
 * Internal extraction queries and mutations - not exposed to clients
 */
import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const getAnalysisForExtraction = internalQuery({
  args: { analysisId: v.id("analyses") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("analyses"),
      extractionQuestions: v.array(
        v.object({
          id: v.string(),
          key: v.string(),
          question: v.string(),
          type: v.string(),
        })
      ),
    })
  ),
  handler: async (ctx, { analysisId }) => {
    const analysis = await ctx.db.get(analysisId);
    if (!analysis) return null;
    return {
      _id: analysis._id,
      extractionQuestions: analysis.extractionQuestions,
    };
  },
});

export const getDocumentsForExtraction = internalQuery({
  args: { analysisId: v.id("analyses") },
  returns: v.array(
    v.object({
      _id: v.id("documents"),
      analysisId: v.id("analyses"),
      title: v.string(),
      abstract: v.optional(v.string()),
    })
  ),
  handler: async (ctx, { analysisId }) => {
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .collect();

    return docs.map((d) => ({
      _id: d._id,
      analysisId: d.analysisId,
      title: d.title,
      abstract: d.abstract,
    }));
  },
});

export const getDocumentForExtraction = internalQuery({
  args: { documentId: v.id("documents") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("documents"),
      analysisId: v.id("analyses"),
      title: v.string(),
      abstract: v.optional(v.string()),
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
    };
  },
});

export const getExistingResults = internalQuery({
  args: { analysisId: v.id("analyses") },
  returns: v.array(
    v.object({
      documentId: v.id("documents"),
      questionId: v.string(),
    })
  ),
  handler: async (ctx, { analysisId }) => {
    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .collect();

    return results.map((r) => ({
      documentId: r.documentId,
      questionId: r.questionId,
    }));
  },
});

/**
 * Get all pending extraction items for an analysis.
 * Returns a flat list of (document, question) pairs that need extraction.
 * Includes items with no result, pending status, OR error status (for retry).
 * IMPORTANT: Must use same filtering logic as getExtractionItemAtIndex!
 */
export const getPendingExtractionItems = internalQuery({
  args: { analysisId: v.id("analyses") },
  returns: v.array(
    v.object({
      documentId: v.id("documents"),
      title: v.string(),
      abstract: v.optional(v.string()),
      questionId: v.string(),
      question: v.string(),
      type: v.string(),
      existingResultId: v.optional(v.id("extractionResults")),
    })
  ),
  handler: async (ctx, { analysisId }) => {
    const analysis = await ctx.db.get(analysisId);
    if (!analysis) return [];

    const docs = await ctx.db
      .query("documents")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .collect();

    const existingResults = await ctx.db
      .query("extractionResults")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .collect();

    // Map of key -> result for quick lookup
    const resultMap = new Map(
      existingResults.map((r) => [`${r.documentId}:${r.questionId}`, r])
    );

    const items: Array<{
      documentId: typeof docs[0]["_id"];
      title: string;
      abstract: string | undefined;
      questionId: string;
      question: string;
      type: string;
      existingResultId?: typeof existingResults[0]["_id"];
    }> = [];

    for (const doc of docs) {
      for (const q of analysis.extractionQuestions) {
        const key = `${doc._id}:${q.id}`;
        const existingResult = resultMap.get(key);
        
        // Include if: no result, OR status is pending/error (not completed)
        // MUST match getExtractionItemAtIndex logic exactly!
        const shouldInclude = !existingResult || 
          existingResult.status === "error" || 
          existingResult.status === "pending";
          
        if (shouldInclude) {
          items.push({
            documentId: doc._id,
            title: doc.title,
            abstract: doc.abstract,
            questionId: q.id,
            question: q.question,
            type: q.type,
            existingResultId: existingResult?._id,
          });
        }
      }
    }

    return items;
  },
});
