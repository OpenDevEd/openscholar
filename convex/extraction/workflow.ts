/**
 * Extraction workflow — Tier A per-paper sub-workflow decomposition.
 *
 * Each paper runs as a child workflow (`paperPipelineWorkflow` /
 * `retryPaperPipelineWorkflow`) launched from the parent
 * (`runExtractionWorkflow` / `runRetryWorkflow`) via `step.runWorkflow`.
 *
 * Why: prior to Tier A, every paper's per-step journal entries lived
 * in the parent's journal. With Q questions × P papers, the parent
 * journal accumulated O(P × (Q + 5)) rows, and every step write
 * contended on the parent generation lock. Sub-workflows give each
 * paper its own `workflows` row and its own `steps` table, so the
 * parent journal collapses to one entry per paper (the runWorkflow
 * call) and per-paper journal churn no longer cross-contends with
 * peer papers' steps.
 *
 * Halt / park / completed flow up the parent identically — the child
 * returns its `PaperPipelineResult` from its handler, the parent reads
 * it from `await step.runWorkflow(...)`, and `runBoundedBatches`
 * batches and re-queues parked items exactly as before.
 */

import { workflow } from "../workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { getProcessableFlags } from "./content";
import type { Doc, Id } from "../_generated/dataModel";
import { chunk, resolveBoundedConcurrency } from "./batching";

import { createError } from "../lib/errors";
import { classifyUnknownError } from "@/lib/errors/taxonomy";
import type { WorkflowCtx } from "@convex-dev/workflow";

const EXTRACTION_PAPER_CONCURRENCY_INFRA_CLAMP = 5;
const EXTRACTION_QUESTION_CONCURRENCY_INFRA_CLAMP = 5;

type ExtractionWorkflowStep = Pick<
  WorkflowCtx,
  "awaitEvent" | "runAction" | "runMutation" | "runQuery"
>;

type JobControl = {
  status: string | null;
  runEpoch: number;
};

type PaperPipelineResult = "completed" | "halted" | "park";

const paperPipelineResultValidator = v.union(
  v.literal("completed"),
  v.literal("halted"),
  v.literal("park"),
);

type ExtractionWorkerSkipReason =
  | "already_billed"
  | "cancelled"
  | "job_terminal"
  | "credits_exhausted"
  | "paused"
  | "stale_epoch";

export function classifyWorkerSkip(
  reason: ExtractionWorkerSkipReason,
): PaperPipelineResult {
  switch (reason) {
    case "already_billed":
      return "completed";
    case "cancelled":
    case "job_terminal":
      return "halted";
    case "paused":
    case "credits_exhausted":
    case "stale_epoch":
      return "park";
    default: {
      const _exhaustive: never = reason;
      throw new Error(
        `Unhandled worker skip reason: ${String(_exhaustive)}`,
      );
    }
  }
}

type ExtractionPaper = Doc<"extractionPapers">;
type ExtractionQuestion = Doc<"extractionQuestions">;

async function getEffectiveExecutionConcurrency(
  step: ExtractionWorkflowStep,
  userId: Id<"users">,
): Promise<{
  paperConcurrency: number;
  questionConcurrency: number;
}> {
  const executionLimits = await step.runQuery(
    internal.extraction.bucket.limits.getExtractionExecutionLimitsForUser,
    { userId },
  );

  return {
    paperConcurrency: resolveBoundedConcurrency(
      executionLimits.paperConcurrency,
      EXTRACTION_PAPER_CONCURRENCY_INFRA_CLAMP,
    ),
    questionConcurrency: resolveBoundedConcurrency(
      executionLimits.questionConcurrencyPerPaper,
      EXTRACTION_QUESTION_CONCURRENCY_INFRA_CLAMP,
    ),
  };
}

export async function runBoundedBatches<TItem>({
  items,
  batchSize,
  waitForNextBatch,
  runItem,
}: {
  items: ReadonlyArray<TItem>;
  batchSize: number;
  waitForNextBatch: () => Promise<JobControl | null>;
  runItem: (item: TItem, control: JobControl) => Promise<PaperPipelineResult>;
}): Promise<PaperPipelineResult> {
  for (const batch of chunk(items, batchSize)) {
    let pendingItems: ReadonlyArray<TItem> = batch;
    while (pendingItems.length > 0) {
      const control = await waitForNextBatch();
      if (control === null) {
        return "halted";
      }

      const batchResults = await Promise.all(
        pendingItems.map((item) => runItem(item, control)),
      );

      if (batchResults.some((result) => result === "halted")) {
        return "halted";
      }

      pendingItems = pendingItems.filter(
        (_, index) => batchResults[index] === "park",
      );
    }
  }

  return "completed";
}

async function runQuestionStep(
  step: ExtractionWorkflowStep,
  {
    jobId,
    paperId,
    questionId,
    questionKey,
    expectedEpoch,
    retryLabelPrefix,
    logPrefix,
  }: {
    jobId: Id<"extractionJobs">;
    paperId: Id<"extractionPapers">;
    questionId: Id<"extractionQuestions">;
    questionKey: string;
    expectedEpoch: number;
    retryLabelPrefix: "q" | "retry";
    logPrefix: "Workflow" | "RetryWorkflow";
  },
): Promise<PaperPipelineResult> {
  try {
    const questionResult = await step.runAction(
      internal.extraction.workpoolActions.extractOneQuestion,
      {
        paperId,
        jobId,
        questionId,
        expectedEpoch,
      },
      {
        retry: true,
        name: `${retryLabelPrefix}:${paperId}:${questionKey}`,
      },
    );
    if (questionResult.status === "skipped") {
      const decision = classifyWorkerSkip(questionResult.reason);
      if (decision === "halted") {
        console.log(
          `[${logPrefix}] Halting ${paperId}:${questionKey}; worker skipped with ${questionResult.reason}`,
        );
      } else if (decision === "park") {
        console.log(
          `[${logPrefix}] Parking ${paperId}:${questionKey}; worker skipped with ${questionResult.reason}`,
        );
      }
      return decision;
    }
  } catch (error) {
    const classified = classifyUnknownError(error);
    await step.runMutation(
      internal.extraction.mutations.results.recordOneAnswerFailure,
      {
        paperId,
        questionKey,
        expectedEpoch,
        error: {
          code: classified.code,
          message: classified.message,
          retryable: classified.retryable,
          ...(classified.httpStatus !== undefined
            ? { httpStatus: classified.httpStatus }
            : {}),
          ...(classified.providerName !== undefined
            ? { providerName: classified.providerName }
            : {}),
        },
      },
      { name: `${retryLabelPrefix}fail:${paperId}:${questionKey}` },
    );
  }

  return "completed";
}

async function runQuestionBatches(
  step: ExtractionWorkflowStep,
  {
    jobId,
    paperId,
    items,
    questionConcurrency,
    retryLabelPrefix,
    haltedLogPrefix,
    expectedEpoch,
  }: {
    jobId: Id<"extractionJobs">;
    paperId: Id<"extractionPapers">;
    items: ReadonlyArray<{
      questionId: Id<"extractionQuestions">;
      questionKey: string;
    }>;
    questionConcurrency: number;
    retryLabelPrefix: "q" | "retry";
    haltedLogPrefix: "Workflow" | "RetryWorkflow";
    expectedEpoch: number;
  },
): Promise<PaperPipelineResult> {
  // No inner await on `resume:<jobId>` — multiple papers run in parallel
  // through the outer paper batch, and `step.awaitEvent` is a 1:1
  // producer-consumer per the @convex-dev/workflow event semantics.
  // Park propagates up to the outer paper batch (single park point).
  for (const batch of chunk(items, questionConcurrency)) {
    const results = await Promise.all(
      batch.map(({ questionId, questionKey }) =>
        runQuestionStep(step, {
          jobId,
          paperId,
          questionId,
          questionKey,
          expectedEpoch,
          retryLabelPrefix,
          logPrefix: haltedLogPrefix,
        }),
      ),
    );
    if (results.some((result) => result === "halted")) {
      return "halted";
    }
    if (results.some((result) => result === "park")) {
      return "park";
    }
  }
  return "completed";
}

async function runPaperPipeline(
  step: ExtractionWorkflowStep,
  {
    jobId,
    paperId,
    questionIds,
    questionConcurrency,
    pdfEnabled,
    expectedEpoch,
  }: {
    jobId: Id<"extractionJobs">;
    paperId: Id<"extractionPapers">;
    questionIds: ReadonlyArray<ExtractionQuestion>;
    questionConcurrency: number;
    pdfEnabled: boolean;
    expectedEpoch: number;
  },
): Promise<PaperPipelineResult> {
  // Fetch the paper at the step boundary so the per-paper journal entry
  // holds only one ~2-3 KB doc instead of the full Array<ExtractionPaper>
  // (~600 × 2.5 KB = 1.5 MiB) that the old by-openalex-ids round-trip
  // dumped into a single step doc.
  const paper: ExtractionPaper | null = await step.runQuery(
    internal.extraction.queries.papers.byId,
    { paperId },
  );
  if (!paper) {
    // Row deleted between persist and fan-out — treat as completed so
    // the outer batch advances rather than retrying forever.
    return "completed";
  }

  const { processable: computedProcessable } = getProcessableFlags({
    pdfUrl: paper.pdfUrl,
    storageId: paper.storageId,
    abstract: paper.abstract,
    pdfEnabled,
  });
  const isProcessable = paper.processable !== false && computedProcessable;

  if (!isProcessable) {
    await step.runMutation(
      internal.extraction.mutations.papers.updatePaperStatus,
      {
        paperId: paper._id,
        status: "download_failed",
        error: {
          code: "pdf_invalid",
          message: "No PDF URL or abstract available",
        },
        expectedEpoch,
      },
      { name: `skip:${paper._id}` },
    );
    await step.runMutation(
      internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob,
      { jobId, expectedEpoch },
      { name: `finjob:${paper._id}` },
    );
    return "completed";
  }

  await step.runMutation(
    internal.extraction.mutations.papers.updatePaperStatus,
    { paperId: paper._id, status: "downloading", expectedEpoch },
    { name: `mark-dl:${paper._id}` },
  );

  const indexed = await step.runAction(
    internal.extraction.workpoolActions.downloadAndIndexPdfAction,
    {
      paperId: paper._id,
      jobId,
      expectedEpoch,
    },
    { retry: true, name: `dl:${paper._id}` },
  );

  if (indexed.status === "skipped") {
    const decision = classifyWorkerSkip(indexed.reason);
    if (decision === "halted") {
      console.log(
        `[Workflow] Halting paper ${paper._id}; worker skipped with ${indexed.reason}`,
      );
    } else if (decision === "park") {
      console.log(
        `[Workflow] Parking paper ${paper._id}; worker skipped with ${indexed.reason}`,
      );
    }
    return decision;
  }

  if (indexed.status === "failed") {
    const code = indexed.error?.code ?? "pdf_download_failed";
    const message = indexed.error?.message ?? "Download failed";
    await step.runMutation(
      internal.extraction.mutations.papers.updatePaperStatus,
      {
        paperId: paper._id,
        status: "download_failed",
        error: { code, message },
        expectedEpoch,
      },
      { name: `fail-dl:${paper._id}` },
    );
    await step.runMutation(
      internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob,
      { jobId, expectedEpoch },
      { name: `finjob-dl:${paper._id}` },
    );
    return "completed";
  }

  await step.runMutation(
    internal.extraction.mutations.papers.updatePaperStatus,
    { paperId: paper._id, status: "extracting", expectedEpoch },
    { name: `mark-ex:${paper._id}` },
  );

  const questionBatchResult = await runQuestionBatches(step, {
    jobId,
    paperId: paper._id,
    items: questionIds.map((question) => ({
      questionId: question._id,
      questionKey: question.key,
    })),
    questionConcurrency,
    retryLabelPrefix: "q",
    haltedLogPrefix: "Workflow",
    expectedEpoch,
  });

  if (questionBatchResult !== "completed") {
    return questionBatchResult;
  }

  await step.runMutation(
    internal.extraction.mutations.results.finalizePaper,
    { paperId: paper._id },
    { name: `finpaper:${paper._id}` },
  );

  return "completed";
}

async function runRetryPaperPipeline(
  step: ExtractionWorkflowStep,
  {
    jobId,
    paperId,
    questionKeys,
    keyToId,
    questionConcurrency,
    expectedEpoch,
  }: {
    jobId: Id<"extractionJobs">;
    paperId: Id<"extractionPapers">;
    questionKeys: ReadonlyArray<string>;
    keyToId: ReadonlyMap<string, Id<"extractionQuestions">>;
    questionConcurrency: number;
    expectedEpoch: number;
  },
): Promise<PaperPipelineResult> {
  const questionBatchResult = await runQuestionBatches(step, {
    jobId,
    paperId,
    items: questionKeys.flatMap((questionKey) => {
      const questionId = keyToId.get(questionKey);
      return questionId ? [{ questionId, questionKey }] : [];
    }),
    questionConcurrency,
    retryLabelPrefix: "retry",
    haltedLogPrefix: "RetryWorkflow",
    expectedEpoch,
  });

  if (questionBatchResult !== "completed") {
    return questionBatchResult;
  }

  await step.runMutation(
    internal.extraction.mutations.results.finalizePaper,
    { paperId },
    { name: `finpaper-retry:${paperId}` },
  );

  return "completed";
}

export const runExtractionWorkflow = workflow.define({
  args: {
    jobId: v.id("extractionJobs"),
  },
  handler: async (step, { jobId }) => {
    console.log(`[Workflow] Starting extraction for job ${jobId}`);

    const job = await step.runQuery(
      internal.extraction.queries.internal.getJobInternal,
      {
        jobId,
      },
    );

    if (!job) {
      throw createError("NOT_FOUND", "Job not found");
    }
    let expectedEpoch = job.runEpoch ?? 0;
    const {
      paperConcurrency: effectivePaperConcurrency,
      questionConcurrency: effectiveQuestionConcurrency,
    } = await getEffectiveExecutionConcurrency(step, job.userId);

    const questionIds = await step.runQuery(
      internal.extraction.queries.internal.getQuestionsInternal,
      { jobId },
    );

    console.log(`[Workflow] Loaded ${questionIds.length} questions`);

    const { pdfEnabled: pdfEnabledEarly } = await step.runQuery(
      internal.extraction.queries.internal.getJobAndFlagsInternal,
      { jobId },
    );
    await step.runMutation(
      internal.extraction.mutations.results.updateJobStatus,
      {
        jobId,
        expectedEpoch,
        status: pdfEnabledEarly ? "downloading_pdfs" : "indexing",
        totalPapers: 0,
      },
    );

    // Single step boundary: the entire fetch/expand/dedupe/persist
    // sequence runs inside one action's ctx so no large array crosses a
    // workflow journal write. The action chunks createPaperRecords
    // internally and returns just the inserted IDs + counts (≈13 KB
    // for 600 papers — well under the 1 MiB single-document limit).
    const {
      paperIds,
      totalPapers,
      processableCount,
    } = await step.runAction(
      internal.extraction.actions.fetchAndPersistPapers,
      { jobId },
    );

    // Defense-in-depth: `assertBucketWithinLimits` already rejects jobs
    // whose effective paper count exceeds the user's plan cap at submit
    // time. History expansion is bounded by the per-row pull cap, so
    // this guard catches only one residual case: OpenAlex returns more
    // rows than the requested per-page cap (shouldn't happen, but we
    // fail-closed rather than silently truncate so billing stays
    // predictable). The throw is caught by `handleExtractionJobComplete`
    // which marks the job `failed` with this error message.
    const paperLimit: number = await step.runQuery(
      internal.extraction.bucket.limits.getPaperLimitForUser,
      { userId: job.userId },
    );
    if (totalPapers > paperLimit) {
      throw createError(
        "VALIDATION_ERROR",
        `Job would produce ${totalPapers} papers, exceeding plan limit of ${paperLimit}`,
      );
    }

    const controlAfterExpansion = await waitWhilePausedOrCancelled(step, jobId);
    if (controlAfterExpansion.status === "cancelled") {
      console.log(`[Workflow] Cancelled before paper creation; halting`);
      return;
    }
    expectedEpoch = controlAfterExpansion.runEpoch;

    const { pdfEnabled } = await step.runQuery(
      internal.extraction.queries.internal.getJobAndFlagsInternal,
      { jobId },
    );

    await step.runMutation(
      internal.extraction.mutations.results.updateJobStatus,
      {
        jobId,
        expectedEpoch,
        status: pdfEnabled ? "downloading_pdfs" : "indexing",
        totalPapers: processableCount,
      },
    );

    // Without this, maybeFinalizeJob never fires for a zero-paper run and the job strands in `extracting`.
    if (paperIds.length === 0) {
      await step.runMutation(
        internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob,
        { jobId, expectedEpoch },
      );
      console.log(`[Workflow] No papers to process — job finalized`);
      return;
    }

    // Pre-plan-02 flipped the job to "extracting" after the async
    // enqueue loop. The handler now awaits the per-paper pipeline
    // synchronously, so we flip upfront — otherwise the UI would sit
    // in "indexing" for the whole run.
    await step.runMutation(
      internal.extraction.mutations.results.updateJobStatus,
      {
        jobId,
        expectedEpoch,
        status: "extracting",
      },
    );

    console.log(
      `[Workflow] Fanning out ${paperIds.length} papers × ${questionIds.length} questions in paper batches of ${effectivePaperConcurrency} and question batches of ${effectiveQuestionConcurrency}`,
    );

    const paperBatchResult = await runBoundedBatches({
      items: paperIds,
      batchSize: effectivePaperConcurrency,
      waitForNextBatch: async () => {
        const control = await waitWhilePausedOrCancelled(step, jobId);
        if (control.status === "cancelled") {
          console.log(`[Workflow] Cancelled before next paper batch; halting`);
          return null;
        }
        return control;
      },
      runItem: async (paperId, control) =>
        step.runWorkflow(
          internal.extraction.workflow.paperPipelineWorkflow,
          {
            jobId,
            paperId,
            expectedEpoch: control.runEpoch,
            pdfEnabled,
            questionConcurrency: effectiveQuestionConcurrency,
          },
          { name: `pp:${paperId}` },
        ),
    });

    if (paperBatchResult === "halted") {
      return;
    }

    console.log(`[Workflow] Per-question fan-out complete for job ${jobId}`);
  },
});

/**
 * Plan-06 cooperative pause gate. Reads the job status; if paused or
 * creditsExhausted, blocks on `step.awaitEvent({ name: 'resume:<id>' })`
 * until the resume mutation fires `sendEvent`. After waking, re-reads
 * status (the user may have cancelled instead of resumed) and returns
 * the post-wait status to the caller. Cancelled is bubbled up so the
 * workflow loop can exit cleanly without further dispatches.
 *
 * Returns the post-wait status. Cancellation handling is the caller's
 * responsibility.
 */
async function waitWhilePausedOrCancelled(
  step: ExtractionWorkflowStep,
  jobId: Id<"extractionJobs">,
): Promise<JobControl> {
  let control = await step.runQuery(
    internal.extraction.queries.internal.getJobStatusInternal,
    { jobId },
  );
  while (control.status === "paused" || control.status === "creditsExhausted") {
    await step.awaitEvent({ name: `resume:${jobId}` });
    control = await step.runQuery(
      internal.extraction.queries.internal.getJobStatusInternal,
      { jobId },
    );
  }
  return control;
}

/**
 * Plan-05 retry workflow.
 *
 * Secondary workflow fired by `retryFailedQuestions`. The mutation has
 * already:
 *   1. Reset every retryable failed result to status "pending"
 *      (status === "failed" ∧ isResultRetryableFailure ∧ billed !== true).
 *   2. Flipped the containing papers back to "extracting".
 *   3. Flipped the job back to "extracting".
 *
 * All this workflow does is re-dispatch `extractOneQuestion` for each
 * pending (paperId, questionKey) pair and call `finalizePaper` per
 * paper. Download + indexing are NOT re-run; retry reuses the
 * already-indexed PDF (see `indexingBilled` guard in the mutation).
 *
 * Pre-plan-06: this is a separate workflow. Once plan 06 lands with
 * `awaitEvent`, retry becomes `sendEvent` into the paused workflow and
 * this export is removed.
 */
export const runRetryWorkflow = workflow.define({
  args: {
    jobId: v.id("extractionJobs"),
  },
  handler: async (step, { jobId }) => {
    console.log(`[RetryWorkflow] Starting retry for job ${jobId}`);
    const jobControl = await step.runQuery(
      internal.extraction.queries.internal.getJobStatusInternal,
      { jobId },
    );
    let expectedEpoch = jobControl.runEpoch;
    const job = await step.runQuery(
      internal.extraction.queries.internal.getJobInternal,
      {
        jobId,
      },
    );
    if (!job) {
      throw createError("NOT_FOUND", "Job not found");
    }
    const {
      paperConcurrency: effectivePaperConcurrency,
      questionConcurrency: effectiveQuestionConcurrency,
    } = await getEffectiveExecutionConcurrency(step, job.userId);

    const questionList = await step.runQuery(
      internal.extraction.queries.internal.getQuestionsInternal,
      { jobId },
    );
    const keyToId = new Map<string, Id<"extractionQuestions">>(
      questionList.map((q) => [q.key, q._id]),
    );

    const pending = await step.runQuery(
      internal.extraction.queries.internal.getPendingResultsInternal,
      { jobId },
    );

    if (pending.length === 0) {
      console.log(`[RetryWorkflow] Nothing pending for job ${jobId}`);
      // Still trigger maybeFinalizeJob so the job status aggregator
      // settles on the right terminal state (covers a race where the
      // mutation reset rows but the workflow sees zero on its first read).
      await step.runMutation(
        internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob,
        { jobId, expectedEpoch },
      );
      return;
    }

    // Group pending results by paperId for per-paper fan-out +
    // finalizePaper call.
    const byPaper = new Map<Id<"extractionPapers">, string[]>();
    for (const r of pending) {
      const existing = byPaper.get(r.paperId);
      if (existing) existing.push(r.questionKey);
      else byPaper.set(r.paperId, [r.questionKey]);
    }

    console.log(
      `[RetryWorkflow] Re-dispatching ${pending.length} question(s) across ${byPaper.size} paper(s) in batches of ${effectivePaperConcurrency}`,
    );

    const retryBatchResult = await runBoundedBatches({
      items: Array.from(byPaper.entries()),
      batchSize: effectivePaperConcurrency,
      waitForNextBatch: async () => {
        const control = await waitWhilePausedOrCancelled(step, jobId);
        if (control.status === "cancelled") {
          console.log(
            `[RetryWorkflow] Cancelled before next paper batch; halting`,
          );
          return null;
        }
        return control;
      },
      runItem: async ([paperId, questionKeys], control) =>
        step.runWorkflow(
          internal.extraction.workflow.retryPaperPipelineWorkflow,
          {
            jobId,
            paperId,
            questionKeys,
            expectedEpoch: control.runEpoch,
            questionConcurrency: effectiveQuestionConcurrency,
          },
          { name: `rpp:${paperId}` },
        ),
    });

    if (retryBatchResult === "halted") {
      return;
    }

    console.log(`[RetryWorkflow] Retry fan-out complete for job ${jobId}`);
  },
});

/**
 * Tier A child workflow — runs one paper's full extraction pipeline
 * (downloadAndIndex → per-question fan-out → finalizePaper) in its own
 * journal. Launched from `runExtractionWorkflow` via `step.runWorkflow`,
 * which awaits the child's return value (`PaperPipelineResult`).
 *
 * The child re-fetches its question list rather than receiving it as
 * an arg — keeps the parent step's argument payload tiny (just IDs +
 * primitives) so the parent journal never bloats with per-paper
 * question docs.
 */
export const paperPipelineWorkflow = workflow.define({
  args: {
    jobId: v.id("extractionJobs"),
    paperId: v.id("extractionPapers"),
    expectedEpoch: v.number(),
    pdfEnabled: v.boolean(),
    questionConcurrency: v.number(),
  },
  returns: paperPipelineResultValidator,
  handler: async (
    step,
    { jobId, paperId, expectedEpoch, pdfEnabled, questionConcurrency },
  ): Promise<PaperPipelineResult> => {
    const questionIds = await step.runQuery(
      internal.extraction.queries.internal.getQuestionsInternal,
      { jobId },
    );
    return await runPaperPipeline(step, {
      jobId,
      paperId,
      questionIds,
      questionConcurrency,
      pdfEnabled,
      expectedEpoch,
    });
  },
});

/**
 * Tier A retry child workflow — runs one paper's retry pipeline
 * (re-dispatch only the listed `questionKeys` then finalizePaper) in
 * its own journal. Launched from `runRetryWorkflow` via
 * `step.runWorkflow`. Download + indexing are NOT re-run; the per-
 * question worker honors the existing `indexingBilled` guard.
 */
export const retryPaperPipelineWorkflow = workflow.define({
  args: {
    jobId: v.id("extractionJobs"),
    paperId: v.id("extractionPapers"),
    questionKeys: v.array(v.string()),
    expectedEpoch: v.number(),
    questionConcurrency: v.number(),
  },
  returns: paperPipelineResultValidator,
  handler: async (
    step,
    { jobId, paperId, questionKeys, expectedEpoch, questionConcurrency },
  ): Promise<PaperPipelineResult> => {
    const questionList = await step.runQuery(
      internal.extraction.queries.internal.getQuestionsInternal,
      { jobId },
    );
    const keyToId = new Map<string, Id<"extractionQuestions">>(
      questionList.map((q) => [q.key, q._id]),
    );
    return await runRetryPaperPipeline(step, {
      jobId,
      paperId,
      questionKeys,
      keyToId,
      questionConcurrency,
      expectedEpoch,
    });
  },
});
