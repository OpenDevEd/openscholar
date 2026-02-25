import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getProcessableFlags } from "./content";

export const debugJobContent = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    const counts = {
      total: papers.length,
      processable: 0,
      hasPdfUrl: 0,
      hasAbstract: 0,
      abstractOnly: 0,
      pdfOnly: 0,
      pdfAndAbstract: 0,
      byStatus: {} as Record<string, number>,
      byErrorMessage: {} as Record<string, number>,
    };

    const samples = {
      abstractOnlyFailed: [] as Array<{
        id: string;
        title: string;
        errorMessage?: string;
      }>,
      noContentFailed: [] as Array<{
        id: string;
        title: string;
        errorMessage?: string;
      }>,
    };

    for (const paper of papers) {
      const { hasPdfUrl, hasAbstract } = getProcessableFlags({
        pdfUrl: paper.pdfUrl,
        storageId: paper.storageId,
        abstract: paper.abstract,
      });
      const isProcessable = paper.processable !== false;

      counts.byStatus[paper.status] = (counts.byStatus[paper.status] || 0) + 1;
      if (paper.errorMessage) {
        counts.byErrorMessage[paper.errorMessage] =
          (counts.byErrorMessage[paper.errorMessage] || 0) + 1;
      }

      if (hasPdfUrl) counts.hasPdfUrl++;
      if (hasAbstract) counts.hasAbstract++;
      if (hasPdfUrl && hasAbstract) counts.pdfAndAbstract++;
      if (hasPdfUrl && !hasAbstract) counts.pdfOnly++;
      if (!hasPdfUrl && hasAbstract) counts.abstractOnly++;
      if (isProcessable) counts.processable++;

      if (
        !hasPdfUrl &&
        hasAbstract &&
        paper.status === "download_failed" &&
        samples.abstractOnlyFailed.length < 20
      ) {
        samples.abstractOnlyFailed.push({
          id: paper._id,
          title: paper.title,
          errorMessage: paper.errorMessage,
        });
      }

      if (
        !hasPdfUrl &&
        !hasAbstract &&
        paper.status === "download_failed" &&
        samples.noContentFailed.length < 20
      ) {
        samples.noContentFailed.push({
          id: paper._id,
          title: paper.title,
          errorMessage: paper.errorMessage,
        });
      }
    }

    return { counts, samples };
  },
});
