/**
 * Extraction results - queries and mutations
 */
import { query, internalMutation } from "../_generated/server";
import { v } from "convex/values";

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
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("error")
    ),
  },
  returns: v.null(),
  handler: async (ctx, { resultId, value, confidence, reasoning, status }) => {
    await ctx.db.patch(resultId, {
      value,
      confidence,
      reasoning,
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
