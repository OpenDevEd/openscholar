/**
 * onComplete handlers for the extraction pipeline.
 *
 * There are two layers of async work, each with its own onComplete:
 *
 *  - **Workflow-level** (`handleExtractionJobComplete`): fires once per
 *    run of `runExtractionWorkflow`. This is the job's framework-guaranteed
 *    failure safety net — if the workflow handler throws for any reason
 *    (empty papers post-dedupe, action failure, unexpected exception),
 *    the job is marked `failed` with an `errorMessage`. Without this,
 *    any throw after the status transition to `downloading_pdfs`/
 *    `indexing` would strand the job in a non-terminal status.
 *
 *  - **Workpool-level** (`handleDownloadAndIndexComplete`,
 *    `handleExtractionComplete`): fires per-paper for the 3-step
 *    download/index/extract pipeline. Routes every RunResult branch
 *    through `handleWorkpoolResult` and funnels failed/canceled/
 *    download_failed through `failPaperAndFinalize` so counter
 *    maintenance stays in one place.
 *
 * The three-branches × two-handlers × terminal-idempotency invariants are
 * pinned in SN-4 (convex/extraction/onComplete-handlers.test.ts).
 */

import { v } from "convex/values";
import { vWorkflowId } from "@convex-dev/workflow";
import { vResultValidator } from "@convex-dev/workpool";
import {
  internalMutation,
  type MutationCtx,
} from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { pdfProcessingPool } from "../../../workpool";
import { handleWorkpoolResult } from "../../../lib/workpool";
import type { ExtractionResult } from "../../types";
import { questionInputValidator } from "../../validators";
import {
  assertValidPaperTransition,
  type PaperStatus,
} from "../../stateMachine";
import { markPaperTerminalTx } from "../../paperLifecycle";

async function failPaperAndFinalize(
  ctx: MutationCtx,
  paperId: Id<"extractionPapers">,
  jobId: Id<"extractionJobs">,
  status: "failed" | "download_failed",
  errorMessage: string,
) {
  await markPaperTerminalTx(ctx, paperId, status, { errorMessage });
  await ctx.runMutation(internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, {
    jobId,
  });
}

export const handleDownloadAndIndexComplete = pdfProcessingPool.defineOnComplete(
  {
    context: v.object({
      paperId: v.id("extractionPapers"),
      jobId: v.id("extractionJobs"),
      questions: v.array(questionInputValidator),
    }),
    handler: async (ctx, { context, result }) => {
      const { paperId, jobId, questions } = context;
      console.log(
        `[handleDownloadAndIndexComplete] Paper ${paperId}, result: ${result.kind}`,
      );

      await handleWorkpoolResult(ctx, result, {
        onSuccess: async (ctx, returnValue) => {
          const data = returnValue as {
            success: boolean;
            storageId?: string;
            chunksCount?: number;
            error?: string;
          };

          if (!data.success) {
            console.log(
              `[handleDownloadAndIndexComplete] Download failed for ${paperId}: ${data.error}`,
            );
            await failPaperAndFinalize(
              ctx,
              paperId,
              jobId,
              "download_failed",
              data.error || "Download failed",
            );
            return;
          }

          console.log(
            `[handleDownloadAndIndexComplete] Download/index success for ${paperId}, chunks: ${data.chunksCount}`,
          );

          const paperRow = await ctx.db.get(paperId);
          if (paperRow) {
            assertValidPaperTransition(
              paperRow.status as PaperStatus,
              "indexing",
            );
          }
          await ctx.db.patch(paperId, { status: "indexing" });
          if ((data.chunksCount ?? 0) === 0) {
            await ctx.db.patch(paperId, { isIndexed: false });
          }

          // Step 2: Wait for indexing and extract. Capture the WorkId so
          // cancelExtraction can abort only this paper's work item.
          const extractWorkId = await pdfProcessingPool.enqueueAction(
            ctx,
            internal.extraction.workpoolActions.waitAndExtractAction,
            { paperId, jobId, questions },
            {
              onComplete:
                internal.extraction.mutations.internal.onComplete.handleExtractionComplete,
              context: { paperId, jobId },
              retry: { maxAttempts: 3, initialBackoffMs: 2000, base: 2 },
            },
          );
          await ctx.db.patch(paperId, { workId: extractWorkId });
        },
        onFailed: (ctx, error) =>
          failPaperAndFinalize(
            ctx,
            paperId,
            jobId,
            "failed",
            error || "Download/index action failed",
          ),
        onCanceled: (ctx) =>
          failPaperAndFinalize(
            ctx,
            paperId,
            jobId,
            "failed",
            "Download/index was canceled",
          ),
      });
    },
  },
);

export const handleExtractionComplete = pdfProcessingPool.defineOnComplete({
  context: v.object({
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
  }),
  handler: async (ctx, { context, result }) => {
    const { paperId, jobId } = context;
    console.log(
      `[handleExtractionComplete] Paper ${paperId}, result: ${result.kind}`,
    );

    await handleWorkpoolResult(ctx, result, {
      onSuccess: async (ctx, returnValue) => {
        const data = returnValue as {
          success: boolean;
          results?: ExtractionResult[];
          creditsUsed?: number;
          pdfContentUsed?: boolean;
          error?: string;
        };

        if (!data.success || !data.results) {
          await failPaperAndFinalize(
            ctx,
            paperId,
            jobId,
            "failed",
            data.error || "Extraction failed",
          );
          return;
        }

        // saveExtractionResultsAndComplete owns the terminal transition for
        // the success branch — it calls maybeFinalizeJob as its last step.
        await ctx.runMutation(
          internal.extraction.mutations.results.saveExtractionResultsAndComplete,
          {
            paperId,
            results: data.results,
            creditsUsed: data.creditsUsed || 0,
            pdfContentUsed: data.pdfContentUsed || false,
          },
        );
        console.log(
          `[handleExtractionComplete] Paper ${paperId} completed successfully`,
        );
      },
      onFailed: (ctx, error) =>
        failPaperAndFinalize(
          ctx,
          paperId,
          jobId,
          "failed",
          error || "Extraction action failed",
        ),
      onCanceled: (ctx) =>
        failPaperAndFinalize(
          ctx,
          paperId,
          jobId,
          "failed",
          "Extraction was canceled",
        ),
    });
  },
});

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
  handler: async (ctx, { result, context: { jobId } }) => {
    if (result.kind !== "failed") return null;

    const job = await ctx.db.get(jobId);
    if (!job) return null;

    const isTerminal =
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled";
    if (isTerminal) return null;

    await ctx.db.patch(jobId, {
      status: "failed",
      errorMessage: result.error,
      updatedAt: Date.now(),
    });
    console.log(
      `[handleExtractionJobComplete] Job ${jobId} failed: ${result.error}`,
    );
    return null;
  },
});
