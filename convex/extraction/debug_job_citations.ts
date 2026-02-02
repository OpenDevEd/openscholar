import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

function hashText(text: string): string {
  let hash = 0;
  const str = text.substring(0, 200);
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString();
}

export const debugJobCitations = internalQuery({
  args: {
    jobId: v.id("extractionJobs"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    const completed = papers.filter(
      (paper) => paper.processable !== false && paper.status === "completed"
    );
    const limit = args.limit ?? 6;

    const results = [] as Array<{
      paperId: string;
      title: string;
      ragEntryId?: string;
      questionKey?: string;
      contextChunkPreview?: string;
      contextChunkHash?: string;
    }>;

    for (const paper of completed.slice(0, limit)) {
      const paperResults = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect();

      const withContext = paperResults.find(
        (result) =>
          result.pdfContentUsed &&
          result.contextChunks &&
          result.contextChunks.length > 0
      );

      const chunk = withContext?.contextChunks?.[0] || "";
      const preview = chunk ? chunk.substring(0, 160) : undefined;

      results.push({
        paperId: paper._id,
        title: paper.title,
        ragEntryId: paper.ragEntryId,
        questionKey: withContext?.questionKey,
        contextChunkPreview: preview,
        contextChunkHash: chunk ? hashText(chunk) : undefined,
      });
    }

    return {
      sampled: results.length,
      results,
    };
  },
});
