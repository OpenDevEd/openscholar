import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { workflow } from "../workflow";

export const createTestJob = mutation({
  args: {},
  handler: async (ctx): Promise<{ jobId: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }
    
    const user = await ctx.db
      .query("users")
      .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
      .unique();

    if (!user) {
      throw new Error("User not found");
    }
    
    const userId = user._id;
    
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
      { jobId, userId }
    );
    
    // Update job with workflow ID
    await ctx.db.patch(jobId, { workflowId });
    
    return { jobId: jobId.toString() };
  }
});
