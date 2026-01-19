/**
 * Analysis sources - queries and mutations
 */
import { query, mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";

// ═══════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════

export const listByAnalysis = query({
  args: { analysisId: v.id("analyses") },
  returns: v.array(
    v.object({
      _id: v.id("analysisSources"),
      _creationTime: v.number(),
      analysisId: v.id("analyses"),
      sourceType: v.string(),
      sourceRef: v.string(),
      sourceMeta: v.union(
        v.object({
          query: v.optional(v.string()),
          count: v.optional(v.number()),
          name: v.optional(v.string()),
        }),
        v.null()
      ),
      status: v.string(),
      errorMessage: v.optional(v.string()),
      documentCount: v.optional(v.number()),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, { analysisId }) => {
    const sources = await ctx.db
      .query("analysisSources")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .collect();

    return sources.map((s) => ({
      _id: s._id,
      _creationTime: s._creationTime,
      analysisId: s.analysisId,
      sourceType: s.sourceType,
      sourceRef: s.sourceRef,
      sourceMeta: s.sourceMeta ?? null,
      status: s.status,
      errorMessage: s.errorMessage,
      documentCount: s.documentCount,
      createdAt: s.createdAt,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════

export const addFromSearchHistory = mutation({
  args: {
    analysisId: v.id("analyses"),
    searchId: v.string(),
    query: v.optional(v.string()),
    paperCount: v.optional(v.number()),
  },
  returns: v.id("analysisSources"),
  handler: async (ctx, { analysisId, searchId, query, paperCount }) => {
    const sourceId = await ctx.db.insert("analysisSources", {
      analysisId,
      sourceType: "search_history",
      sourceRef: searchId,
      sourceMeta: {
        query,
        count: paperCount,
      },
      status: "pending",
      createdAt: Date.now(),
    });

    return sourceId;
  },
});

export const addManual = mutation({
  args: {
    analysisId: v.id("analyses"),
    name: v.string(),
  },
  returns: v.id("analysisSources"),
  handler: async (ctx, { analysisId, name }) => {
    return await ctx.db.insert("analysisSources", {
      analysisId,
      sourceType: "manual",
      sourceRef: crypto.randomUUID(),
      sourceMeta: { name },
      status: "ready",
      documentCount: 0,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { sourceId: v.id("analysisSources") },
  returns: v.null(),
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.db.get(sourceId);
    if (!source) return null;

    // Delete all documents from this source
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect();

    // Delete extraction results for these documents
    await Promise.all(
      documents.map(async (doc) => {
        const results = await ctx.db
          .query("extractionResults")
          .withIndex("by_document", (q) => q.eq("documentId", doc._id))
          .collect();
        await Promise.all(results.map((r) => ctx.db.delete(r._id)));
        await ctx.db.delete(doc._id);
      })
    );

    await ctx.db.delete(sourceId);
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════
// INTERNAL MUTATIONS
// ═══════════════════════════════════════════════════════════════

export const setStatus = internalMutation({
  args: {
    sourceId: v.id("analysisSources"),
    status: v.union(
      v.literal("pending"),
      v.literal("importing"),
      v.literal("ready"),
      v.literal("error")
    ),
    errorMessage: v.optional(v.string()),
    documentCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { sourceId, status, errorMessage, documentCount }) => {
    const updates: Record<string, unknown> = { status };
    if (errorMessage !== undefined) updates.errorMessage = errorMessage;
    if (documentCount !== undefined) updates.documentCount = documentCount;
    await ctx.db.patch(sourceId, updates);
    return null;
  },
});
