/**
 * Extraction Workflow using Workpool
 * Proper pattern for self-hosted Convex with durable execution
 */

import { workflow } from "../workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { pdfProcessingPool } from "../workpool";
import { getProcessableFlags } from "./content";
import type { PaperData } from "./types";
import type { Id } from "../_generated/dataModel";
import { dedupeExpandedSources, expandJobSources } from "./expandSources";

import { createError } from "../lib/errors";

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

    const questionsRaw = await step.runQuery(
      internal.extraction.queries.internal.getQuestionsInternal,
      { jobId }
    );

    const questions = questionsRaw.map((q: { key: string; question: string; type: "string" | "boolean" | "number" | "array"; description?: string }) => ({
      key: q.key,
      question: q.question,
      type: q.type,
      description: q.description,
    }));

    console.log(`[Workflow] Loaded ${questions.length} questions`);

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

    console.log(`[Workflow] Enqueueing ${paperIds.length} papers for processing`);

    let enqueuedCount = 0;
    for (const paper of paperIds) {
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
            errorMessage: "No PDF URL or abstract available",
          }
        );
        await step.runMutation(internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, {
          jobId,
        });
        continue;
      }

      await step.runMutation(
        internal.extraction.mutations.internal.lifecycle.enqueuePaperProcessing,
        {
          paperId: paper._id,
          jobId,
          pdfUrl: paper.pdfUrl || "",
          storageId: paper.storageId,
          title: paper.title,
          abstract: paper.abstract,
          doi: paper.doi,
          questions,
        }
      );

      enqueuedCount++;
    }

    console.log(`[Workflow] Enqueued ${enqueuedCount} papers for processing`);

    await step.runMutation(internal.extraction.mutations.results.updateJobStatus, {
      jobId,
      status: "extracting",
    });

    console.log(`[Workflow] Complete - papers processing asynchronously`);
  },
});
