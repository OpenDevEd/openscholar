import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { requirePublicDebugEnabled } from "../lib/debug_gate";

export const createTestJobForFix = mutation({
  args: {
    name: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    requirePublicDebugEnabled();

    const user = await requireAuth(ctx);
    
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
