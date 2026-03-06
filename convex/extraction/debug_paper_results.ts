import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

/**
 * Internal query to inspect extraction results for individual papers.
 *
 * Access: Internal only (internalQuery) -- not exposed to clients.
 */
export const debugPaperResults = internalQuery({
  args: {
    paperId: v.id("extractionPapers"),
  },
  handler: async (ctx, { paperId }) => {
    const paper = await ctx.db.get(paperId);
    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", paperId))
      .collect();
    
    return {
      paper: paper ? {
        id: paper._id,
        title: paper.title,
        status: paper.status,
        pdfUrl: paper.pdfUrl,
        storageId: paper.storageId,
        ragEntryId: paper.ragEntryId,
        errorMessage: paper.errorMessage,
      } : null,
      results: results.map(r => ({
        questionKey: r.questionKey,
        answer: r.answer,
        confidence: r.confidence,
        pdfContentUsed: r.pdfContentUsed,
      })),
    };
  },
});
