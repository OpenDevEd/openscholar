/**
 * Analysis queries
 */
import { query } from "../_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { userId: v.id("users") },
  returns: v.array(
    v.object({
      _id: v.id("analyses"),
      _creationTime: v.number(),
      userId: v.id("users"),
      name: v.string(),
      description: v.optional(v.string()),
      status: v.string(),
      questionCount: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, { userId }) => {
    const analyses = await ctx.db
      .query("analyses")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    return analyses.map((a) => ({
      _id: a._id,
      _creationTime: a._creationTime,
      userId: a.userId,
      name: a.name,
      description: a.description,
      status: a.status,
      questionCount: a.extractionQuestions.length,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));
  },
});

export const get = query({
  args: { id: v.id("analyses") },
  returns: v.union(
    v.object({
      _id: v.id("analyses"),
      _creationTime: v.number(),
      userId: v.id("users"),
      name: v.string(),
      description: v.optional(v.string()),
      status: v.string(),
      extractionQuestions: v.array(
        v.object({
          id: v.string(),
          key: v.string(),
          question: v.string(),
          type: v.string(),
        })
      ),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, { id }) => {
    const analysis = await ctx.db.get(id);
    if (!analysis) return null;
    return {
      _id: analysis._id,
      _creationTime: analysis._creationTime,
      userId: analysis.userId,
      name: analysis.name,
      description: analysis.description,
      status: analysis.status,
      extractionQuestions: analysis.extractionQuestions,
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
    };
  },
});

export const getWithStats = query({
  args: { id: v.id("analyses") },
  returns: v.union(
    v.object({
      analysis: v.object({
        _id: v.id("analyses"),
        _creationTime: v.number(),
        userId: v.id("users"),
        name: v.string(),
        description: v.optional(v.string()),
        status: v.string(),
        extractionQuestions: v.array(
          v.object({
            id: v.string(),
            key: v.string(),
            question: v.string(),
            type: v.string(),
          })
        ),
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
      sourceCount: v.number(),
      documentCount: v.number(),
      completedExtractions: v.number(),
      totalExtractions: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, { id }) => {
    const analysis = await ctx.db.get(id);
    if (!analysis) return null;

    const sources = await ctx.db
      .query("analysisSources")
      .withIndex("by_analysis", (q) => q.eq("analysisId", id))
      .collect();

    const documents = await ctx.db
      .query("documents")
      .withIndex("by_analysis", (q) => q.eq("analysisId", id))
      .collect();

    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_analysis", (q) => q.eq("analysisId", id))
      .collect();

    const completedExtractions = results.filter(
      (r) => r.status === "completed"
    ).length;
    const totalExtractions =
      documents.length * analysis.extractionQuestions.length;

    return {
      analysis: {
        _id: analysis._id,
        _creationTime: analysis._creationTime,
        userId: analysis.userId,
        name: analysis.name,
        description: analysis.description,
        status: analysis.status,
        extractionQuestions: analysis.extractionQuestions,
        createdAt: analysis.createdAt,
        updatedAt: analysis.updatedAt,
      },
      sourceCount: sources.length,
      documentCount: documents.length,
      completedExtractions,
      totalExtractions,
    };
  },
});
