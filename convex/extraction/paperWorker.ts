"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, type ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  classifyUnknownError,
  type ClassifiedError,
} from "@/lib/errors/taxonomy";
import { chunk } from "./batching";
import { getProcessableFlags } from "./content";
import { resolveOpenRouterModel } from "../chat/provider";
import {
  batchSkipReasonToWorkerSkipReason,
  captureCompletedQuestionTracking,
  runDownloadAndIndexPdf,
  runExtractQuestionWithContext,
  toCompletedQuestionBatchWrite,
  type JobWorkerSkipReason,
  type PaperExtractionContext,
  type QuestionBatchOutcome,
  type WorkerSkipReason,
} from "./workpoolActions";

type QueueRow = Doc<"extractionPaperQueue">;
type QueueStatus = QueueRow["status"];
type QueueStopStatus = Extract<QueueStatus, "cancelled" | "failed" | "parked">;
const QUEUE_LEASE_MS = 60_000;

type QuestionItem = Doc<"extractionQuestions">;

type PaperExtractionContextResult =
  | { status: "not_found" }
  | ({ status: "ok" } & PaperExtractionContext);

function getTerminalQueueStatusForJob(
  status: Doc<"extractionJobs">["status"] | null | undefined,
): QueueStopStatus | null {
  if (status === "cancelled") return "cancelled";
  if (status === "completed" || status === "failed") return "failed";
  if (status === "paused" || status === "creditsExhausted") return "parked";
  return null;
}

function getQueueStatusForWorkerSkip(
  reason: WorkerSkipReason,
): QueueStopStatus | null {
  switch (reason) {
    case "already_billed":
      return null;
    case "cancelled":
      return "cancelled";
    case "job_terminal":
      return "failed";
    case "credits_exhausted":
    case "paused":
    case "stale_epoch":
      return "parked";
    default: {
      const exhaustive: never = reason;
      throw new Error(`Unhandled worker skip reason: ${String(exhaustive)}`);
    }
  }
}

function getQueueStatusForJobSkip(
  reason: JobWorkerSkipReason,
): QueueStopStatus {
  const status = getQueueStatusForWorkerSkip(reason);
  if (!status) {
    throw new Error(`Unexpected non-terminal job skip: ${reason}`);
  }
  return status;
}

function toFailureError(error: ClassifiedError) {
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.context !== undefined ? { context: error.context } : {}),
    ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
    ...(error.providerName !== undefined
      ? { providerName: error.providerName }
      : {}),
  };
}

async function updateQueueStatus(
  ctx: ActionCtx,
  queueRow: QueueRow,
  status: QueueStatus,
): Promise<boolean> {
  const result = await ctx.runMutation(
    internal.extraction.queue.mutations.updatePaperQueueStatus,
    {
      queueId: queueRow._id,
      expectedEpoch: queueRow.runEpoch,
      status,
    },
  );
  return result.applied;
}

async function dispatchNextQueueWindow(
  ctx: ActionCtx,
  queueRow: QueueRow,
  args: {
    paperConcurrency: number;
    questionConcurrency: number;
    pdfEnabled: boolean;
  },
): Promise<void> {
  await ctx.runMutation(
    internal.extraction.queue.mutations.dispatchPaperQueueWindow,
    {
      jobId: queueRow.jobId,
      expectedEpoch: queueRow.runEpoch,
      paperConcurrency: args.paperConcurrency,
      leaseOwner: `worker:${queueRow.jobId}:${queueRow.runEpoch}:${queueRow._id}`,
      leaseMs: QUEUE_LEASE_MS,
      questionConcurrency: args.questionConcurrency,
      pdfEnabled: args.pdfEnabled,
    },
  );
}

async function completeQueueItem(
  ctx: ActionCtx,
  queueRow: QueueRow,
  args: {
    status: Extract<QueueStatus, "completed" | "failed">;
    paperConcurrency: number;
    questionConcurrency: number;
    pdfEnabled: boolean;
  },
): Promise<void> {
  const applied = await updateQueueStatus(ctx, queueRow, args.status);
  if (!applied) return;
  await dispatchNextQueueWindow(ctx, queueRow, {
    paperConcurrency: args.paperConcurrency,
    questionConcurrency: args.questionConcurrency,
    pdfEnabled: args.pdfEnabled,
  });
}

async function markPaperStatus(
  ctx: ActionCtx,
  args: {
    paperId: Id<"extractionPapers">;
    expectedEpoch: number;
    status:
      | "downloading"
      | "download_failed"
      | "extracting"
      | "completed"
      | "failed";
    error?: { code: ClassifiedError["code"]; message: string };
  },
): Promise<void> {
  await ctx.runMutation(
    internal.extraction.mutations.papers.updatePaperStatus,
    {
      paperId: args.paperId,
      status: args.status,
      expectedEpoch: args.expectedEpoch,
      ...(args.error ? { error: args.error } : {}),
    },
  );
}

async function maybeFinalizeJob(
  ctx: ActionCtx,
  queueRow: QueueRow,
): Promise<void> {
  await ctx.runMutation(
    internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob,
    { jobId: queueRow.jobId, expectedEpoch: queueRow.runEpoch },
  );
}

function getQuestionItemsForQueue(
  queueRow: QueueRow,
  questions: ReadonlyArray<Doc<"extractionQuestions">>,
): QuestionItem[] {
  if (queueRow.kind === "initial") {
    return [...questions];
  }

  const retryKeys = new Set(queueRow.questionKeys ?? []);
  return questions.filter((question) => retryKeys.has(question.key));
}

function isCompletedQuestionOutcome(
  outcome: QuestionBatchOutcome,
): outcome is Extract<QuestionBatchOutcome, { status: "completed" }> {
  return outcome.status === "completed";
}

function isFailedQuestionOutcome(
  outcome: QuestionBatchOutcome,
): outcome is Extract<QuestionBatchOutcome, { status: "failed" }> {
  return outcome.status === "failed";
}

async function runQuestionBatch(
  ctx: ActionCtx,
  {
    context,
    batch,
    expectedEpoch,
    model,
    pricing,
    modelSlug,
  }: {
    context: PaperExtractionContext;
    batch: ReadonlyArray<QuestionItem>;
    expectedEpoch: number;
    model: Awaited<ReturnType<typeof resolveOpenRouterModel>>["model"];
    pricing: Awaited<ReturnType<typeof resolveOpenRouterModel>>["pricing"];
    modelSlug: string;
  },
): Promise<QueueStopStatus | null> {
  const outcomes = await Promise.all(
    batch.map(async (question): Promise<QuestionBatchOutcome> => {
      try {
        return await runExtractQuestionWithContext({
          ctx,
          context,
          question,
          expectedEpoch,
          model,
          pricing,
        });
      } catch (error) {
        return {
          status: "failed",
          questionKey: question.key,
          error: classifyUnknownError(error),
        };
      }
    }),
  );

  const stopStatus = outcomes
    .filter(
      (outcome): outcome is Extract<QuestionBatchOutcome, { status: "skipped" }> =>
        outcome.status === "skipped",
    )
    .map((outcome) => getQueueStatusForWorkerSkip(outcome.reason))
    .find((status) => status !== null);
  if (stopStatus) return stopStatus;

  const completed = outcomes.filter(isCompletedQuestionOutcome);
  const failed = outcomes.filter(isFailedQuestionOutcome);
  if (completed.length === 0 && failed.length === 0) {
    return null;
  }

  const writeResult = await ctx.runMutation(
    internal.extraction.mutations.results.recordQuestionBatch,
    {
      paperId: context.paper._id,
      expectedEpoch,
      completed: completed.map(toCompletedQuestionBatchWrite),
      failed: failed.map((outcome) => ({
        questionKey: outcome.questionKey,
        error: toFailureError(outcome.error),
      })),
    },
  );

  if (writeResult.status === "skipped") {
    return getQueueStatusForWorkerSkip(
      batchSkipReasonToWorkerSkipReason(writeResult.reason),
    );
  }

  if (context.user && completed.length > 0) {
    await captureCompletedQuestionTracking({
      distinctId: context.user.clerkId,
      outcomes: completed,
      persistedQuestionKeys: new Set(writeResult.completed),
      modelSlug,
    });
  }

  return null;
}

async function runQuestionBatches(
  ctx: ActionCtx,
  {
    context,
    items,
    questionConcurrency,
    expectedEpoch,
  }: {
    context: PaperExtractionContext;
    items: ReadonlyArray<QuestionItem>;
    questionConcurrency: number;
    expectedEpoch: number;
  },
): Promise<QueueStopStatus | null> {
  // Per-user server model stamped on the job (credits path). Pricing comes from
  // the SAME row, so the deduction can never diverge from the model that ran.
  const { model, pricing, modelSlug } = await resolveOpenRouterModel(
    ctx,
    context.job.serverModelId ?? null,
  );
  for (const batch of chunk(items, questionConcurrency)) {
    const stopStatus = await runQuestionBatch(ctx, {
      context,
      batch,
      expectedEpoch,
      model,
      pricing,
      modelSlug,
    });
    if (stopStatus) return stopStatus;
  }
  return null;
}

export const runPaperQueueItem = internalAction({
  args: {
    queueId: v.id("extractionPaperQueue"),
    expectedEpoch: v.number(),
    paperConcurrency: v.number(),
    questionConcurrency: v.number(),
    pdfEnabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const queueRow = await ctx.runQuery(
      internal.extraction.queue.queries.getPaperQueueItem,
      { queueId: args.queueId },
    );
    if (!queueRow || queueRow.runEpoch !== args.expectedEpoch) {
      return null;
    }

    const job = await ctx.runQuery(
      internal.extraction.queries.internal.getJobInternal,
      { jobId: queueRow.jobId },
    );
    const terminalQueueStatus = getTerminalQueueStatusForJob(job?.status);
    if (terminalQueueStatus) {
      await updateQueueStatus(ctx, queueRow, terminalQueueStatus);
      return null;
    }
    if (!job) {
      await updateQueueStatus(ctx, queueRow, "failed");
      return null;
    }

    await updateQueueStatus(ctx, queueRow, "running");

    const paper = await ctx.runQuery(internal.extraction.queries.papers.byId, {
      paperId: queueRow.paperId,
    });
    if (!paper) {
      await completeQueueItem(ctx, queueRow, {
        status: "completed",
        paperConcurrency: args.paperConcurrency,
        questionConcurrency: args.questionConcurrency,
        pdfEnabled: args.pdfEnabled,
      });
      return null;
    }

    const { processable: computedProcessable } = getProcessableFlags({
      pdfUrl: paper.pdfUrl,
      storageId: paper.storageId,
      abstract: paper.abstract,
      pdfEnabled: args.pdfEnabled,
    });
    const isProcessable = paper.processable !== false && computedProcessable;
    if (!isProcessable) {
      await markPaperStatus(ctx, {
        paperId: paper._id,
        status: "download_failed",
        error: {
          code: "pdf_invalid",
          message: "No PDF URL or abstract available",
        },
        expectedEpoch: args.expectedEpoch,
      });
      await maybeFinalizeJob(ctx, queueRow);
      await completeQueueItem(ctx, queueRow, {
        status: "completed",
        paperConcurrency: args.paperConcurrency,
        questionConcurrency: args.questionConcurrency,
        pdfEnabled: args.pdfEnabled,
      });
      return null;
    }

    await markPaperStatus(ctx, {
      paperId: paper._id,
      status: "downloading",
      expectedEpoch: args.expectedEpoch,
    });

    const indexed = await runDownloadAndIndexPdf(ctx, {
      paperId: paper._id,
      jobId: queueRow.jobId,
      expectedEpoch: args.expectedEpoch,
    });
    if (indexed.status === "skipped") {
      await updateQueueStatus(
        ctx,
        queueRow,
        getQueueStatusForJobSkip(indexed.reason),
      );
      return null;
    }
    if (indexed.status === "failed") {
      await markPaperStatus(ctx, {
        paperId: paper._id,
        status: "download_failed",
        error: {
          code: indexed.error?.code ?? "pdf_download_failed",
          message: indexed.error?.message ?? "Download failed",
        },
        expectedEpoch: args.expectedEpoch,
      });
      await maybeFinalizeJob(ctx, queueRow);
      await completeQueueItem(ctx, queueRow, {
        status: "completed",
        paperConcurrency: args.paperConcurrency,
        questionConcurrency: args.questionConcurrency,
        pdfEnabled: args.pdfEnabled,
      });
      return null;
    }

    await markPaperStatus(ctx, {
      paperId: paper._id,
      status: "extracting",
      expectedEpoch: args.expectedEpoch,
    });

    const contextResult: PaperExtractionContextResult = await ctx.runQuery(
      internal.extraction.queries.internal.getPaperExtractionContext,
      { jobId: queueRow.jobId, paperId: paper._id },
    );
    if (contextResult.status !== "ok") {
      await updateQueueStatus(ctx, queueRow, "failed");
      return null;
    }
    const questionStopStatus = await runQuestionBatches(ctx, {
      context: contextResult,
      items: getQuestionItemsForQueue(queueRow, contextResult.questions),
      questionConcurrency: args.questionConcurrency,
      expectedEpoch: args.expectedEpoch,
    });
    if (questionStopStatus) {
      await updateQueueStatus(ctx, queueRow, questionStopStatus);
      return null;
    }

    await ctx.runMutation(internal.extraction.mutations.results.finalizePaper, {
      paperId: paper._id,
    });
    await completeQueueItem(ctx, queueRow, {
      status: "completed",
      paperConcurrency: args.paperConcurrency,
      questionConcurrency: args.questionConcurrency,
      pdfEnabled: args.pdfEnabled,
    });
    return null;
  },
});
