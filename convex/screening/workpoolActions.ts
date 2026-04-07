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
import { withUserCreditsBatch, getModel } from "../ai/helpers";
import { encodeQuestionResponseMap } from "../../lib/ai/core/question-key-codec";
import type { ScreeningResultData } from "../../lib/ai/core/batch-types";
import { truncateForTracking, type AITrackingEntry } from "../../lib/posthog-ai-shared";
import { captureServerEvent } from "../../lib/posthog-server";

type ScreeningActionResult = {
  responses: Record<string, boolean | null>;
  confidence: number;
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
 * If credits are exhausted mid-job, updates job status to "creditsExhausted"
 * and re-throws so the workpool marks this item as failed.
 */
export const screenPaperAction = internalAction({
  args: {
    resultId: v.id("screeningResults"),
    jobId: v.id("screeningJobs"),
  },
  returns: v.object({
    responses: v.record(v.string(), v.union(v.boolean(), v.null())),
    confidence: v.number(),
  }),
  handler: async (ctx, args): Promise<ScreeningActionResult> => {
    const emptyResult: ScreeningActionResult = {
      responses: {},
      confidence: 0,
    };

    // 1. Load job
    const job = await ctx.runQuery(
      internal.screening.queries.getJobInternal,
      { jobId: args.jobId }
    );
    if (!job) {
      console.warn(`[screenPaperAction] Job ${args.jobId} not found, skipping`);
      return emptyResult;
    }

    // 2. Credit guard: skip terminal jobs
    const terminalStatuses = ["cancelled", "creditsExhausted", "completed", "failed"];
    if (terminalStatuses.includes(job.status)) {
      console.log(
        `[screenPaperAction] Job ${args.jobId} is ${job.status}, skipping paper ${args.resultId}`
      );
      return emptyResult;
    }

    // 3. Load screening result
    const result = await ctx.runQuery(
      internal.screening.queries.getResultInternal,
      { resultId: args.resultId }
    );
    if (!result) {
      console.warn(
        `[screenPaperAction] Result ${args.resultId} not found, skipping`
      );
      return emptyResult;
    }

    // 4. Idempotency guard: skip if already completed (prevents double-billing on retry)
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

    // 5. Call AI screening with credit billing
    try {
      const screeningResult: ScreeningResultData = await withUserCreditsBatch<ScreeningResultData>(
        ctx,
        job.userId as Id<"users">,
        `Bulk screening (paper ${result.openalexId})`,
        async () => {
          const model = await getModel();
          const paperId = String(args.resultId);
          const batchResult = await processScreeningBatch({
            model,
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
              result: { responses: {}, confidence: 0 },
              totalUsage,
              trackingEntries,
            };
          }

          return {
            result: paperResult,
            totalUsage,
            trackingEntries,
          };
        }
      );

      // 6. Encode responses for Convex storage (ASCII-safe keys)
      const encodedResponses: Record<string, boolean | null> = encodeQuestionResponseMap(
        screeningResult.responses
      );

      // 7. Return for onComplete handler
      return {
        responses: encodedResponses,
        confidence: screeningResult.confidence,
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
          internal.screening.mutations.updateJobStatus,
          { jobId: args.jobId, status: "creditsExhausted" }
        );

        // Track credits exhaustion for screening job
        const user = await ctx.runQuery(internal.users.internal.getUserById, { userId: job.userId as Id<"users"> });
        if (user?.clerkId) {
          await captureServerEvent(user.clerkId, "screening_job_failed", {
            reason: "credits_exhausted",
            job_id: args.jobId,
            total_papers: job.totalPapers,
          });
        }
      }

      throw error;
    }
  },
});
