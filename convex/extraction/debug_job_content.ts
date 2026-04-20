import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getProcessableFlags } from "./content";
import { getFlag } from "../featureFlags/guard";
import { assertNonProd } from "../lib/assertNonProd";

/**
 * Internal query to inspect raw content extracted from papers in a job.
 *
 * Access: Internal only (internalQuery) -- not exposed to clients.
 */
export const debugJobContent = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  // v.any() on the return shape is intentional: dev-only diagnostic,
  // assertNonProd-gated, returns a deeply-nested counts+samples object
  // that evolves freely.
  returns: v.any(),
  handler: async (ctx, args) => {
    assertNonProd();
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
        lastErrorMessage?: string;
      }>,
      noContentFailed: [] as Array<{
        id: string;
        title: string;
        lastErrorMessage?: string;
      }>,
    };

    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    const pdfEnabled = pdfFlag?.enabled ?? true;

    for (const paper of papers) {
      const { hasPdfUrl, hasAbstract } = getProcessableFlags({
        pdfUrl: paper.pdfUrl,
        storageId: paper.storageId,
        abstract: paper.abstract,
        pdfEnabled,
      });
      const isProcessable = paper.processable !== false;

      counts.byStatus[paper.status] = (counts.byStatus[paper.status] || 0) + 1;
      if (paper.lastError) {
        const key = paper.lastError.code;
        counts.byErrorMessage[key] = (counts.byErrorMessage[key] || 0) + 1;
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
          lastErrorMessage: paper.lastError?.message,
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
          lastErrorMessage: paper.lastError?.message,
        });
      }
    }

    return { counts, samples };
  },
});
