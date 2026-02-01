import { mutation } from "../_generated/server";
import { v } from "convex/values";

export const createTestJobForFix = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    // Find first user (skip auth for testing)
    const user = await ctx.db
      .query("users")
      .first();
      
    if (!user) {
      return { error: "No users found" };
    }
    
    const jobId = await ctx.db.insert("extractionJobs", {
      userId: user._id,
      name: args.name,
      sourceType: "history",
      searchFilters: {
        query: "machine learning education",
        yearRange: [1900, 2026],
        sortBy: "relevance",
      },
      status: "downloading_pdfs",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q1",
      question: "What methodology was used?",
      type: "string",
      order: 0,
      createdAt: Date.now(),
    });
    
    return { jobId };
  },
});
