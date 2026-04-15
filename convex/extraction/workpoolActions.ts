"use node";

/**
 * Workpool actions for extraction pipeline.
 *
 * Each paper is processed independently via the workpool. The action runs
 * the full per-paper pipeline: parse -> extract -> critic -> persist.
 *
 * Phase 90: parsing waterfall (PMC -> arXiv -> unpdf -> Gemini -> abstract_only)
 * Phase 91 adds: extraction cascade (Flash Lite -> Flash -> Haiku)
 * Phase 92 adds: critic pass and citation grounding
 */

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { parseFullText } from "./parse";

/**
 * Process a single paper through the extraction pipeline.
 *
 * 1. Loads the job and checks for terminal status (credit guard)
 * 2. Loads the paper and checks idempotency (bodyText already populated)
 * 3. Marks paper as "parsing"
 * 4. Runs the parsing waterfall via parseFullText
 * 5. Stores parsed text via storeParsedText mutation
 *
 * On failure: logs error and re-throws for workpool retry.
 */
export const processExtractionPaper = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // 1. Load job -- terminal-status guard (mirrors screening pattern)
    const job = await ctx.runQuery(
      internal.extraction.queries.getJobInternal,
      { jobId: args.jobId }
    );
    if (!job) {
      console.warn(
        `[ExtractionPipeline] Job ${args.jobId} not found, skipping`
      );
      return { success: false };
    }

    const terminalStatuses = ["completed", "cancelled", "failed"];
    if (terminalStatuses.includes(job.status)) {
      console.log(
        `[ExtractionPipeline] Job ${args.jobId} is ${job.status}, skipping paper ${args.paperId}`
      );
      return { success: false };
    }

    // 2. Load paper -- idempotency guard
    const paper = await ctx.runQuery(
      internal.extraction.queries.getPaperInternal,
      { paperId: args.paperId }
    );
    if (!paper) {
      console.warn(
        `[ExtractionPipeline] Paper ${args.paperId} not found, skipping`
      );
      return { success: false };
    }

    // Idempotency: skip if bodyText already populated (workpool retry)
    if (paper.bodyText) {
      console.log(
        `[ExtractionPipeline] Paper ${args.paperId} already parsed, skipping`
      );
      return { success: true };
    }

    // 3. Mark paper as parsing
    await ctx.runMutation(
      internal.extraction.mutations.updatePaperStatus,
      { paperId: args.paperId, status: "parsing" }
    );

    // 4. Run parsing waterfall
    try {
      const result = await parseFullText(paper.doi ?? "", paper.openalexId);

      // 5. Store parsed text via mutation
      await ctx.runMutation(
        internal.extraction.mutations.storeParsedText,
        {
          paperId: args.paperId,
          bodyText: result.bodyText,
          parsingSource: result.parsingSource,
        }
      );

      console.log(
        `[ExtractionPipeline] Paper ${args.paperId} parsed via ${result.parsingSource} (${result.bodyText.length} chars)`
      );

      return { success: true };
    } catch (error) {
      console.error(
        `[ExtractionPipeline] All parsing tiers failed for paper ${args.paperId}: ${error}`
      );
      // Re-throw so workpool retry fires for transient errors
      throw error;
    }
  },
});
