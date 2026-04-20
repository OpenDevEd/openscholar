import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { assertNonProd } from "../lib/assertNonProd";

/**
 * Internal query to inspect extraction results for individual papers.
 *
 * Access: Internal only (internalQuery) -- not exposed to clients.
 */
export const debugPaperResults = internalQuery({
  args: {
    paperId: v.id("extractionPapers"),
  },
  // v.any() on the return shape is intentional: dev-only diagnostic
  // (assertNonProd-gated) with a projection-shaped payload that drifts
  // independently from the schema.
  returns: v.any(),
  handler: async (ctx, { paperId }) => {
    assertNonProd();
    const paper = await ctx.db.get("extractionPapers", paperId);
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
        errorCode: paper.lastError?.code,
        lastErrorMessage: paper.lastError?.message,
        attemptCount: paper.attemptCount,
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

