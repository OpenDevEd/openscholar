import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Get a random eligible extraction result for quality sampling.
 * Eligible: has criticVerdict (completed critic pass), not already sampled in last 7 days.
 */
export const getRandomEligibleResult = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("extractionResults"),
      jobId: v.id("extractionJobs"),
      paperId: v.id("extractionPapers"),
      questionId: v.string(),
      answer: v.union(v.string(), v.null()),
      evidenceQuote: v.optional(v.string()),
      evidenceStartChar: v.optional(v.number()),
      evidenceEndChar: v.optional(v.number()),
    })
  ),
  handler: async (ctx) => {
    // Get completed results with critic verdicts (eligible for sampling)
    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_job")
      .take(500);

    // Filter to results that have a criticVerdict (completed full pipeline)
    const eligible = results.filter(
      (r) => r.criticVerdict != null && r.answer != null
    );
    if (eligible.length === 0) return null;

    // Check which have already been sampled in last 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentChecks = await ctx.db
      .query("qualityChecks")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", sevenDaysAgo))
      .take(1000);

    const recentlyCheckedIds = new Set(
      recentChecks.map((c) => String(c.answerId))
    );
    const unchecked = eligible.filter(
      (r) => !recentlyCheckedIds.has(String(r._id))
    );

    if (unchecked.length === 0) return null;

    // Pick a random one
    const picked = unchecked[Math.floor(Math.random() * unchecked.length)];
    return {
      _id: picked._id,
      jobId: picked.jobId,
      paperId: picked.paperId,
      questionId: picked.questionId,
      answer: picked.answer,
      evidenceQuote: picked.evidenceQuote,
      evidenceStartChar: picked.evidenceStartChar,
      evidenceEndChar: picked.evidenceEndChar,
    };
  },
});

/**
 * Load paper body text for quality sampling critic re-run.
 */
export const getPaperBodyTextInternal = internalQuery({
  args: { paperId: v.id("extractionPapers") },
  returns: v.union(
    v.null(),
    v.object({ bodyText: v.union(v.string(), v.null()) })
  ),
  handler: async (ctx, args) => {
    const paper = await ctx.db.get(args.paperId);
    if (!paper) return null;
    return { bodyText: paper.bodyText ?? null };
  },
});

/**
 * Load question text from the job's embedded questions array.
 */
export const getQuestionText = internalQuery({
  args: { jobId: v.id("extractionJobs"), questionId: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const q = job.questions.find((q) => q.key === args.questionId);
    return q?.question ?? null;
  },
});

/**
 * Write a quality check result (D-15, D-19).
 */
export const writeQualityCheck = internalMutation({
  args: {
    answerId: v.id("extractionResults"),
    verdict: v.string(),
    judgeModel: v.string(),
    timestamp: v.number(),
    reviewStatus: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("qualityChecks", {
      answerId: args.answerId,
      verdict: args.verdict,
      judgeModel: args.judgeModel,
      timestamp: args.timestamp,
      reviewStatus: args.reviewStatus,
    });
    return null;
  },
});
