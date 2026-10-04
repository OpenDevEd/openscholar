"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import {
  getEnhanceQueryConfig,
  getScreeningQuestionsConfig,
  getExtractionQuestionsConfig,
  getTranslateQueryConfig,
  getTranslatePaperContentConfig,
  getScreeningResponsesConfig,
} from "../../lib/ai/core/configs";
import {
  processScreeningBatch,
  processTranslationBatch,
  aggregateUsage,
} from "../../lib/ai/core";
import {
  createAIAction,
  withAuthAndCreditsBatch,
} from "./helpers";
import { encodeQuestionResponseMap } from "../../lib/ai/core/question-key-codec";
import { toExtractionQuestions } from "../../lib/ai/core/schemas";
import { truncateForTracking, type AITrackingEntry } from "../../lib/posthog-ai-shared";
import { ESTIMATED_CREDITS_PER_PAPER } from "../lib/constants";
import { internal } from "../_generated/api";
import { BATCH_LOCK_TTL_MS } from "../lib/locks";
import { createError } from "../lib/errors";
import { searchTaskValidator } from "../aiModelConfig/validators";
import { MAX_BATCH_PAPERS, MAX_QUESTIONS } from "../lib/listCaps";
import { batchScreeningValidator, batchTranslationsValidator } from "./validators";

export const enhanceSearchQuery = createAIAction(
  {
    query: v.string(),
    language: v.optional(v.string()),
    syntax: v.optional(v.literal("oql")),
    /** Which search task this is; each can run on its own model. */
    task: v.optional(searchTaskValidator),
  },
  v.object({
    enhancedQuery: v.string(),
    explanation: v.string(),
  }),
  "Enhance search query",
  getEnhanceQueryConfig,
  (output) => ({
    enhancedQuery: output.enhancedQuery,
    explanation: "",
  }),
  { kind: "search", task: (args) => args.task ?? "questionToQuery" },
);

export const generateScreeningQuestions = createAIAction(
  {
    researchQuestion: v.string(),
    existingQuestions: v.array(v.string()),
    responseLanguage: v.optional(v.string()),
  },
  v.object({
    questions: v.array(v.string()),
  }),
  "Generate screening questions",
  getScreeningQuestionsConfig,
  (output) => ({
    questions: output.questions,
  }),
  // Writing questions needs a text model; the Screening pick may be Jev, which only answers them.
  { kind: "screening", task: "extraction" },
);

export const generateExtractionQuestions = createAIAction(
  {
    jobName: v.string(),
    sourceContext: v.string(),
    existingQuestions: v.array(v.string()),
    responseLanguage: v.optional(v.string()),
  },
  v.object({
    questions: v.array(v.object({
      question: v.string(),
      type: v.union(v.literal("string"), v.literal("boolean"), v.literal("number"), v.literal("array")),
      description: v.optional(v.string()),
    })),
  }),
  "Generate extraction questions",
  getExtractionQuestionsConfig,
  toExtractionQuestions,
  { kind: "extraction", task: "extraction" },
);

export const translateQuery = createAIAction(
  {
    query: v.string(),
    targetLanguage: v.string(),
    syntax: v.optional(v.literal("oql")),
  },
  v.object({
    translatedQuery: v.string(),
  }),
  "Translate query",
  getTranslateQueryConfig,
  (output) => ({
    translatedQuery: output.translatedQuery,
  }),
  { kind: "translation", task: "translate" },
);

export const translatePaperContent = createAIAction(
  {
    title: v.string(),
    abstract: v.string(),
    targetLanguage: v.optional(v.string()),
  },
  v.object({
    translatedTitle: v.string(),
    translatedAbstract: v.string(),
    noTranslationNeeded: v.boolean(),
  }),
  "Translate paper content",
  getTranslatePaperContentConfig,
  (output) => ({
    translatedTitle: output.translatedTitle,
    translatedAbstract: output.translatedAbstract,
    noTranslationNeeded: false,
  }),
  { kind: "translation", task: "translate" },
);


/**
 * Batch translation action - processes multiple papers in a single action call.
 * Uses the shared batch processor factory for consistent behavior with client-side.
 */
export const generateBatchTranslations = action({
  args: {
    papers: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        abstract: v.string(),
      })
    ),
    targetLanguage: v.optional(v.string()),
  },
  returns: batchTranslationsValidator,
  handler: async (ctx, args) => {
    const { papers, targetLanguage } = args;

    if (papers.length === 0) {
      return { results: {}, errors: [] };
    }
    if (papers.length > MAX_BATCH_PAPERS) throw createError("VALIDATION_ERROR", `Papers are translated ${MAX_BATCH_PAPERS} at a time.`);

    // Auth → rate-limit → lock → run → finally release. Same shape
    // as generateBatchScreeningResponses with the translation kind
    // and bucket. Rate-limit before lock for cheap fast-fail.
    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) {
      throw createError("AI_UNAUTHENTICATED", "Authentication required to use AI features");
    }
    await ctx.runMutation(internal.lib.rateLimit.consume, {
      name: "batch-translation",
      key: user._id,
    });
    const lockId = await ctx.runMutation(internal.lib.locks.acquireBatchLock, {
      userId: user._id,
      kind: "batch_translation",
      ttlMs: BATCH_LOCK_TTL_MS,
    });

    try {
      return await withAuthAndCreditsBatch(
        ctx,
        {
          description: `Batch translation (${papers.length} papers)`,
          kind: "translation",
          task: "translate",
          estimate: Math.ceil(papers.length * ESTIMATED_CREDITS_PER_PAPER),
        },
        async (_user, model, effort) => {
          const { results, errors, usages, usageByItemId, trackingByItemId } = await processTranslationBatch({
            model,
            effort,
            papers,
            targetLanguage,
          });

          const trackingEntries: AITrackingEntry[] = Object.entries(trackingByItemId).map(
            ([itemId, tracking]) => {
              const usage = usageByItemId[itemId];
              return {
                feature: `batch_translation`,
                usage: {
                  inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? 0,
                  outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? 0,
                },
                latencyMs: tracking.latencyMs,
                input: truncateForTracking(tracking.input),
                output: truncateForTracking(tracking.output),
                temperature: tracking.temperature,
              };
            },
          );

          return {
            result: { results, errors },
            totalUsage: aggregateUsage(usages),
            trackingEntries,
          };
        },
      );
    } finally {
      await ctx.runMutation(internal.lib.locks.releaseBatchLock, { lockId });
    }
  },
});

/**
 * Batch screening action - processes multiple papers in a single action call.
 * Uses the shared batch processor factory for consistent behavior with client-side.
 */
export const generateBatchScreeningResponses = action({
  args: {
    papers: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        abstract: v.string(),
      })
    ),
    questions: v.array(v.string()),
  },
  returns: batchScreeningValidator,
  handler: async (ctx, args) => {
    const { papers, questions } = args;

    // Skip if no papers or no questions
    if (papers.length === 0 || questions.length === 0) {
      return { results: {}, errors: [] };
    }
    if (papers.length > MAX_BATCH_PAPERS) throw createError("VALIDATION_ERROR", `Papers are screened ${MAX_BATCH_PAPERS} at a time.`);
    if (questions.length > MAX_QUESTIONS) throw createError("VALIDATION_ERROR", `A screening asks at most ${MAX_QUESTIONS} questions.`);

    // Auth → rate-limit → lock → run → finally release.
    // The rate-limit consume happens BEFORE the lock acquire so a
    // spam-clicker hits the cheap rate-limit fail rather than the
    // expensive auth + lock contention path.
    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) {
      throw createError("AI_UNAUTHENTICATED", "Authentication required to use AI features");
    }
    await ctx.runMutation(internal.lib.rateLimit.consume, {
      name: "batch-screening",
      key: user._id,
    });
    const lockId = await ctx.runMutation(internal.lib.locks.acquireBatchLock, {
      userId: user._id,
      kind: "batch_screening",
      ttlMs: BATCH_LOCK_TTL_MS,
    });

    try {
      return await withAuthAndCreditsBatch(
        ctx,
        {
          description: `Batch screening (${papers.length} papers)`,
          kind: "screening",
          task: "screening",
          estimate: Math.ceil(papers.length * ESTIMATED_CREDITS_PER_PAPER),
        },
        async (_user, model, effort) => {
          const { results, errors, usages, usageByItemId, trackingByItemId } = await processScreeningBatch({
            model,
            effort,
            decisionsKey: process.env.OPENROUTER_API_KEY,
            papers,
            questions,
          });

          const encodedResults = Object.fromEntries(
            Object.entries(results).map(([paperId, result]) => [
              paperId,
              {
                ...result,
                responses: encodeQuestionResponseMap(result.responses),
                confidences: encodeQuestionResponseMap(result.confidences),
              },
            ])
          );

          const trackingEntries: AITrackingEntry[] = Object.entries(trackingByItemId).map(
            ([itemId, tracking]) => {
              const usage = usageByItemId[itemId];
              return {
                feature: `batch_screening`,
                usage: {
                  inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? 0,
                  outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? 0,
                },
                latencyMs: tracking.latencyMs,
                input: truncateForTracking(tracking.input),
                output: truncateForTracking(tracking.output),
                temperature: tracking.temperature,
              };
            },
          );

          return {
            result: { results: encodedResults, errors },
            totalUsage: aggregateUsage(usages),
            trackingEntries,
          };
        },
      );
    } finally {
      await ctx.runMutation(internal.lib.locks.releaseBatchLock, { lockId });
    }
  },
});
