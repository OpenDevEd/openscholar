import { workflow } from "../workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const testSimpleWorkflow = workflow.define({
  args: {
    jobId: v.id("extractionJobs"),
  },
  handler: async (step, { jobId }) => {
    console.log("Step 1: Starting simple test workflow");
    
    // Just update status
    await step.runMutation(internal.extraction.mutations.updateJobStatus, {
      jobId,
      status: "downloading_pdfs",
    });
    
    console.log("Step 2: Status updated");
    
    // Try to get papers
    const job = await step.runQuery(internal.extraction.queries.getJobInternal, { jobId });
    console.log("Step 3: Got job", job?._id);
    
    if (!job?.searchFilters) {
      console.log("No search filters");
      return;
    }
    
    // Try to fetch one paper only (limit to 1)
    console.log("Step 4: Fetching papers...");
    const papers = await step.runAction(
      internal.extraction.actions.fetchPapersFromHistory,
      {
        searchFilters: { ...job.searchFilters, perPage: 1, limit: 1 },
      }
    );
    
    console.log(`Step 5: Fetched ${papers.length} papers`);
    
    if (papers.length === 0) {
      console.log("No papers found");
      return;
    }
    
    // Just create paper records, don't process yet
    await step.runMutation(internal.extraction.mutations.createPaperRecords, {
      jobId,
      papers: papers.slice(0, 1), // Only 1 paper
    });
    
    console.log("Step 6: Created paper records");
    
    // Update job with total
    await step.runMutation(internal.extraction.mutations.updateJobStatus, {
      jobId,
      status: "downloading_pdfs",
      totalPapers: 1,
    });
    
    console.log("Step 7: Test workflow complete");
  },
});
