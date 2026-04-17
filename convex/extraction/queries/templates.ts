/**
 * Workflow template list query. Returns the current user's templates
 * sorted newest-first, capped at MAX_EXTRACTION_JOBS_PER_USER (same cap
 * as jobs since a template roughly maps 1-to-1 to a run).
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../../lib/auth";
import { requireFeature } from "../../featureFlags/guard";
import { MAX_EXTRACTION_JOBS_PER_USER } from "../../lib/queryBounds";
import { workflowTemplateValidator } from "../validators";

export const getWorkflowTemplates = query({
  args: {},
  returns: v.array(workflowTemplateValidator),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    await requireFeature(ctx, "extraction.enabled");
    await requireFeature(ctx, "extraction.templates", user._id);

    return await ctx.db
      .query("extractionWorkflowTemplates")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(MAX_EXTRACTION_JOBS_PER_USER);
  },
});
