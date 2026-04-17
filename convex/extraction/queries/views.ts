/**
 * Saved-view queries. One-liner read against extractionSavedViews via the
 * by_job index.
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";
import { ok, statusResultValidator } from "../../lib/query_states";
import { resolveOwnedJob } from "../access";
import { requireFeature } from "../../featureFlags/guard";
import { extractionSavedViewValidator } from "../validators";

export const getSavedViews = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    views: v.array(extractionSavedViewValidator),
  }),
  handler: async (ctx, args) => {
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    await requireFeature(ctx, "extraction.enabled");

    const views = await ctx.db
      .query("extractionSavedViews")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .collect();
    return ok({ views });
  },
});
