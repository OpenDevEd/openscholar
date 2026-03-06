import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Internal mutation to create a test extraction job for verifying fixes.
 *
 * Access: Internal only (internalMutation) -- not exposed to clients.
 */
export const createTestJobForFix = internalMutation({
  args: {
    name: v.string(),
    userId: v.id("users"),
  },
  returns: v.object({
    jobId: v.id("extractionJobs"),
  }),
  handler: async (ctx, args) => {
    const jobId = await ctx.db.insert("extractionJobs", {
      userId: args.userId,
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
