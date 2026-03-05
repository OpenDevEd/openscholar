import { workflow } from "../workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const testSimpleWorkflow = workflow.define({
  args: {
    jobId: v.id("extractionJobs"),
  },
  handler: async (step, { jobId }) => {
    // Just update status
    await step.runMutation(internal.extraction.mutations.updateJobStatus, {
      jobId,
      status: "downloading_pdfs",
    });

    // Try to get papers
    const job = await step.runQuery(internal.extraction.queries.getJobInternal, { jobId });

    if (!job?.searchFilters) {
      return;
    }

    // Try to fetch one paper only (limit to 1)
    const papers = await step.runAction(
      internal.extraction.actions.fetchPapersFromHistory,
      {
        searchFilters: { ...job.searchFilters, perPage: 1, limit: 1 },
      }
    );

    if (papers.length === 0) {
      return;
    }
    
    // Just create paper records, don't process yet
    await step.runMutation(internal.extraction.mutations.createPaperRecords, {
      jobId,
      papers: papers.slice(0, 1).map(({ storageId: _storageId, ...paper }) => ({
        ...paper,
      })),
    });

    // Update job with total
    await step.runMutation(internal.extraction.mutations.updateJobStatus, {
      jobId,
      status: "downloading_pdfs",
      totalPapers: 1,
    });
  },
});
