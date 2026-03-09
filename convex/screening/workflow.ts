/**
 * Screening Workflow using Workpool
 *
 * Durable workflow that orchestrates the full screening pipeline:
 * 1. Load job and pending results
 * 2. Update status to processing
 * 3. Enqueue each paper for independent AI screening via workpool
 *
 * Papers are processed asynchronously by the workpool. The onComplete handler
 * (handleScreeningComplete) handles scoring, library save, and finalization.
 */

import { workflow } from "../workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";

export const runScreeningWorkflow = workflow.define({
  args: {
    jobId: v.id("screeningJobs"),
  },
  handler: async (step, { jobId }) => {
    console.log(`[ScreeningWorkflow] Starting screening for job ${jobId}`);

    // 1. Load job
    const job = await step.runQuery(
      internal.screening.queries.getJobInternal,
      { jobId }
    );

    if (!job) {
      throw createError("NOT_FOUND", `Screening job ${jobId} not found`);
    }

    // 2. Load pending results
    const pendingResults = await step.runQuery(
      internal.screening.queries.getPendingResults,
      { jobId }
    );

    if (pendingResults.length === 0) {
      // Edge case: all papers somehow already processed
      console.log(
        `[ScreeningWorkflow] No pending results for job ${jobId}, marking complete`
      );
      await step.runMutation(
        internal.screening.mutations.updateJobStatus,
        { jobId, status: "completed" }
      );
      return;
    }

    // 3. Update status to processing
    await step.runMutation(
      internal.screening.mutations.updateJobStatus,
      { jobId, status: "processing" }
    );

    // 4. Enqueue each paper for independent AI screening
    for (const result of pendingResults) {
      await step.runMutation(
        internal.screening.mutations.enqueueScreeningPaper,
        {
          resultId: result._id,
          jobId,
        }
      );
    }

    console.log(
      `[ScreeningWorkflow] Enqueued ${pendingResults.length} papers for screening`
    );
  },
});
