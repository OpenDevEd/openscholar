/**
 * Extraction workflow — Tier A per-paper sub-workflow decomposition,
 * plus Tier E.1 root-detach.
 *
 * Tier A split each paper into its own child workflow
 * (`paperPipelineWorkflow` / `retryPaperPipelineWorkflow`) so per-step
 * journal entries lived on the child, not the parent.
 *
 * Tier E.1 then drops the parent/child tether entirely. The setup
 * workflows (`runExtractionWorkflow` / `runRetryWorkflow`) do
 * pre-fan-out work (fetch papers, validation, status flips, the
 * `waitWhilePausedOrCancelled` gate), then hand off to
 * `launchPaperWorkflowsForJob` — an internal mutation that
 * `workflow.start`s each paper workflow as a ROOT (no parent step
 * waiting on its return). The setup workflow exits immediately
 * afterwards.
 *
 * Why detach? `step.runWorkflow` made every child's
 * `nestedWorkflowOnComplete` re-read the parent's row, insert a step
 * row on the parent, and re-enqueue the parent in
 * `pendingStart` / `pendingCompletion`. With 50 concurrent paper
 * workflows that's four hot tables, all keyed by the same parent
 * workflowId, contended by 50 writers per job. Detach kills the
 * shared keyspace.
 *
 * Job rollup after detach: the per-job sharded counter
 * (`jobCounters.ts`) still drives `maybeFinalizeJob` — every terminal
 * paper bumps the counter and the counter-driven check transitions
 * the job to `completed` / `failed`. No parent workflow needed.
 *
 * Pause / resume after detach: paper workflows do NOT awaitEvent
 * (multi-listener fan-out isn't supported by the workflow component's
 * 1:1 event channel). On park reason, the paper workflow exits
 * cleanly. `resumeExtraction` bumps `runEpoch` and re-launches a paper
 * workflow per non-terminal paper. Stale in-flight workflows
 * self-terminate at their next step via the `expectedEpoch` check.
 *
 * Cancel after detach: `cancelExtraction` flips `job.status` to
 * `"cancelled"` and cancels only the setup workflow. Paper workflows
 * detect cancellation via their next action's `getWorkerSkipReason`
 * check and exit cleanly.
 */

import { workflow } from "../workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { getProcessableFlags } from "./content";
import type { Doc, Id } from "../_generated/dataModel";
import { chunk, resolveBoundedConcurrency } from "./batching";
import { EXTRACTION_QUESTION_CONCURRENCY_INFRA_CLAMP } from "./bucket/limits";

import { createError } from "../lib/errors";
import { classifyUnknownError } from "@/lib/errors/taxonomy";
import type { WorkflowCtx } from "@convex-dev/workflow";

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

async function getEffectiveQuestionConcurrency(
  step: ExtractionWorkflowStep,
  userId: Id<"users">,
): Promise<number> {
  const executionLimits = await step.runQuery(
    internal.extraction.bucket.limits.getExtractionExecutionLimitsForUser,
    { userId },
  );
  return resolveBoundedConcurrency(
    executionLimits.questionConcurrencyPerPaper,
    EXTRACTION_QUESTION_CONCURRENCY_INFRA_CLAMP,
  );
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
    const effectiveQuestionConcurrency =
      await getEffectiveQuestionConcurrency(step, job.userId);

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

    // Tier E.1 detach: hand each paper to a ROOT workflow via
    // `launchPaperWorkflowsForJob`. No `step.runWorkflow` → no shared
    // parent journal → 50 concurrent paper workflows write to disjoint
    // workflowIds instead of contending on a single parent row.
    const controlBeforeFanOut = await waitWhilePausedOrCancelled(step, jobId);
    if (controlBeforeFanOut.status === "cancelled") {
      console.log(`[Workflow] Cancelled before fan-out; halting`);
      return;
    }
    expectedEpoch = controlBeforeFanOut.runEpoch;

    const { launched, reserved, creditsExhausted } = await step.runMutation(
      internal.extraction.mutations.internal.fanout.launchPaperWorkflowsForJob,
      {
        jobId,
        paperIds,
        expectedEpoch,
        pdfEnabled,
        questionConcurrency: effectiveQuestionConcurrency,
      },
    );

    if (creditsExhausted) {
      console.log(
        `[Workflow] Fan-out aborted: insufficient credits for ${paperIds.length} paper(s); job ${jobId} → creditsExhausted`,
      );
      return;
    }

    console.log(
      `[Workflow] Detached ${launched} paper workflow(s) for job ${jobId} (${reserved} freshly reserved); setup workflow exiting`,
    );
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
    const effectiveQuestionConcurrency =
      await getEffectiveQuestionConcurrency(step, job.userId);

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

    // Tier E.1 detach: see runExtractionWorkflow above for rationale.
    const controlBeforeFanOut = await waitWhilePausedOrCancelled(step, jobId);
    if (controlBeforeFanOut.status === "cancelled") {
      console.log(`[RetryWorkflow] Cancelled before fan-out; halting`);
      return;
    }
    expectedEpoch = controlBeforeFanOut.runEpoch;

    const { launched } = await step.runMutation(
      internal.extraction.mutations.internal.fanout
        .launchRetryPaperWorkflowsForJob,
      {
        jobId,
        paperWork: Array.from(byPaper.entries()).map(
          ([paperId, questionKeys]) => ({ paperId, questionKeys }),
        ),
        expectedEpoch,
        questionConcurrency: effectiveQuestionConcurrency,
      },
    );

    console.log(
      `[RetryWorkflow] Detached ${launched} retry paper workflow(s) for job ${jobId}; setup workflow exiting`,
    );
  },
});

/**
 * Per-paper extraction pipeline (download → index → per-question
 * fan-out → finalizePaper). Tier A gave it its own journal; Tier E.1
 * promotes it to a ROOT workflow launched from the
 * `launchPaperWorkflowsForJob` mutation. No parent step awaits this
 * workflow's return value — terminal outcomes feed the job-level
 * sharded counter in `markPaperTerminalTx`, and the
 * counter-driven `maybeFinalizeJob` settles the job status.
 *
 * The workflow re-fetches its question list at boot so the launch
 * mutation's argument payload stays IDs + primitives — keeps the
 * mutation's tx small even when fanning out hundreds of papers.
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
 * Per-paper retry pipeline — re-dispatch only the listed
 * `questionKeys` then finalizePaper. Tier E.1 promotes it to a ROOT
 * workflow launched from `launchRetryPaperWorkflowsForJob`. Download +
 * indexing are NOT re-run; the per-question worker honours the
 * existing `indexingBilled` guard.
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
