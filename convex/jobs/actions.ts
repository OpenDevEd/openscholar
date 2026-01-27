"use node";

/**
 * Universal Job System - Worker Action
 *
 * Single worker action that processes items for all job types.
 * Uses the processor registry to dispatch to type-specific logic.
 */
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { getProcessor } from "./processors";
import type { ProcessorResult, JobItemPayload, JobType } from "./types";

// Import processors to trigger registration
import "./processors/pdfDownload";
import "./processors/ragIndexing";
import "./processors/extraction";

// ═══════════════════════════════════════════════════════════════════════════
// UNIVERSAL WORKER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process the next available item for a job.
 * Self-scheduling worker that claims an item, processes it, and respawns.
 */
export const processNextItem = internalAction({
  args: {
    jobId: v.id("jobs"),
  },
  returns: v.null(),
  handler: async (ctx, { jobId }): Promise<null> => {
    // 1. Claim an item
    const claim = await ctx.runMutation(internal.jobs.mutations.claimItem, {
      jobId,
    });

    // No work available or job complete
    if (claim === null) {
      return null;
    }

    // At capacity - wait and retry
    if ("waitAndRetry" in claim && claim.waitAndRetry) {
      await ctx.scheduler.runAfter(
        100,
        internal.jobs.actions.processNextItem,
        { jobId }
      );
      return null;
    }

    // Type guard: at this point, claim must be the full claim object
    // The union type has been narrowed by the checks above
    if (!("itemId" in claim)) {
      // This should never happen, but TypeScript needs this guard
      console.error("[Jobs] Invalid claim structure");
      return null;
    }

    // Now TypeScript knows we have the full claim data
    const {
      jobType,
      jobUserId,
      jobAnalysisId,
      jobMetadata,
      itemId,
      itemIndex,
      itemPayload,
      itemAttempts,
      isRetry,
    } = claim;

    const logPrefix = `[Jobs:${jobType}:${itemIndex}]`;
    if (isRetry) {
      console.log(`${logPrefix} Retrying (attempt ${itemAttempts})`);
    }

    // 2. Get the processor
    let processor;
    try {
      processor = getProcessor(jobType);
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`${logPrefix} No processor: ${error}`);
      await ctx.runMutation(internal.jobs.mutations.releaseItem, {
        jobId,
        itemId,
        success: false,
        error,
      });
      return null;
    }

    // 3. Execute processor with error handling
    let result: ProcessorResult;
    try {
      result = await processor(
        ctx,
        {
          _id: jobId,
          type: jobType as JobType,
          analysisId: jobAnalysisId,
          userId: jobUserId,
          metadata: jobMetadata,
        },
        {
          _id: itemId,
          index: itemIndex,
          payload: itemPayload,
          attempts: itemAttempts,
        }
      );

      if (result.success) {
        console.log(`${logPrefix} SUCCESS`);
      } else if (result.skipped) {
        console.log(`${logPrefix} SKIPPED: ${result.error ?? "no reason"}`);
      } else {
        console.log(`${logPrefix} FAILED: ${result.error ?? "unknown"}`);
      }
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`${logPrefix} EXCEPTION: ${error}`);
      result = { success: false, error };
    }

    // 4. ALWAYS release the item (even on error)
    let releaseResult;
    try {
      releaseResult = await ctx.runMutation(internal.jobs.mutations.releaseItem, {
        jobId,
        itemId,
        success: result.success,
        skipped: result.skipped,
        result: result.result,
        error: result.error,
      });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`${logPrefix} Failed to release: ${error}`);
      // Still try to continue the job
      releaseResult = { isJobComplete: false, processed: 0, total: 0 };
    }

    // 5. Continue or finish
    if (!releaseResult.isJobComplete) {
      // Spawn next worker immediately
      await ctx.scheduler.runAfter(0, internal.jobs.actions.processNextItem, {
        jobId,
      });
    } else {
      console.log(
        `[Jobs:${jobType}] JOB COMPLETE: ${releaseResult.processed}/${releaseResult.total}`
      );
      if (releaseResult.triggeredNextJob) {
        console.log(
          `[Jobs:${jobType}] Started dependent job: ${releaseResult.triggeredNextJob}`
        );
      }
    }

    return null;
  },
});
