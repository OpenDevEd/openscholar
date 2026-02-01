/**
 * Extraction Workflow using Workpool
 * Proper pattern for self-hosted Convex with durable execution
 */

import { workflow } from "../workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { pdfProcessingPool } from "../workpool";

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
      throw new Error("Job not found");
    }

    const questionsRaw = await step.runQuery(
      internal.extraction.queries.getQuestionsInternal,
      { jobId }
    );

    const questions = questionsRaw.map((q: any) => ({
      key: q.key,
      question: q.question,
      type: q.type,
      description: q.description,
    }));

    console.log(`[Workflow] Loaded ${questions.length} questions`);

    // Step 2: Fetch papers from OpenAlex
    if (!job.searchFilters) {
      throw new Error("No search filters found");
    }

    await step.runMutation(internal.extraction.mutations.updateJobStatus, {
      jobId,
      status: "downloading_pdfs",
      totalPapers: 0,
    });

    const papers = await step.runAction(
      internal.extraction.actions.fetchPapersFromHistory,
      {
        searchFilters: job.searchFilters,
      }
    );

    console.log(`[Workflow] Fetched ${papers.length} papers`);

    // Step 3: Create paper records
    await step.runMutation(internal.extraction.mutations.createPaperRecords, {
      jobId,
      papers,
    });

    await step.runMutation(internal.extraction.mutations.updateJobStatus, {
      jobId,
      status: "downloading_pdfs",
      totalPapers: papers.length,
    });

    // Step 4: Get created paper IDs
    const paperIds = await step.runQuery(
      internal.extraction.queries.getPapersByOpenAlexIds,
      {
        jobId,
        openalexIds: papers.map((p: any) => p.openalexId),
      }
    );

    console.log(`[Workflow] Enqueueing ${paperIds.length} papers for processing`);

    // Enqueue each paper for processing
    let enqueuedCount = 0;
    for (const paper of paperIds) {
      // Check if paper has content to process (PDF or abstract)
      const hasPdfUrl = !!paper.pdfUrl;
      const hasAbstract = !!paper.abstract && paper.abstract.length > 50;
      
    if (!hasPdfUrl && !hasAbstract) {
      // Skip papers without any content - mark as failed
      await step.runMutation(
        internal.extraction.mutations.updatePaperStatus,
        {
          paperId: paper._id,
          status: "download_failed",
          errorMessage: "No PDF URL or abstract available",
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
      totalPapers: enqueuedCount,
    });

    console.log(`[Workflow] Complete - papers processing asynchronously`);
  },
});
