/**
 * Job-scoped public queries: list the user's jobs, read a job's details,
 * subscribe to job-level progress counters.
 *
 * subscribeToJobProgress intentionally reads only the extractionJobs row
 * (not the paper set) — maybeFinalizeJob/markPaperTerminalTx keep the
 * counters up-to-date so Convex reactivity fires exactly once per
 * transition instead of replaying the full paper set to every tab.
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { getCurrentUser } from "../../lib/auth";
import { ok, statusResultValidator } from "../../lib/query_states";
import { resolveOwnedJob } from "../access";
import { requireFeature } from "../../featureFlags/guard";
import { MAX_PAPERS_PER_JOB } from "../../lib/queryBounds";
import {
  extractionJobValidator,
  extractionPaperValidator,
  extractionQuestionValidator,
} from "../validators";

export const getMyJobs = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("downloading_pdfs"),
        v.literal("indexing"),
        v.literal("extracting"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
  },
  returns: v.array(extractionJobValidator),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    await requireFeature(ctx, "extraction.enabled");

    let jobs: Doc<"extractionJobs">[];
    if (args.status) {
      jobs = await ctx.db
        .query("extractionJobs")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", user._id).eq("status", args.status!),
        )
        .order("desc")
        .take(50);
    } else {
      jobs = await ctx.db
        .query("extractionJobs")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(50);
    }
    return jobs;
  },
});

export const getJobDetails = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    job: extractionJobValidator,
    questions: v.array(extractionQuestionValidator),
    papers: v.array(extractionPaperValidator),
    progress: v.object({
      total: v.number(),
      processed: v.number(),
      failed: v.number(),
      percentage: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    const { job } = access;
    await requireFeature(ctx, "extraction.enabled");

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_processable", (q) =>
        q.eq("jobId", args.jobId).eq("processable", true),
      )
      .order("asc")
      .take(MAX_PAPERS_PER_JOB);

    const processablePapers = papers.filter((p) => p.processable !== false);
    const processed = processablePapers.filter(
      (p) => p.status === "completed",
    ).length;
    const failed = processablePapers.filter(
      (p) =>
        p.status === "failed" ||
        p.status === "download_failed" ||
        p.status === "indexing_failed",
    ).length;

    const total = job.totalPapers || processablePapers.length;

    return ok({
      job,
      questions,
      papers,
      progress: {
        total,
        processed,
        failed,
        percentage:
          total > 0 ? Math.round(((processed + failed) / total) * 100) : 0,
      },
    });
  },
});

export const subscribeToJobProgress = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    job: extractionJobValidator,
    totalPapers: v.number(),
    processedPapers: v.number(),
    failedPapers: v.number(),
  }),
  handler: async (ctx, args) => {
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    const { job } = access;
    await requireFeature(ctx, "extraction.enabled");

    return ok({
      job,
      totalPapers: job.totalPapers,
      processedPapers: job.processedPapers,
      failedPapers: job.failedPapers,
    });
  },
});
