/**
 * Extraction Workflow using Workpool
 *
 * Durable workflow that orchestrates the extraction pipeline:
 * 1. Load job and validate (not cancelled/failed)
 * 2. Batched enqueue of all papers to workpool (single mutation per D-08/WORK-06)
 * 3. Workflow completes -- finalization handled by onComplete handler
 *
 * Papers are processed asynchronously by the workpool. The onComplete handler
 * (handleExtractionComplete) handles counter updates and job finalization.
 */

import { workflow } from "../workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";

export const runExtractionWorkflow = workflow.define({
  args: {
    jobId: v.id("extractionJobs"),
  },
  handler: async (step, { jobId }) => {
    console.info(JSON.stringify({ event: "workflow_start", jobId: String(jobId) }));

    // Step 1: Load and validate job
    const job = await step.runQuery(
      internal.extraction.queries.getJobInternal,
      { jobId }
    );

    if (!job) {
      throw createError(
        "EXTRACTION_JOB_NOT_FOUND",
        `Extraction job ${jobId} not found`
      );
    }

    // Early-return if job already cancelled or failed
    const TERMINAL_STATUSES = ["completed", "cancelled", "failed"] as const;
    if (
      TERMINAL_STATUSES.includes(
        job.status as (typeof TERMINAL_STATUSES)[number]
      )
    ) {
      console.info(JSON.stringify({ event: "workflow_terminal_skip", jobId: String(jobId), status: job.status }));
      return;
    }

    // Step 2: Batched enqueue -- single mutation creates paper rows and enqueues all (WORK-06)
    await step.runMutation(
      internal.extraction.mutations.enqueueAllPapers,
      { jobId }
    );

    console.info(JSON.stringify({ event: "workflow_enqueue_complete", jobId: String(jobId) }));

    // Step 3: Workflow done -- finalization handled by onComplete handler (D-10)
    // No explicit finalization step needed; handleExtractionComplete calls
    // finalizeJobIfDone after each paper completes.
  },
});
