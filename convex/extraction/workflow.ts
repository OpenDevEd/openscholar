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

    // Per-paper pipeline in parallel. Concurrency is bounded by the
    // workflow component's own workpool (maxParallelism = 10 — see
    // `convex/workflow.ts`). Each paper runs: download+index → N
    // `extractOneQuestion` steps in parallel → finalizePaper.
    await Promise.all(
      paperIds.map(async (paper) => {
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
          return;
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
          return;
        }

        // 3. Flip paper to "extracting" for the question fan-out.
        await step.runMutation(
          internal.extraction.mutations.papers.updatePaperStatus,
          { paperId: paper._id, status: "extracting" },
          { name: `mark-ex:${paper._id}` },
        );

        // 4. Fan out one step per question. On exhausted retries, the
        // workflow step throws; the catch persists a terminal failure
        // row so finalizePaper can aggregate it.
        await Promise.all(
          questionIds.map(async (q) => {
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
          }),
        );

        // 5. Fold question-level rows into the paper's terminal status.
        await step.runMutation(
          internal.extraction.mutations.results.finalizePaper,
          { paperId: paper._id },
          { name: `finpaper:${paper._id}` },
        );
      }),
    );

    console.log(`[Workflow] Per-question fan-out complete for job ${jobId}`);
  },
});
