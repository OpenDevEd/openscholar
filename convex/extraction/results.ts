/**
 * Extraction results - queries and mutations
 */
import { query, internalMutation } from "../_generated/server";
import { v } from "convex/values";

// Source citation schema (matching schema.ts)
const sourceSchema = v.object({
  quote: v.string(),
  sourceType: v.union(v.literal("abstract"), v.literal("pdf")),
  pageNumber: v.optional(v.number()),
  startChar: v.number(),
  endChar: v.number(),
});

// ═══════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════

export const listByDocument = query({
  args: { documentId: v.id("documents") },
  returns: v.array(
    v.object({
      _id: v.id("extractionResults"),
      questionId: v.string(),
      value: v.union(v.string(), v.number(), v.boolean(), v.null()),
      confidence: v.optional(v.number()),
      reasoning: v.optional(v.string()),
      sources: v.optional(v.array(sourceSchema)),
      status: v.string(),
    })
  ),
  handler: async (ctx, { documentId }) => {
    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect();

    return results.map((r) => ({
      _id: r._id,
      questionId: r.questionId,
      value: r.value,
      confidence: r.confidence,
      reasoning: r.reasoning,
      sources: r.sources,
      status: r.status,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════
// INTERNAL MUTATIONS
// ═══════════════════════════════════════════════════════════════

export const createPending = internalMutation({
  args: {
    documentId: v.id("documents"),
    analysisId: v.id("analyses"),
    questionId: v.string(),
  },
  returns: v.id("extractionResults"),
  handler: async (ctx, { documentId, analysisId, questionId }) => {
    return await ctx.db.insert("extractionResults", {
      documentId,
      analysisId,
      questionId,
      value: null,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const setResult = internalMutation({
  args: {
    resultId: v.id("extractionResults"),
    value: v.union(v.string(), v.number(), v.boolean(), v.null()),
    confidence: v.optional(v.number()),
    reasoning: v.optional(v.string()),
    sources: v.optional(v.array(sourceSchema)),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("error")
    ),
  },
  returns: v.null(),
  handler: async (ctx, { resultId, value, confidence, reasoning, sources, status }) => {
    await ctx.db.patch(resultId, {
      value,
      confidence,
      reasoning,
      sources,
      status,
    });
    return null;
  },
});

export const createBatchPending = internalMutation({
  args: {
    items: v.array(
      v.object({
        documentId: v.id("documents"),
        analysisId: v.id("analyses"),
        questionId: v.string(),
      })
    ),
  },
  returns: v.array(v.id("extractionResults")),
  handler: async (ctx, { items }) => {
    const now = Date.now();
    return await Promise.all(
      items.map((item) =>
        ctx.db.insert("extractionResults", {
          documentId: item.documentId,
          analysisId: item.analysisId,
          questionId: item.questionId,
          value: null,
          status: "pending",
          createdAt: now,
        })
      )
    );
  },
});

/**
 * Delete an extraction result (used for retrying failed extractions).
 */
export const deleteResult = internalMutation({
  args: {
    resultId: v.id("extractionResults"),
  },
  returns: v.null(),
  handler: async (ctx, { resultId }) => {
    await ctx.db.delete(resultId);
    return null;
  },
});

/**
 * Delete all pending and error results for an analysis.
 * Use this to clean up orphaned results from failed extraction runs.
 */
export const cleanupIncompleteResults = internalMutation({
  args: {
    analysisId: v.id("analyses"),
  },
  returns: v.number(),
  handler: async (ctx, { analysisId }) => {
    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .collect();

    let deleted = 0;
    for (const result of results) {
      if (result.status === "pending" || result.status === "error") {
        await ctx.db.delete(result._id);
        deleted++;
      }
    }

    return deleted;
  },
});
