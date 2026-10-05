"use node";

/**
 * Workpool actions for bulk screening.
 *
 * Each paper is processed independently via the workpool. The action calls
 * AI screening with credit billing, encodes responses for Convex storage,
 * and returns the result for the onComplete handler.
 */

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { processScreeningBatch } from "../../lib/ai/core/batch";
import { withUserCredits } from "../ai/helpers";
import { ESTIMATED_CREDITS_PER_PAPER } from "../lib/constants";
import { openRouterModel, resolveOpenRouterModel } from "../chat/provider";
import { MODEL_UNAVAILABLE_MESSAGE } from "../models/catalog";
import { createError } from "../lib/errors";
import { encodeQuestionResponseMap } from "../../lib/ai/core/question-key-codec";
import type { ScreeningResultData } from "../../lib/ai/core/batch-types";
import { truncateForTracking, type AITrackingEntry } from "../../lib/posthog-ai-shared";

type ScreeningActionResult = {
  model?: string;
  responses: Record<string, boolean | null>;
  // The confidence in each answer, under the same encoded keys.
  confidences: Record<string, number>;
  confidence: number;
  // What the paper cost in credits; none when the model wasn't asked.
  credits?: number;
  // The paper wasn't read: its job had spent what it may by the time it came up.
  capped?: boolean;
};

/**
 * Screen a single paper using AI.
 *
 * 1. Loads the job and checks for terminal status (credit guard)
 * 2. Loads the screening result for paper details
 * 3. Calls AI screening via processScreeningBatch with credit billing
 * 4. Encodes question-text keys for safe Convex storage
 * 5. Returns encoded responses + confidence for onComplete handler
 *
 * If credits are exhausted mid-job, marks the job as credits exhausted and
 * re-throws so the workpool marks this item as failed.
 */
export const screenPaperAction = internalAction({
  args: {
    resultId: v.id("screeningResults"),
    jobId: v.id("screeningJobs"),
  },
  returns: v.object({
    model: v.optional(v.string()),
    responses: v.record(v.string(), v.union(v.boolean(), v.null())),
    confidences: v.record(v.string(), v.number()),
    confidence: v.number(),
    credits: v.optional(v.number()),
    capped: v.optional(v.boolean()),
  }),
  handler: async (ctx, args): Promise<ScreeningActionResult> => {
    const emptyResult: ScreeningActionResult = {
      responses: {},
      confidences: {},
      confidence: 0,
    };

    // 1. Everything the paper needs, in one read.
    const context = await ctx.runQuery(internal.screening.queries.paperContext, args);
    if (!context) {
      console.warn(`[screenPaperAction] Job ${args.jobId} or result ${args.resultId} not found, skipping`);
      return emptyResult;
    }
    const { job, paper: result } = context;

    // 2. Credit guard: skip terminal jobs
    const terminalStatuses = ["cancelled", "creditsExhausted", "completed", "failed"];
    if (terminalStatuses.includes(job.status)) {
      console.log(
        `[screenPaperAction] Job ${args.jobId} is ${job.status}, skipping paper ${args.resultId}`
      );
      return emptyResult;
    }

    // A job the assistant started with the person's say reads no more papers once the ones counted have cost what
    // they approved (#328). Its papers start only while it has room for them at the estimate (./slots.ts), so this
    // stops one whose papers cost more than that: those already being read finish and are kept, the rest aren't read.
    // Its hold no longer taking papers (it expired while the job ran) stops it too: every charge of the job goes through the hold.
    if (job.spendCap !== undefined && (job.capped || (job.spent ?? 0) >= job.spendCap || (job.spendHold !== undefined && !job.held))) {
      if (!job.capped) await ctx.runMutation(internal.screening.mutations.capScreeningJob, { jobId: args.jobId });
      return { ...emptyResult, capped: true };
    }

    // 3. Idempotency guard: skip if already completed (prevents double-billing on retry)
    if (result.status === "completed") {
      console.log(
        `[screenPaperAction] Result ${args.resultId} already completed, skipping (workpool retry)`
      );
      return emptyResult;
    }

    // 4. Extract questions as string array
    const questionTexts: string[] = job.questions.map(
      (q: { key: string; question: string }) => q.question
    );

    // The job's model, read with the paper; pricing comes from the same row so the
    // charge matches the model that ran. A job stamped with no model runs the default.
    if (context.model && !context.model.available) throw createError("VALIDATION_ERROR", MODEL_UNAVAILABLE_MESSAGE);
    const { model, pricing: serverPricing, modelSlug: serverModelSlug } = context.model
      ? {
          model: await openRouterModel(context.model.slug),
          pricing: { input: context.model.input, output: context.model.output },
          modelSlug: context.model.slug,
        }
      : await resolveOpenRouterModel(ctx, null);

    // 5. Call AI screening with credit billing
    try {
      const { result: screeningResult, credits } = await withUserCredits<ScreeningResultData>(
        ctx,
        {
          userId: job.userId as Id<"users">,
          chargeId: `screening:${args.resultId}:${crypto.randomUUID()}`,
          estimate: Math.ceil(ESTIMATED_CREDITS_PER_PAPER),
          hold: false,
          // A job the person approved up to a figure holds it once: its papers are charged under that hold.
          ...(job.spendHold ? { under: job.spendHold } : {}),
          balance: context.balance,
          clerkId: context.clerkId,
          kind: "screening",
          description: "Bulk screening",
          model: serverModelSlug,
        },
        serverPricing,
        async () => {
          const paperId = String(args.resultId);
          const batchResult = await processScreeningBatch({
            model,
            effort: job.serverEffort,
            decisionsKey: process.env.OPENROUTER_API_KEY,
            sessionId: String(args.jobId),
            papers: [
              {
                id: paperId,
                title: result.title,
                abstract: result.abstract ?? "",
              },
            ],
            questions: questionTexts,
          });

          const totalUsage = batchResult.usages[0] ?? {
            inputTokens: 0,
            outputTokens: 0,
          };

          // Build tracking entries BEFORE any throw so they aren't lost
          // if the result lookup below fails.
          const tracking = batchResult.trackingByItemId[paperId];
          const trackingEntries: AITrackingEntry[] = tracking
            ? [{
                feature: "workpool_screening",
                usage: {
                  inputTokens: totalUsage.inputTokens ?? totalUsage.promptTokens ?? 0,
                  outputTokens: totalUsage.outputTokens ?? totalUsage.completionTokens ?? 0,
                },
                latencyMs: tracking.latencyMs,
                input: truncateForTracking(tracking.input),
                output: truncateForTracking(tracking.output),
                temperature: tracking.temperature,
              }]
            : [];

          const paperResult = batchResult.results[paperId];
          if (!paperResult) {
            // Return tracking even for failures so the $ai_generation event is sent.
            // The workpool will mark this item as failed via the thrown error.
            return {
              result: { responses: {}, confidences: {}, confidence: 0 },
              totalUsage,
              trackingEntries,
            };
          }

          return {
            result: paperResult,
            totalUsage,
            trackingEntries,
          };
        },
      );

      // 6. Encode responses for Convex storage (ASCII-safe keys)
      const encodedResponses: Record<string, boolean | null> = encodeQuestionResponseMap(
        screeningResult.responses
      );

      // 7. Return for onComplete handler, with the confidence in each answer under the same keys
      return {
        model: serverModelSlug,
        responses: encodedResponses,
        confidences: encodeQuestionResponseMap(screeningResult.confidences),
        confidence: screeningResult.confidence,
        credits,
      };
    } catch (error: unknown) {
      // Handle credit exhaustion: update job status and re-throw
      const isInsufficientCredits =
        error instanceof Error &&
        (error.message.includes("AI_INSUFFICIENT_CREDITS") ||
          (typeof (error as { data?: { code?: string } }).data === "object" &&
            (error as { data?: { code?: string } }).data?.code ===
              "AI_INSUFFICIENT_CREDITS"));

      if (isInsufficientCredits) {
        console.warn(
          `[screenPaperAction] Credits exhausted for job ${args.jobId}`
        );
        await ctx.runMutation(
          internal.screening.mutations.markScreeningJobCreditsExhausted,
          { jobId: args.jobId }
        );

        // Track credits exhaustion for screening job
        await ctx.scheduler.runAfter(0, internal.lib.analytics.captureEvent, {
          distinctId: context.clerkId,
          event: "screening_job_failed",
          properties: { reason: "credits_exhausted", job_id: args.jobId, total_papers: job.totalPapers },
        });
      }

      throw error;
    }
  },
});
