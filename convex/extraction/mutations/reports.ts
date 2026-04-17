/**
 * Report-snapshot + run-diff mutations. createExtractionReportSnapshot
 * builds a point-in-time report section bundle; createExtractionRunDiff
 * compares two runs (same question set, different papers) and persists
 * the change summary.
 *
 * Pure data shaping lives in lib/extraction/report-builder.ts. This file
 * only handles auth, feature flags, ctx.db reads/writes, and the
 * scheduler hop for legacy-job backfill.
 */

import { mutation, type MutationCtx } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { requireFeature } from "../../featureFlags/guard";
import { MAX_PAPERS_PER_JOB } from "../../lib/queryBounds";
import { assertJobOwnership } from "../access";
import { buildRunDiff } from "../../../lib/extraction/insights";
import {
  buildDiffRecords,
  buildReportSnapshot,
  buildResultMaps,
} from "../../../lib/extraction/report-builder";

async function loadJobDataForReporting(
  ctx: MutationCtx,
  jobId: Id<"extractionJobs">,
) {
  // Four indexed job-scoped reads replace the previous per-paper fan-out
  // (which was O(papers) separate result queries + O(papers) review queries).
  const [questions, papers, allResults, allReviews] = await Promise.all([
    ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .order("asc")
      .collect(),
    ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(MAX_PAPERS_PER_JOB),
    ctx.db
      .query("extractionResults")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(MAX_PAPERS_PER_JOB * 20),
    ctx.db
      .query("extractionResultReviews")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(MAX_PAPERS_PER_JOB * 20),
  ]);

  const { resultsByPaper, reviewsByResult } = buildResultMaps(
    allResults,
    allReviews,
  );

  return { questions, papers, resultsByPaper, reviewsByResult };
}

export const createExtractionReportSnapshot = mutation({
  args: {
    jobId: v.id("extractionJobs"),
    name: v.optional(v.string()),
    scope: v.optional(
      v.object({
        filteredPaperIds: v.optional(v.array(v.id("extractionPapers"))),
        selectedQuestionKeys: v.optional(v.array(v.string())),
        viewName: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({ reportId: v.id("extractionReportSnapshots") }),
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await requireFeature(ctx, "extraction.reportBuilder", user._id);
    const job = await assertJobOwnership(ctx, user._id, args.jobId);
    const { questions, papers, resultsByPaper, reviewsByResult } =
      await loadJobDataForReporting(ctx, args.jobId);

    const jobStats = await ctx.db
      .query("extractionJobStats")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    const hasStats = jobStats.length > 0;

    const { sections, metrics } = buildReportSnapshot({
      questions,
      papers,
      resultsByPaper,
      reviewsByResult,
      jobStats,
      scope: args.scope,
    });

    const reportId = await ctx.db.insert("extractionReportSnapshots", {
      jobId: job._id,
      userId: user._id,
      name:
        args.name?.trim() ||
        `${job.name} report ${new Date().toISOString().slice(0, 10)}`,
      scope: {
        filteredPaperIds: args.scope?.filteredPaperIds,
        selectedQuestionKeys: args.scope?.selectedQuestionKeys,
        viewName: args.scope?.viewName,
      },
      sections,
      metrics,
      generatedAt: Date.now(),
      createdAt: Date.now(),
    });

    // Lazy backfill for legacy completed jobs that never wrote the stats table.
    if (!hasStats && job.status === "completed") {
      await ctx.scheduler.runAfter(
        0,
        internal.extraction.mutations.internal.admin.backfillJobStats,
        { jobId: args.jobId },
      );
    }

    return { reportId };
  },
});

export const createExtractionRunDiff = mutation({
  args: {
    jobId: v.id("extractionJobs"),
    baselineJobId: v.id("extractionJobs"),
  },
  returns: v.object({
    diffId: v.id("extractionRunDiffs"),
    summary: v.object({
      newAnswers: v.number(),
      changedAnswers: v.number(),
      removedAnswers: v.number(),
      confidenceShifts: v.number(),
      newlyInsufficientEvidence: v.number(),
      totalCompared: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await assertJobOwnership(ctx, user._id, args.jobId);
    await assertJobOwnership(ctx, user._id, args.baselineJobId);

    const currentData = await loadJobDataForReporting(ctx, args.jobId);
    const baselineData = await loadJobDataForReporting(ctx, args.baselineJobId);

    const { summary, changes } = buildRunDiff(
      buildDiffRecords(baselineData.papers, baselineData.resultsByPaper),
      buildDiffRecords(currentData.papers, currentData.resultsByPaper),
    );

    const DIFF_CHANGES_CAP = 1000;
    const isTruncated = changes.length > DIFF_CHANGES_CAP;

    const diffId = await ctx.db.insert("extractionRunDiffs", {
      jobId: args.jobId,
      baselineJobId: args.baselineJobId,
      userId: user._id,
      summary,
      changes: changes.slice(0, DIFF_CHANGES_CAP),
      ...(isTruncated
        ? { isTruncated: true, totalChanges: changes.length }
        : {}),
      generatedAt: Date.now(),
      createdAt: Date.now(),
    });

    return { diffId, summary };
  },
});
