/**
 * Analysis sources - queries and mutations
 */
import { query, mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { documentInputValidator } from "./validators";

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

/**
 * Import documents from search history with paper data.
 * Creates source record + all document records in one transaction.
 */
export const importFromSearchHistory = mutation({
  args: {
    analysisId: v.id("analyses"),
    searchId: v.string(),
    searchQuery: v.optional(v.string()),
    papers: v.array(documentInputValidator),
  },
  returns: v.object({
    sourceId: v.id("analysisSources"),
    documentCount: v.number(),
  }),
  handler: async (ctx, { analysisId, searchId, searchQuery, papers }) => {
    // Check for existing source with same searchId
    const existingSource = await ctx.db
      .query("analysisSources")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .filter((q) => q.eq(q.field("sourceRef"), searchId))
      .first();

    if (existingSource) {
      throw new Error("This search has already been imported to this analysis");
    }

    // Create source record
    const sourceId = await ctx.db.insert("analysisSources", {
      analysisId,
      sourceType: "search_history",
      sourceRef: searchId,
      sourceMeta: {
        query: searchQuery,
        count: papers.length,
      },
      status: "ready",
      documentCount: papers.length,
      createdAt: Date.now(),
    });

    // Create document records
    const now = Date.now();
    await Promise.all(
      papers.map((paper) =>
        ctx.db.insert("documents", {
          analysisId,
          sourceId,
          externalId: paper.externalId,
          title: paper.title,
          abstract: paper.abstract,
          authors: paper.authors,
          year: paper.year,
          doi: paper.doi,
          openAccessUrl: paper.openAccessUrl,
          processingStatus: "ready",
          createdAt: now,
        })
      )
    );

    return {
      sourceId,
      documentCount: papers.length,
    };
  },
});

/**
 * Import documents from CSV/JSON upload.
 */
export const importFromUpload = mutation({
  args: {
    analysisId: v.id("analyses"),
    fileName: v.string(),
    papers: v.array(documentInputValidator),
  },
  returns: v.object({
    sourceId: v.id("analysisSources"),
    documentCount: v.number(),
  }),
  handler: async (ctx, { analysisId, fileName, papers }) => {
    const sourceId = await ctx.db.insert("analysisSources", {
      analysisId,
      sourceType: "upload",
      sourceRef: crypto.randomUUID(),
      sourceMeta: {
        name: fileName,
        count: papers.length,
      },
      status: "ready",
      documentCount: papers.length,
      createdAt: Date.now(),
    });

    const now = Date.now();
    await Promise.all(
      papers.map((paper) =>
        ctx.db.insert("documents", {
          analysisId,
          sourceId,
          externalId: paper.externalId,
          title: paper.title,
          abstract: paper.abstract,
          authors: paper.authors,
          year: paper.year,
          doi: paper.doi,
          processingStatus: "ready",
          createdAt: now,
        })
      )
    );

    return {
      sourceId,
      documentCount: papers.length,
    };
  },
});

/**
 * Create a single manual document.
 */
export const addManualDocument = mutation({
  args: {
    analysisId: v.id("analyses"),
    title: v.string(),
    abstract: v.optional(v.string()),
    authors: v.optional(v.array(v.string())),
    year: v.optional(v.number()),
    doi: v.optional(v.string()),
  },
  returns: v.id("documents"),
  handler: async (ctx, { analysisId, title, abstract, authors, year, doi }) => {
    // Find or create manual source for this analysis
    let manualSource = await ctx.db
      .query("analysisSources")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .filter((q) => q.eq(q.field("sourceType"), "manual"))
      .first();

    if (!manualSource) {
      const sourceId = await ctx.db.insert("analysisSources", {
        analysisId,
        sourceType: "manual",
        sourceRef: "manual",
        sourceMeta: { name: "Manual Entries" },
        status: "ready",
        documentCount: 0,
        createdAt: Date.now(),
      });
      manualSource = await ctx.db.get(sourceId);
    }

    // Create document
    const docId = await ctx.db.insert("documents", {
      analysisId,
      sourceId: manualSource!._id,
      externalId: doi || crypto.randomUUID(),
      title,
      abstract,
      authors,
      year,
      doi,
      processingStatus: "ready",
      createdAt: Date.now(),
    });

    // Update document count
    await ctx.db.patch(manualSource!._id, {
      documentCount: (manualSource!.documentCount || 0) + 1,
    });

    return docId;
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

/**
 * Import documents from Zotero library or collection.
 */
export const importFromZotero = mutation({
  args: {
    analysisId: v.id("analyses"),
    collectionKey: v.optional(v.string()),
    collectionName: v.optional(v.string()),
    groupId: v.optional(v.string()),
    groupName: v.optional(v.string()),
    items: v.array(
      v.object({
        key: v.string(),
        title: v.string(),
        abstract: v.optional(v.string()),
        authors: v.array(v.string()),
        year: v.optional(v.number()),
        doi: v.optional(v.string()),
      })
    ),
  },
  returns: v.object({
    sourceId: v.id("analysisSources"),
    documentCount: v.number(),
  }),
  handler: async (ctx, { analysisId, collectionKey, collectionName, groupId, groupName, items }) => {
    // Create a descriptive source reference
    const sourceRef = groupId
      ? `zotero:group:${groupId}${collectionKey ? `:${collectionKey}` : ""}`
      : `zotero:library${collectionKey ? `:${collectionKey}` : ""}`;

    // Check for existing source with same reference
    const existingSource = await ctx.db
      .query("analysisSources")
      .withIndex("by_analysis", (q) => q.eq("analysisId", analysisId))
      .filter((q) => q.eq(q.field("sourceRef"), sourceRef))
      .first();

    if (existingSource) {
      throw new Error("This Zotero collection has already been imported to this analysis");
    }

    // Build descriptive name
    let sourceName = "Zotero Library";
    if (groupName) {
      sourceName = `Zotero: ${groupName}`;
    }
    if (collectionName) {
      sourceName = groupName
        ? `${sourceName} / ${collectionName}`
        : `Zotero: ${collectionName}`;
    }

    // Create source record
    const sourceId = await ctx.db.insert("analysisSources", {
      analysisId,
      sourceType: "zotero",
      sourceRef,
      sourceMeta: {
        name: sourceName,
        count: items.length,
      },
      status: "ready",
      documentCount: items.length,
      createdAt: Date.now(),
    });

    // Create document records
    const now = Date.now();
    await Promise.all(
      items.map((item) =>
        ctx.db.insert("documents", {
          analysisId,
          sourceId,
          externalId: item.key,
          title: item.title,
          abstract: item.abstract,
          authors: item.authors,
          year: item.year,
          doi: item.doi,
          processingStatus: "ready",
          createdAt: now,
        })
      )
    );

    return {
      sourceId,
      documentCount: items.length,
    };
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
