import { mutation } from "../_generated/server";
import { v } from "convex/values";
import {
  screeningPaperInputValidator,
  screeningQuestionValidator,
  screeningScoringConfigValidator,
} from "./validators";

/**
 * Create a bulk screening job.
 * Stub - implementation pending (TDD RED phase).
 */
export const createScreeningJob = mutation({
  args: {
    papers: v.array(screeningPaperInputValidator),
    questions: v.array(screeningQuestionValidator),
    scoringConfig: screeningScoringConfigValidator,
    targetCollectionId: v.optional(v.id("collections")),
  },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  handler: async (ctx, args) => {
    throw new Error("Not implemented");
  },
});
