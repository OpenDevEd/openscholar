"use node";

/**
 * Workpool actions for bulk screening.
 *
 * Stub file for type generation -- the actual screening action
 * implementation is added in Plan 02 (workflow integration).
 */

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

/**
 * Screen a single paper using AI.
 *
 * Placeholder action -- implementation in Plan 02.
 * Returns screening responses, confidence, and token usage.
 */
export const screenPaperAction = internalAction({
  args: {
    resultId: v.id("screeningResults"),
    jobId: v.id("screeningJobs"),
  },
  handler: async () => {
    throw new Error("screenPaperAction not yet implemented (Plan 02)");
  },
});
