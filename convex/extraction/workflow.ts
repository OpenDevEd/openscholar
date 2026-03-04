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

import { createError } from "../lib/errors";

type SourceType = "history" | "zotero" | "manual";
type WorkflowPaper = PaperData & {
  sourceType: SourceType;
  sourceId: string;
};

export const runExtractionWorkflow = workflow.define({
  args: {
    jobId: v.id("extractionJobs"),
  },
  handler: async (step, { jobId }) => {
    console.log(`[Workflow] Starting extraction for job ${jobId}`);

    // Step 1: Get job details and questions
    const job = await step.runQuery(internal.extraction.queries.getJobInternal, {
      jobId,
    });

    if (!job) {
      throw createError("NOT_FOUND", "Job not found");
    }

    const questionsRaw = await step.runQuery(
      internal.extraction.queries.getQuestionsInternal,
      { jobId }
    );

    const questions = questionsRaw.map((q: { key: string; question: string; type: "string" | "boolean" | "number" | "array"; description?: string }) => ({
      key: q.key,
      question: q.question,
      type: q.type,
      description: q.description,
    }));

    console.log(`[Workflow] Loaded ${questions.length} questions`);

    // Step 2: Fetch papers from sources
    await step.runMutation(internal.extraction.mutations.updateJobStatus, {
      jobId,
      status: "downloading_pdfs",
      totalPapers: 0,
    });

    const papers: WorkflowPaper[] = [];
    const historyEntries = Array.isArray(job.sourceHistoryEntries)
      ? job.sourceHistoryEntries
      : job.searchFilters
      ? [{ historyId: job.sourceHistoryId || "history", searchFilters: job.searchFilters }]
      : [];

    for (const entry of historyEntries) {
      const result = await step.runAction(
        internal.extraction.actions.fetchPapersFromHistory,
        { searchFilters: entry.searchFilters }
      );
      const enriched = (result as PaperData[]).map((paper) => ({
        ...paper,
        sourceType: "history" as const,
        sourceId: entry.historyId,
      }));
      papers.push(...enriched);
    }

    if (job.sourceZoteroSelection?.items?.length) {
        let zoteroUserId: string | undefined = job.sourceZoteroSelection?.zoteroUserId;
      if (!zoteroUserId) {
        try {
          const resolved = await step.runQuery(internal.zotero.queries.getZoteroUserIdInternal, {});
          zoteroUserId = resolved ?? undefined;
        } catch (error) {
          zoteroUserId = undefined;
        }
      }
      const zoteroItems = job.sourceZoteroSelection.items.map((item: { itemKey: string; title: string; doi?: string; year?: number; abstract?: string; authors: string[] }) => {
        const libraryType = job.sourceZoteroSelection?.libraryType;
        const groupId = job.sourceZoteroSelection?.groupId;
        const uri = libraryType === "group" && groupId
          ? `zotero://select/groups/${groupId}/items/${item.itemKey}`
          : zoteroUserId
            ? `zotero://select/users/${zoteroUserId}/items/${item.itemKey}`
            : undefined;

        return {
          openalexId: `zotero:${libraryType}:${item.itemKey}`,
          title: item.title,
          doi: item.doi,
          publicationYear: item.year,
          abstract: item.abstract,
          authors: item.authors,
          pdfUrl: uri,
          isOpenAccess: false,
          sourceType: "zotero" as const,
          sourceId: item.itemKey,
        };
      });
      papers.push(...zoteroItems);
    }

    if (job.sourceManualItems?.length) {
      const manualItems = job.sourceManualItems.map((item: { id: string; title: string; doi?: string; year?: number; abstract?: string; authors?: string[]; pdfUrl?: string; storageId?: string }) => ({
        openalexId: `manual:${item.id}`,
        title: item.title,
        doi: item.doi,
        publicationYear: item.year,
        abstract: item.abstract,
        authors: item.authors,
        pdfUrl: item.pdfUrl,
        storageId: item.storageId,
        isOpenAccess: false,
        sourceType: "manual" as const,
        sourceId: item.id,
      }));
      papers.push(...manualItems);
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

    // Step 3: Create paper records
    await step.runMutation(internal.extraction.mutations.createPaperRecords, {
      jobId,
      papers: dedupedPapers.map((p) => ({
        ...p,
        storageId: p.storageId as Id<"_storage"> | undefined,
      })),
    });

    // Step 4: Get created paper IDs
    const paperIds = await step.runQuery(
      internal.extraction.queries.getPapersByOpenAlexIds,
      {
        jobId,
        openalexIds: dedupedPapers.map((p) => p.openalexId),
      }
    );

    const processableCount = paperIds.filter(
      (paper) => paper.processable !== false
    ).length;

    await step.runMutation(internal.extraction.mutations.updateJobStatus, {
      jobId,
      status: "downloading_pdfs",
      totalPapers: processableCount,
    });

    console.log(`[Workflow] Enqueueing ${paperIds.length} papers for processing`);
    const pdfEnabled = await step.runQuery(
      internal.extraction.queries.getPdfExtractionEnabledInternal,
      {}
    );

    // Enqueue each paper for processing
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
        // Skip papers without any content - mark as failed
        await step.runMutation(
          internal.extraction.mutations.updatePaperStatus,
          {
            paperId: paper._id,
            status: "download_failed",
            errorMessage: pdfEnabled
              ? "No PDF URL or abstract available"
              : "PDF processing is disabled and no usable abstract is available",
          }
        );
        await step.runMutation(internal.extraction.mutations.finalizeJobIfDone, {
          jobId,
        });
        continue;
      }

      // Enqueue paper processing via workpool (uses new 3-step workflow internally)
      await step.runMutation(
        internal.extraction.mutations.enqueuePaperProcessing,
        {
          paperId: paper._id,
          jobId,
          pdfUrl: paper.pdfUrl || "", // Empty string if no PDF
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

    // Step 5: Mark workflow as complete (papers will be processed asynchronously)
    await step.runMutation(internal.extraction.mutations.updateJobStatus, {
      jobId,
      status: "extracting",
    });

    console.log(`[Workflow] Complete - papers processing asynchronously`);
  },
});
