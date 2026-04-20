/**
 * Extraction workflow — plan-02 per-question decomposition.
 *
 * The handler owns every paper's pipeline end-to-end via
 * `step.runAction` + `step.runMutation`, so the 10-minute ceiling is
 * now per-question (≤ 1 LLM call + 1 dense search) instead of
 * per-paper-with-all-questions. The earlier workpool `onComplete`
 * chain (handleDownloadAndIndexComplete → waitAndExtractAction →
 * handleExtractionComplete) is retired in plan-02 step 5.
 */

import { workflow } from "../workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { getProcessableFlags } from "./content";
import type { PaperData } from "./types";
import type { Id } from "../_generated/dataModel";
import { dedupeExpandedSources, expandJobSources } from "./expandSources";

import { createError } from "../lib/errors";
import { classifyUnknownError } from "@/lib/errors/taxonomy";
import type { WorkflowCtx } from "@convex-dev/workflow";

export const runExtractionWorkflow = workflow.define({
  args: {
    jobId: v.id("extractionJobs"),
  },
  handler: async (step, { jobId }) => {
    console.log(`[Workflow] Starting extraction for job ${jobId}`);

    const job = await step.runQuery(internal.extraction.queries.internal.getJobInternal, {
      jobId,
    });

    if (!job) {
      throw createError("NOT_FOUND", "Job not found");
    }

    const questionIds = await step.runQuery(
      internal.extraction.queries.internal.getQuestionsInternal,
      { jobId }
    );

    console.log(`[Workflow] Loaded ${questionIds.length} questions`);

    const { pdfEnabled: pdfEnabledEarly } = await step.runQuery(
      internal.extraction.queries.internal.getJobAndFlagsInternal,
      { jobId },
    );
    await step.runMutation(internal.extraction.mutations.results.updateJobStatus, {
      jobId,
      status: pdfEnabledEarly ? "downloading_pdfs" : "indexing",
      totalPapers: 0,
    });

    const bucketItems = await step.runQuery(
      internal.extraction.queries.internal.getJobSourcesInternal,
      { jobId },
    );

    let cachedZoteroUserId: string | undefined;

    const expandedSources = await expandJobSources(bucketItems, {
      fetchPapersFromHistory: async (searchFilters) => {
        const result = await step.runAction(
          internal.extraction.actions.fetchPapersFromHistory,
          { searchFilters },
        );
        return result as PaperData[];
      },
      resolveZoteroUserId: async () => {
        if (cachedZoteroUserId !== undefined) {
          return cachedZoteroUserId;
        }
        try {
          const resolved = await step.runQuery(
            internal.zotero.queries.getZoteroUserIdInternal,
            {},
          );
          cachedZoteroUserId = resolved ?? undefined;
        } catch {
          cachedZoteroUserId = undefined;
        }
        return cachedZoteroUserId;
      },
    });

    if (expandedSources.length === 0) {
      throw createError("VALIDATION_ERROR", "No sources selected");
    }

    const dedupedPapers = dedupeExpandedSources(expandedSources).map(
      ({ paper, sourceType, sourceId }) => ({
        ...paper,
        sourceType,
        sourceId,
      }),
    );

    console.log(
      `[Workflow] Fetched ${expandedSources.length} papers (${dedupedPapers.length} deduped)`,
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
    if (dedupedPapers.length > paperLimit) {
      throw createError(
        "VALIDATION_ERROR",
        `Job would produce ${dedupedPapers.length} papers, exceeding plan limit of ${paperLimit}`,
      );
    }

    await step.runMutation(internal.extraction.mutations.papers.createPaperRecords, {
      jobId,
      papers: dedupedPapers.map((p) => ({
        ...p,
        storageId: p.storageId as Id<"_storage"> | undefined,
      })),
    });

    const paperIds = await step.runQuery(
      internal.extraction.queries.papers.byOpenAlexIds,
      {
        jobId,
        openalexIds: dedupedPapers.map((p) => p.openalexId),
      }
    );

    const processableCount = paperIds.filter(
      (paper: { processable?: boolean }) => paper.processable !== false,
    ).length;

    const { pdfEnabled } = await step.runQuery(
      internal.extraction.queries.internal.getJobAndFlagsInternal,
      { jobId },
    );

    await step.runMutation(internal.extraction.mutations.results.updateJobStatus, {
      jobId,
      status: pdfEnabled ? "downloading_pdfs" : "indexing",
      totalPapers: processableCount,
    });

    // Without this, maybeFinalizeJob never fires for a zero-paper run and the job strands in `extracting`.
    if (paperIds.length === 0) {
      await step.runMutation(
        internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob,
        { jobId },
      );
      console.log(`[Workflow] No papers to process — job finalized`);
      return;
    }

    // Pre-plan-02 flipped the job to "extracting" after the async
    // enqueue loop. The handler now awaits the per-paper pipeline
    // synchronously, so we flip upfront — otherwise the UI would sit
    // in "indexing" for the whole run.
    await step.runMutation(internal.extraction.mutations.results.updateJobStatus, {
      jobId,
      status: "extracting",
    });

    console.log(
      `[Workflow] Fanning out ${paperIds.length} papers × ${questionIds.length} questions`,
    );

    // Plan-06 cooperative pause/resume. The handler iterates papers
    // serially so a single `step.awaitEvent({ name: 'resume:<jobId>' })`
    // gate is sufficient — only one waiter is ever blocked. Resume
    // sends one event; the gate wakes; the loop continues.
    //
    // This is a measured concession on per-paper parallelism (was
    // Promise.all bounded by workpool maxParallelism=10 — see plan 06
    // § Approach). The plan's grill explicitly accepted this in exchange
    // for correctness without a relay/per-cycle-event-name scheme.
    //
    // Within a paper, the question loop is also serial — same reason.
    // The gate before each question lets pause take effect at question
    // granularity (matching plan 02's per-question billing unit).
    for (const paper of paperIds) {
      // Paper-level gate.
      const paperStatus = await waitWhilePausedOrCancelled(step, jobId);
      if (paperStatus === "cancelled") {
        console.log(`[Workflow] Cancelled before paper ${paper._id}; halting`);
        return;
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
          },
          { name: `skip:${paper._id}` },
        );
        await step.runMutation(
          internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob,
          { jobId },
          { name: `finjob:${paper._id}` },
        );
        continue;
      }

      // 1. Flip paper to "downloading" so the UI reflects the stage
      // transition. Status validator also covers the "pending →
      // downloading → extracting → completed" happy path.
      await step.runMutation(
        internal.extraction.mutations.papers.updatePaperStatus,
        { paperId: paper._id, status: "downloading" },
        { name: `mark-dl:${paper._id}` },
      );

      // 2. Download + index. Auto-retries transient failures via the
      // workflow component's retry budget.
      const indexed = await step.runAction(
        internal.extraction.workpoolActions.downloadAndIndexPdfAction,
        {
          paperId: paper._id,
          jobId,
          pdfUrl: paper.pdfUrl || "",
          storageId: paper.storageId,
          title: paper.title,
          abstract: paper.abstract,
          doi: paper.doi,
        },
        { retry: true, name: `dl:${paper._id}` },
      );

      if (!indexed.success) {
        const code = indexed.error?.code ?? "pdf_download_failed";
        const message = indexed.error?.message ?? "Download failed";
        await step.runMutation(
          internal.extraction.mutations.papers.updatePaperStatus,
          {
            paperId: paper._id,
            status: "download_failed",
            error: { code, message },
          },
          { name: `fail-dl:${paper._id}` },
        );
        await step.runMutation(
          internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob,
          { jobId },
          { name: `finjob-dl:${paper._id}` },
        );
        continue;
      }

      // 3. Flip paper to "extracting" for the question fan-out.
      await step.runMutation(
        internal.extraction.mutations.papers.updatePaperStatus,
        { paperId: paper._id, status: "extracting" },
        { name: `mark-ex:${paper._id}` },
      );

      // 4. Per-question loop with gate at each iteration. Sequential
      // dispatch — see top-of-loop note. On exhausted retries, the
      // step throws; the catch persists a terminal failure row so
      // finalizePaper can aggregate it.
      for (const q of questionIds) {
        const qStatus = await waitWhilePausedOrCancelled(step, jobId);
        if (qStatus === "cancelled") {
          console.log(
            `[Workflow] Cancelled mid-paper ${paper._id}; halting`,
          );
          return;
        }

        try {
          await step.runAction(
            internal.extraction.workpoolActions.extractOneQuestion,
            {
              paperId: paper._id,
              jobId,
              questionId: q._id,
            },
            { retry: true, name: `q:${paper._id}:${q.key}` },
          );
        } catch (error) {
          const classified = classifyUnknownError(error);
          await step.runMutation(
            internal.extraction.mutations.results.recordOneAnswerFailure,
            {
              paperId: paper._id,
              questionKey: q.key,
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
            { name: `qfail:${paper._id}:${q.key}` },
          );
        }
      }

      // 5. Fold question-level rows into the paper's terminal status.
      await step.runMutation(
        internal.extraction.mutations.results.finalizePaper,
        { paperId: paper._id },
        { name: `finpaper:${paper._id}` },
      );
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
  step: WorkflowCtx,
  jobId: Id<"extractionJobs">,
): Promise<string | null> {
  let status = await step.runQuery(
    internal.extraction.queries.internal.getJobStatusInternal,
    { jobId },
  );
  while (status === "paused" || status === "creditsExhausted") {
    await step.awaitEvent({ name: `resume:${jobId}` });
    status = await step.runQuery(
      internal.extraction.queries.internal.getJobStatusInternal,
      { jobId },
    );
  }
  return status;
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
        { jobId },
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
      `[RetryWorkflow] Re-dispatching ${pending.length} question(s) across ${byPaper.size} paper(s)`,
    );

    await Promise.all(
      [...byPaper.entries()].map(async ([paperId, questionKeys]) => {
        await Promise.all(
          questionKeys.map(async (questionKey) => {
            const questionId = keyToId.get(questionKey);
            if (!questionId) {
              // Question deleted since the row was created — can't retry.
              return;
            }
            try {
              await step.runAction(
                internal.extraction.workpoolActions.extractOneQuestion,
                { paperId, jobId, questionId },
                { retry: true, name: `retry:${paperId}:${questionKey}` },
              );
            } catch (error) {
              const classified = classifyUnknownError(error);
              await step.runMutation(
                internal.extraction.mutations.results.recordOneAnswerFailure,
                {
                  paperId,
                  questionKey,
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
                { name: `qfail-retry:${paperId}:${questionKey}` },
              );
            }
          }),
        );

        await step.runMutation(
          internal.extraction.mutations.results.finalizePaper,
          { paperId },
          { name: `finpaper-retry:${paperId}` },
        );
      }),
    );

    console.log(`[RetryWorkflow] Retry fan-out complete for job ${jobId}`);
  },
});
