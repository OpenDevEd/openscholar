import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { workflow } from "../workflow";

/**
 * Internal mutation to create a test extraction job for debugging.
 *
 * Access: Internal only (internalMutation) -- not exposed to clients.
 */
export const createTestJob = internalMutation({
  args: {
    userId: v.id("users"),
  },
  returns: v.object({
    jobId: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = args.userId;

    // Create job directly in database
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      name: "Test Sequential Job",
      sourceType: "history",
      searchFilters: {
        query: "machine learning education",
        yearRange: [1900, 2026],
        sortBy: "relevance",
        selectedRegions: [],
        selectedCountryFocus: [],
        reviewFilter: false
      },
      status: "pending",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    // Create questions
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q1",
      question: "What methodology was used?",
      type: "string",
      description: "Describe the research methodology",
      order: 0,
      createdAt: Date.now(),
    });
    
    // Start workflow
    const workflowId = await workflow.start(
      ctx,
      internal.extraction.workflow.runExtractionWorkflow,
      { jobId }
    );
    
    // Update job with workflow ID
    await ctx.db.patch("extractionJobs", jobId, { workflowId });
    
    return { jobId: jobId.toString() };
  }
});
