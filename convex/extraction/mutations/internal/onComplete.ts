/**
 * onComplete handlers for the extraction pipeline.
 *
 * Plan-02 retires the per-paper workpool onComplete chain; the workflow
 * handler in convex/extraction/workflow.ts now drives each paper's
 * pipeline end-to-end via step.runAction + step.runMutation. The only
 * remaining onComplete hook is the workflow-level failure safety net
 * for the workflow itself (see handleExtractionJobComplete below).
 */

import { v } from "convex/values";
import { vWorkflowId } from "@convex-dev/workflow";
import { vResultValidator } from "@convex-dev/workpool";
import { internalMutation } from "../../../_generated/server";
import { classifyUnknownError } from "@/lib/errors/taxonomy";

/**
 * Workflow-level onComplete for `runExtractionWorkflow`. Wired in at
 * every `workflow.start(...)` call site that launches the extraction
 * workflow (startJob, duplicateJob, startJobFromTemplate,
 * and the test fixture).
 *
 * Fires exactly once per workflow, regardless of how it terminates:
 *
 *  - `success`: the workflow handler already transitioned the job to
 *    `extracting`; paper-level onCompletes drive it to `completed` /
 *    `failed` via `maybeFinalizeJob`. No-op here.
 *  - `failed`: any uncaught throw in the workflow handler (or a step
 *    action) surfaces here. We patch the job to `failed` with the
 *    error message so the UI can show the user why it died. Skipped
 *    if the job is already in a terminal state (e.g. the user cancelled
 *    concurrently, or the workflow's paper-limit guard raced in first).
 *  - `canceled`: `cancelExtraction` already set status to `cancelled`
 *    before calling `workflow.cancel`. No-op here.
 *
 * Bypasses the `updateJobStatus` state-machine guard intentionally —
 * the framework guarantee is "this fires once when the workflow is
 * done", so writing the terminal status must succeed regardless of
 * whatever active state the workflow was last in. The terminal-
 * stickiness invariant is preserved by the `isTerminal` short-circuit.
 */
export const handleExtractionJobComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ jobId: v.id("extractionJobs") }),
  },
  returns: v.null(),
  handler: async (ctx, { workflowId, result, context: { jobId } }) => {
    if (result.kind !== "failed") return null;

    const job = await ctx.db.get(jobId);
    if (!job) return null;
    if (job.workflowId && job.workflowId !== workflowId) return null;

    const isTerminal =
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled";
    if (isTerminal) return null;
    if (job.status === "paused" || job.status === "creditsExhausted") {
      return null;
    }

    const classified = classifyUnknownError(new Error(result.error));
    const at = Date.now();
    await ctx.db.patch(jobId, {
      status: "failed",
      error: {
        code: classified.code,
        message: classified.message,
        ...(classified.context !== undefined ? { context: classified.context } : {}),
        ...(classified.httpStatus !== undefined
          ? { httpStatus: classified.httpStatus }
          : {}),
        ...(classified.providerName !== undefined
          ? { providerName: classified.providerName }
          : {}),
        at,
      },
      updatedAt: at,
    });
    console.log(
      `[handleExtractionJobComplete] Job ${jobId} failed (${classified.code}): ${result.error}`,
    );
    return null;
  },
});
