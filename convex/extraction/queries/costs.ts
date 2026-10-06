/** Live credit total for one job, for the cost badge and completion toast, and what a job would cost before it runs. */

import { query, type QueryCtx } from "../../_generated/server";
import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { getCurrentUser } from "../../lib/auth";
import { extractionPricing, extractionStamp } from "../../ai/serverModel";
import { extractionPaperCredits, extractionRetryCredits } from "../../../lib/pricing";
import { resolveOwnedJob } from "../access";
import { creditsAgg } from "../aggregates";
import { MAX_QUESTIONS_PER_JOB, questionTypeValidator } from "../validators";
import { readResultCounts } from "../resultCounts";

/**
 * Live per-job cost. Returns zeros for an unowned or missing job
 * (caller-safe: prevents scope leaks through the error channel).
 */
export const getJobCost = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    total: v.number(),
  }),
  handler: async (ctx, { jobId }) => {
    const owned = await resolveOwnedJob(ctx, jobId);
    if (owned.status !== "ok") {
      return { total: 0 };
    }

    const total = await creditsAgg.sum(ctx, { namespace: jobId });
    return { total };
  },
});

/**
 * The most a new job of `papers` papers and these questions costs the signed-in person, on the
 * models their extractions run on: what its start checks their balance against
 * (../mutations/jobs.ts `startJobFor`). Null when signed out.
 */
export const estimateJob = query({
  args: { papers: v.number(), questions: v.array(questionTypeValidator), usePdfs: v.boolean() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { papers, questions, usePdfs }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const pricing = await extractionPricing(ctx, await extractionStamp(ctx, user._id));
    return Math.max(0, papers) * extractionPaperCredits(pricing, questions.map((type) => ({ type })), usePdfs);
  },
});

/** The most retrying a job's `count` failed questions costs (../mutations/retry.ts). */
export async function retryCredits(ctx: QueryCtx, job: Doc<"extractionJobs">, count: number) {
  const questions = await ctx.db.query("extractionQuestions").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(MAX_QUESTIONS_PER_JOB);
  const textPerPaper = questions.filter((question) => question.type !== "boolean").length;
  return extractionRetryCredits(await extractionPricing(ctx, job), count, job.usePdfs ?? false, { textPerPaper, papers: job.totalPapers || count });
}

/** What retrying a job's failures costs, for the retry dialog. Zero for an unowned or missing job. */
export const estimateRetry = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.number(),
  handler: async (ctx, { jobId }) => {
    const owned = await resolveOwnedJob(ctx, jobId);
    if (owned.status !== "ok") return 0;
    return await retryCredits(ctx, owned.job, (await readResultCounts(ctx, jobId)).retryable);
  },
});
