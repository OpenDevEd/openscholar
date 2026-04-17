/**
 * Saved-view mutations. Users persist named filter/sort configurations
 * for an extraction job via these two mutations; the matching read path
 * lives in queries/views.ts.
 */

import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../../lib/auth";
import { createError } from "../../lib/errors";
import { assertJobOwnership } from "../access";

export const saveExtractionSavedView = mutation({
  args: {
    jobId: v.id("extractionJobs"),
    name: v.string(),
    filters: v.object({
      searchQuery: v.string(),
      confidenceRange: v.array(v.number()),
      statusFilters: v.array(v.string()),
    }),
    sortBy: v.optional(v.string()),
    viewMode: v.optional(v.string()),
    selectedQuestionKeys: v.optional(v.array(v.string())),
  },
  returns: v.object({ viewId: v.id("extractionSavedViews") }),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    await assertJobOwnership(ctx, user._id, args.jobId);

    const existing = await ctx.db
      .query("extractionSavedViews")
      .withIndex("by_job_name", (q) =>
        q.eq("jobId", args.jobId).eq("name", args.name.trim()),
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch("extractionSavedViews", existing._id, {
        filters: args.filters,
        sortBy: args.sortBy,
        viewMode: args.viewMode,
        selectedQuestionKeys: args.selectedQuestionKeys,
        updatedAt: now,
      });
      return { viewId: existing._id };
    }

    const viewId = await ctx.db.insert("extractionSavedViews", {
      jobId: args.jobId,
      userId: user._id,
      name: args.name.trim(),
      filters: args.filters,
      sortBy: args.sortBy,
      viewMode: args.viewMode,
      selectedQuestionKeys: args.selectedQuestionKeys,
      createdAt: now,
      updatedAt: now,
    });
    return { viewId };
  },
});

export const deleteExtractionSavedView = mutation({
  args: { viewId: v.id("extractionSavedViews") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const view = await ctx.db.get("extractionSavedViews", args.viewId);
    if (!view) throw createError("NOT_FOUND", "Saved view not found");

    await assertJobOwnership(ctx, user._id, view.jobId);

    await ctx.db.delete("extractionSavedViews", args.viewId);
    return null;
  },
});
