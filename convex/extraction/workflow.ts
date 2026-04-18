/**
 * Extraction Workflow using Workpool
 * Proper pattern for self-hosted Convex with durable execution
 */

import { workflow } from "../workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { pdfProcessingPool } from "../workpool";
import { getProcessableFlags } from "./content";
import { buildDedupeKey } from "./dedupe";
import type { PaperData } from "./types";
import type { Id } from "../_generated/dataModel";
import type { BucketItemInput } from "./jobSources";

import { createError } from "../lib/errors";

type SourceType = "history" | "zotero" | "manual";
type WorkflowPaper = PaperData & {
  sourceType: SourceType;
  sourceId: string;
};

function paperSourceFromBucket(source: BucketItemInput["source"]): SourceType {
  if (source === "history") return "history";
  if (source === "zotero") return "zotero";
  return "manual";
}

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

    const pdfEnabledEarly = await step.runQuery(
      internal.extraction.queries.internal.getPdfExtractionEnabledInternal,
      {}
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

    const papers: WorkflowPaper[] = [];
    let cachedZoteroUserId: string | undefined;

    for (const item of bucketItems) {
      if (item.source === "history" && item.searchFilters) {
        // Mirror `paperCountForItem`'s zero-collapse rule: any defined
        // limit that is non-finite or <= 0 contributes 0 papers to the
        // effective count, so `assertBucketWithinLimits` already treats
        // it as "skip this row". Match that here — otherwise a crafted
        // limit: -1 passes submit-time validation, reaches
        // `fetchPapersFromHistory`, and then `buildOpenAlexSearchParams`
        // throws on `< 1`, failing the workflow after the job exists.
        const limit = item.searchFilters.limit;
        if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
          console.log(
            `[Workflow] Skipping zero-count history source ${item.sourceRefId} (limit=${limit})`,
          );
          continue;
        }
        // Saved-search placeholder expands to papers at workflow time.
        const result = await step.runAction(
          internal.extraction.actions.fetchPapersFromHistory,
          { searchFilters: item.searchFilters },
        );
        const enriched = (result as PaperData[]).map((paper) => ({
          ...paper,
          sourceType: "history" as const,
          sourceId: item.sourceRefId,
        }));
        papers.push(...enriched);
        continue;
      }

      if (item.source === "zotero") {
        const libraryType = item.libraryType ?? "user";
        const groupId = item.groupId;
        let zoteroUserId = item.zoteroUserId;
        if (!zoteroUserId && libraryType === "user") {
          if (cachedZoteroUserId === undefined) {
            try {
              const resolved = await step.runQuery(
                internal.zotero.queries.getZoteroUserIdInternal,
                {},
              );
              cachedZoteroUserId = resolved ?? undefined;
            } catch {
              cachedZoteroUserId = undefined;
            }
          }
          zoteroUserId = cachedZoteroUserId;
        }
        const uri =
          libraryType === "group" && groupId
            ? `zotero://select/groups/${groupId}/items/${item.sourceRefId}`
            : zoteroUserId
              ? `zotero://select/users/${zoteroUserId}/items/${item.sourceRefId}`
              : undefined;
        papers.push({
          openalexId: `zotero:${libraryType}:${item.sourceRefId}`,
          title: item.title,
          doi: item.doi,
          publicationYear: item.year,
          abstract: item.abstract,
          authors: item.authors,
          pdfUrl: uri,
          isOpenAccess: false,
          sourceType: "zotero",
          sourceId: item.sourceRefId,
        });
        continue;
      }

      // history (per-paper), library, collection, upload → processed directly
      papers.push({
        openalexId: item.openalexId ?? `${item.source}:${item.sourceRefId}`,
        title: item.title,
        doi: item.doi,
        publicationYear: item.year,
        abstract: item.abstract,
        authors: item.authors,
        pdfUrl: item.pdfUrl,
        storageId: item.storageId,
        isOpenAccess: false,
        sourceType: paperSourceFromBucket(item.source),
        sourceId: item.sourceRefId,
      });
    }

    if (papers.length === 0) {
      throw createError("VALIDATION_ERROR", "No sources selected");
    }

    const dedupedMap = new Map<string, WorkflowPaper>();
    for (const paper of papers) {
      const key = buildDedupeKey({
        openalexId: paper.openalexId,
        doi: paper.doi,
        title: paper.title,
        year: paper.publicationYear,
      });
      if (!dedupedMap.has(key)) {
        dedupedMap.set(key, paper);
      }
    }
    const dedupedPapers = Array.from(dedupedMap.values());

    console.log(`[Workflow] Fetched ${papers.length} papers (${dedupedPapers.length} deduped)`);

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
      (paper) => paper.processable !== false
    ).length;

    const pdfEnabled = await step.runQuery(
      internal.extraction.queries.internal.getPdfExtractionEnabledInternal,
      {}
    );

    await step.runMutation(internal.extraction.mutations.results.updateJobStatus, {
      jobId,
      status: pdfEnabled ? "downloading_pdfs" : "indexing",
      totalPapers: processableCount,
    });

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
