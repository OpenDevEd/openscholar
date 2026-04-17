/**
 * Workflow template mutations. Templates are user-owned saved source +
 * question sets that `startExtractionFromTemplate` (jobs.ts) uses to
 * re-launch a job with the same configuration.
 */

import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../../lib/auth";
import { requireFeature } from "../../featureFlags/guard";
import { createError } from "../../lib/errors";
import { MAX_PAPERS_PER_JOB } from "../../lib/queryBounds";
import { assertJobOwnership } from "../access";
import { readJobSources } from "../jobSources";
import {
  assertExtractionInputLimits,
  historyEntryInputValidator,
  manualItemInputValidator,
  questionInputValidator,
  sourceTypeValidator,
  zoteroSelectionInputValidator,
} from "../validators";

export const saveWorkflowTemplateFromJob = mutation({
  args: {
    jobId: v.id("extractionJobs"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.object({ templateId: v.id("extractionWorkflowTemplates") }),
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await requireFeature(ctx, "extraction.templates", user._id);
    const job = await assertJobOwnership(ctx, user._id, args.jobId);

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

    const existing = await ctx.db
      .query("extractionWorkflowTemplates")
      .withIndex("by_user_name", (q) =>
        q.eq("userId", user._id).eq("name", args.name.trim()),
      )
      .first();

    const now = Date.now();
    const { historyEntries, zoteroSelection, manualItems } =
      await readJobSources(ctx, args.jobId, MAX_PAPERS_PER_JOB * 2);
    const templateFields = {
      description: args.description,
      sourceType: job.sourceType,
      sourceHistoryEntries:
        historyEntries.length > 0 ? historyEntries : undefined,
      sourceZoteroSelection: zoteroSelection,
      sourceManualItems: manualItems.length > 0 ? manualItems : undefined,
      questions: questions.map((q) => ({
        key: q.key,
        question: q.question,
        type: q.type,
        description: q.description,
      })),
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(
        "extractionWorkflowTemplates",
        existing._id,
        templateFields,
      );
      return { templateId: existing._id };
    }

    const templateId = await ctx.db.insert("extractionWorkflowTemplates", {
      userId: user._id,
      name: args.name.trim(),
      ...templateFields,
      createdAt: now,
    });
    return { templateId };
  },
});

export const saveWorkflowTemplate = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    sourceType: sourceTypeValidator,
    sourceHistoryEntries: v.optional(v.array(historyEntryInputValidator)),
    sourceZoteroSelection: v.optional(zoteroSelectionInputValidator),
    sourceManualItems: v.optional(v.array(manualItemInputValidator)),
    questions: v.array(questionInputValidator),
  },
  returns: v.object({ templateId: v.id("extractionWorkflowTemplates") }),
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await requireFeature(ctx, "extraction.templates", user._id);

    assertExtractionInputLimits(args);

    const existing = await ctx.db
      .query("extractionWorkflowTemplates")
      .withIndex("by_user_name", (q) =>
        q.eq("userId", user._id).eq("name", args.name.trim()),
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch("extractionWorkflowTemplates", existing._id, {
        description: args.description,
        sourceType: args.sourceType,
        sourceHistoryEntries: args.sourceHistoryEntries,
        sourceZoteroSelection: args.sourceZoteroSelection,
        sourceManualItems: args.sourceManualItems,
        questions: args.questions,
        updatedAt: now,
      });
      return { templateId: existing._id };
    }

    const templateId = await ctx.db.insert("extractionWorkflowTemplates", {
      userId: user._id,
      name: args.name.trim(),
      description: args.description,
      sourceType: args.sourceType,
      sourceHistoryEntries: args.sourceHistoryEntries,
      sourceZoteroSelection: args.sourceZoteroSelection,
      sourceManualItems: args.sourceManualItems,
      questions: args.questions,
      createdAt: now,
      updatedAt: now,
    });
    return { templateId };
  },
});

export const deleteWorkflowTemplate = mutation({
  args: { templateId: v.id("extractionWorkflowTemplates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const template = await ctx.db.get(
      "extractionWorkflowTemplates",
      args.templateId,
    );
    if (!template || template.userId !== user._id) {
      throw createError("NOT_FOUND", "Template not found");
    }

    await ctx.db.delete("extractionWorkflowTemplates", args.templateId);
    return null;
  },
});
