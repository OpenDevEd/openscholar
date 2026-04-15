"use node";

/**
 * Workpool actions for extraction pipeline.
 *
 * Each paper is processed independently via the workpool. The action runs
 * the full per-paper pipeline: parse -> extract -> critic -> persist.
 *
 * This is a Phase 89 skeleton -- downstream phases (90-91) replace the
 * stub with real parsing and extraction logic.
 */

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

/**
 * Process a single paper through the extraction pipeline.
 *
 * Phase 89 stub: returns a success result immediately.
 * Phase 90 adds: parsing waterfall (PMC -> arXiv -> unpdf -> Gemini)
 * Phase 91 adds: extraction cascade (Flash Lite -> Flash -> Haiku)
 * Phase 92 adds: critic pass and citation grounding
 */
export const processExtractionPaper = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (_ctx, args) => {
    console.log(
      `[ExtractionPipeline] Processing paper ${args.paperId} for job ${args.jobId} (stub)`
    );

    // Stub: downstream phases replace this with real pipeline
    return { success: true };
  },
});
