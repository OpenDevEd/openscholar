/**
 * Job-scoped public queries: list the user's jobs, read a job's details,
 * subscribe to job-level progress counters.
 *
 * subscribeToJobProgress intentionally reads only the extractionJobs row
 * (not the paper set) — maybeFinalizeJob/markPaperTerminalTx keep the
 * counters up-to-date so Convex reactivity fires exactly once per
 * transition instead of replaying the full paper set to every tab.
 */

import { query, type QueryCtx } from "../../_generated/server";
import { v } from "convex/values";
import schema from "../../schema";
import type { Doc, Id } from "../../_generated/dataModel";
import { getCurrentUser } from "../../lib/auth";
import { ok, statusResultValidator } from "../../lib/query_states";
import { resolveOwnedJob, type OwnedJobResolution } from "../access";
import { requireFeature } from "../../featureFlags/guard";
import { PAPER_LIMIT } from "@/lib/extraction/limits";
import { readJobCounters } from "../jobCounters";
import { extractionJobValidator, extractionQuestionValidator, jobQuestionsValidator, jobStatusValidator } from "../validators";
import { MAX_QUESTIONS_PER_JOB } from "../validators";

async function resolveReadableJob(
  ctx: QueryCtx,
  jobId: Id<"extractionJobs">,
): Promise<OwnedJobResolution> {
  const access = await resolveOwnedJob(ctx, jobId);
  if (access.status !== "ok") return access;
  await requireFeature(ctx, "extraction.enabled");
  return access;
}

export const getMyJobs = query({
  args: {
    status: v.optional(jobStatusValidator),
    mode: v.optional(
      v.union(v.literal("extraction"), v.literal("chat")),
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
    } else if (args.mode) {
      jobs = await ctx.db
        .query("extractionJobs")
        .withIndex("by_user_mode_updated", (q) =>
          q.eq("userId", user._id).eq("mode", args.mode!),
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
    questions: jobQuestionsValidator,
  }),
  handler: async (ctx, args) => {
    const access = await resolveReadableJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    const { job } = access;

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .take(MAX_QUESTIONS_PER_JOB);

    return ok({
      job,
      questions,
    });
  },
});

export const getJobShell = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    job: extractionJobValidator,
  }),
  handler: async (ctx, args) => {
    const access = await resolveReadableJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    return ok({ job: access.job });
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
    const access = await resolveReadableJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    const { job } = access;
    // The counts live in the job's counts row, not on the job: this query reads that row, so
    // it runs again whenever a count changes.
    const { processed, failed } = await readJobCounters(ctx, args.jobId);

    return ok({
      job,
      totalPapers: job.totalPapers ?? 0,
      processedPapers: processed,
      failedPapers: failed,
    });
  },
});

/**
 * Public read of the frozen bucket-source rows for a job. Drives the
 * Papers-in-context sidebar in chat mode, but is mode-agnostic — a
 * future extraction-side consumer can reuse it too.
 *
 * Returns the rows ordered by insertion position so the UI list matches
 * the corpus order sent to the model (sorted by openalexId in the
 * prompt renderer, but displayed in user-selection order in the
 * sidebar).
 */
export const getJobSources = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.object({ status: v.literal("unauthenticated") }),
    v.object({ status: v.literal("no_access") }),
    v.object({
      status: v.literal("ok"),
      sources: v.array(schema.doc("extractionJobSources")),
    }),
  ),
  handler: async (ctx, args) => {
    const access = await resolveReadableJob(ctx, args.jobId);
    if (access.status !== "ok") return access;

    const sources = await ctx.db
      .query("extractionJobSources")
      .withIndex("by_job_and_position", (q) => q.eq("jobId", args.jobId))
      .take(PAPER_LIMIT);

    return { status: "ok" as const, sources };
  },
});
