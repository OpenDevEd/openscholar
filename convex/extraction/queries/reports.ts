/**
 * Report-snapshot + run-diff readers. Snapshots are behind
 * extraction.reportBuilder; run diffs only need job ownership (they're
 * displayed on job detail pages, not the report builder surface).
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";
import { ok, statusResultValidator } from "../../lib/query_states";
import { resolveOwnedJob } from "../access";
import { requireFeature } from "../../featureFlags/guard";
import {
  extractionReportSnapshotValidator,
  extractionRunDiffValidator,
} from "../validators";

export const getReportSnapshots = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    reports: v.array(extractionReportSnapshotValidator),
  }),
  handler: async (ctx, args) => {
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    const { user } = access;
    await requireFeature(ctx, "extraction.enabled");
    await requireFeature(ctx, "extraction.reportBuilder", user._id);

    const reports = await ctx.db
      .query("extractionReportSnapshots")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .collect();
    return ok({ reports });
  },
});

export const getRunDiff = query({
  args: {
    jobId: v.id("extractionJobs"),
    diffId: v.optional(v.id("extractionRunDiffs")),
  },
  returns: statusResultValidator({
    diff: v.union(v.null(), extractionRunDiffValidator),
  }),
  handler: async (ctx, args) => {
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    await requireFeature(ctx, "extraction.enabled");

    if (args.diffId) {
      const diff = await ctx.db.get("extractionRunDiffs", args.diffId);
      if (!diff || diff.jobId !== args.jobId) return ok({ diff: null });
      return ok({ diff });
    }

    const latest = await ctx.db
      .query("extractionRunDiffs")
      .withIndex("by_job_generated", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .first();
    return ok({ diff: latest || null });
  },
});
