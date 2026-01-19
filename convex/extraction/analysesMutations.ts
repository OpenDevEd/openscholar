/**
 * Analysis mutations
 */
import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { extractionQuestionValidator } from "./validators";

export const create = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.id("analyses"),
  handler: async (ctx, { userId, name, description }) => {
    const now = Date.now();
    return await ctx.db.insert("analyses", {
      userId,
      name,
      description,
      status: "draft",
      extractionQuestions: [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("analyses"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, name, description }) => {
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    await ctx.db.patch(id, updates);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("analyses") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    // Delete all related data
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

    // Parallel deletes
    await Promise.all([
      ...sources.map((s) => ctx.db.delete(s._id)),
      ...documents.map((d) => ctx.db.delete(d._id)),
      ...results.map((r) => ctx.db.delete(r._id)),
    ]);

    await ctx.db.delete(id);
    return null;
  },
});

export const addQuestion = mutation({
  args: {
    analysisId: v.id("analyses"),
    question: v.string(),
    type: v.union(v.literal("text"), v.literal("number"), v.literal("boolean")),
  },
  returns: v.string(),
  handler: async (ctx, { analysisId, question, type }) => {
    const analysis = await ctx.db.get(analysisId);
    if (!analysis) throw new Error("Analysis not found");

    const id = crypto.randomUUID();
    const key = question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .slice(0, 32);

    const newQuestion = { id, key, question, type };
    await ctx.db.patch(analysisId, {
      extractionQuestions: [...analysis.extractionQuestions, newQuestion],
      updatedAt: Date.now(),
    });

    return id;
  },
});

export const updateQuestion = mutation({
  args: {
    analysisId: v.id("analyses"),
    questionId: v.string(),
    question: v.optional(v.string()),
    type: v.optional(
      v.union(v.literal("text"), v.literal("number"), v.literal("boolean"))
    ),
  },
  returns: v.null(),
  handler: async (ctx, { analysisId, questionId, question, type }) => {
    const analysis = await ctx.db.get(analysisId);
    if (!analysis) throw new Error("Analysis not found");

    const updated = analysis.extractionQuestions.map((q) => {
      if (q.id !== questionId) return q;
      return {
        ...q,
        question: question ?? q.question,
        type: type ?? q.type,
        key:
          question !== undefined
            ? question
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .slice(0, 32)
            : q.key,
      };
    });

    await ctx.db.patch(analysisId, {
      extractionQuestions: updated,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const removeQuestion = mutation({
  args: {
    analysisId: v.id("analyses"),
    questionId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { analysisId, questionId }) => {
    const analysis = await ctx.db.get(analysisId);
    if (!analysis) throw new Error("Analysis not found");

    await ctx.db.patch(analysisId, {
      extractionQuestions: analysis.extractionQuestions.filter(
        (q) => q.id !== questionId
      ),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const setStatus = internalMutation({
  args: {
    id: v.id("analyses"),
    status: v.union(
      v.literal("draft"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
  },
  returns: v.null(),
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status, updatedAt: Date.now() });
    return null;
  },
});
