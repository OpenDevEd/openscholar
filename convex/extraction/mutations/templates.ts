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
import { PAPER_LIMIT_MAX, assertBucketWithinLimits } from "../bucket/limits";
import { assertJobOwnership } from "../access";
import { readJobSources, type BucketItemInput } from "../jobSources";
import {
  bucketItemInputValidator,
  questionInputValidator,
  sourceTypeValidator,
  MAX_QUESTIONS_PER_JOB,
  MAX_QUESTION_TEXT_LENGTH,
} from "../validators";

function deriveSourceType(
  items: ReadonlyArray<BucketItemInput>,
): "history" | "zotero" | "manual" | "mixed" {
  const kinds = new Set<"history" | "zotero" | "manual">();
  for (const item of items) {
    if (item.source === "history") kinds.add("history");
    else if (item.source === "zotero") kinds.add("zotero");
    else kinds.add("manual");
  }
  if (kinds.size >= 2) return "mixed";
  if (kinds.has("history")) return "history";
  if (kinds.has("zotero")) return "zotero";
  return "manual";
}

function assertQuestionLimits(
  questions: ReadonlyArray<{ question: string }>,
): void {
  if (questions.length > MAX_QUESTIONS_PER_JOB) {
    throw createError(
      "VALIDATION_ERROR",
      `questions exceeds maximum of ${MAX_QUESTIONS_PER_JOB}`,
    );
  }
  for (const q of questions) {
    if (q.question.length > MAX_QUESTION_TEXT_LENGTH) {
      throw createError(
        "VALIDATION_ERROR",
        `question text exceeds maximum length of ${MAX_QUESTION_TEXT_LENGTH}`,
      );
    }
  }
}

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
    const bucketItems = await readJobSources(
      ctx,
      args.jobId,
      PAPER_LIMIT_MAX * 2,
    );
    await assertBucketWithinLimits(ctx, user._id, bucketItems);
    if (!job.sourceType) {
      throw createError(
        "VALIDATION_ERROR",
        "Job is missing sourceType and cannot be saved as a template",
      );
    }
    const templateFields = {
      description: args.description,
      sourceType: job.sourceType,
      bucketItems,
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
    bucketItems: v.array(bucketItemInputValidator),
    questions: v.array(questionInputValidator),
  },
  returns: v.object({ templateId: v.id("extractionWorkflowTemplates") }),
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await requireFeature(ctx, "extraction.templates", user._id);

    await assertBucketWithinLimits(ctx, user._id, args.bucketItems);
    assertQuestionLimits(args.questions);

    // Guard against sourceType drift from the bucket contents. Server
    // recomputes and trusts its own derivation.
    const derivedSourceType = deriveSourceType(args.bucketItems);

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
        sourceType: derivedSourceType,
        bucketItems: args.bucketItems,
        questions: args.questions,
        updatedAt: now,
      });
      return { templateId: existing._id };
    }

    const templateId = await ctx.db.insert("extractionWorkflowTemplates", {
      userId: user._id,
      name: args.name.trim(),
      description: args.description,
      sourceType: derivedSourceType,
      bucketItems: args.bucketItems,
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
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await requireFeature(ctx, "extraction.templates", user._id);

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
