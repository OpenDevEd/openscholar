/**
 * Workpool onComplete handlers for the 3-step extraction pipeline.
 *
 * Step 1 (download & index) dispatches into handleDownloadAndIndexComplete;
 * Step 2 (wait & extract) dispatches into handleExtractionComplete.
 * Both route every RunResult branch through the shared handleWorkpoolResult
 * dispatcher, and funnel failed/canceled/download_failed through the
 * private failPaperAndFinalize helper so counter maintenance stays in one
 * place.
 *
 * The three-branches × two-handlers × terminal-idempotency invariants are
 * pinned in SN-4 (convex/extraction/onComplete-handlers.test.ts).
 */

import { v } from "convex/values";
import type { MutationCtx } from "../../../_generated/server";
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
