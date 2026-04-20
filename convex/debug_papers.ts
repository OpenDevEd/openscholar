
import { internalQuery } from "./_generated/server";

export const recent = internalQuery({
  args: {},
  handler: async (ctx) => {
    const papers = await ctx.db.query("extractionPapers")
      .order("desc")
      .take(5);
    
    return papers.map(p => ({
      id: p._id,
      title: p.title,
      status: p.status,
      errorCode: p.lastError?.code,
      errorMessage: p.lastError?.message,
      attemptCount: p.attemptCount,
      pdfUrl: p.pdfUrl,
      // retryCount: p.retries,
      storageId: p.storageId,
      ragEntryId: p.ragEntryId,
      pdfContentUsed: p.pdfContentUsed
    }));
  },
});
