import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import {
  extractionJobStatusValidator,
  extractionPaperStatusValidator,
  extractionQuestionValidator,
  parsingSourceValidator,
} from "./validators";
import { getCurrentUser } from "../lib/auth";
import { MAX_EXTRACTION_PAPERS_PER_JOB } from "../lib/queryBounds";
import { computeCostUsd } from "./logging";

/**
 * Get real-time progress of an extraction job.
 *
 * Returns a reactive progress object for the UI, or null if:
 * - User is not authenticated
 * - Job does not exist
 * - Job belongs to another user (user isolation, no info leak per T-89-05)
 */
export const getExtractionProgress = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({
      status: extractionJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      cancelledPapers: v.number(),
      percentComplete: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;

    const TERMINAL_STATUSES = ["completed", "cancelled", "failed"];
    const isTerminal = TERMINAL_STATUSES.includes(job.status);
    const handled =
      job.processedPapers + job.failedPapers + (job.cancelledPapers ?? 0);

    const rawPercent =
      job.totalPapers === 0
        ? 0
        : Math.floor((handled / job.totalPapers) * 100);

    // Never show 100% while the job is still active -- avoids the
    // Math.round(99.5)->100 rounding bug and the transaction-gap
    // window between counter increment and status finalization.
    const percentComplete = isTerminal ? 100 : Math.min(rawPercent, 99);

    return {
      status: job.status,
      totalPapers: job.totalPapers,
      processedPapers: job.processedPapers,
      failedPapers: job.failedPapers,
      cancelledPapers: job.cancelledPapers ?? 0,
      percentComplete,
    };
  },
});

/**
 * Get per-job operational and SLO metrics for the UI (OBS-04, OBS-05).
 *
 * Returns aggregated metrics computed from extractionPapers and
 * extractionResults tables, plus persisted SLO metrics from the job row.
 *
 * Auth follows getExtractionProgress pattern (D-17):
 * getCurrentUser -> job ownership check -> null if unauthorized.
 */
export const getExtractionJobMetrics = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({
      papersProcessed: v.number(),
      averageLatencyMs: v.union(v.number(), v.null()),
      estimatedCostUsd: v.number(),
      errorCount: v.number(),
      citationValidityRate: v.union(v.number(), v.null()),
      recallOnInclude: v.union(v.number(), v.null()),
    })
  ),
  handler: async (ctx, args) => {
    // Auth + ownership guard (D-17)
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;

    // Compute averageLatencyMs from completed papers (D-14)
    const completedPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "completed")
      )
      .take(MAX_EXTRACTION_PAPERS_PER_JOB);

    const latencies = completedPapers
      .filter((p) => p.completedAt != null && p.createdAt != null)
      .map((p) => p.completedAt! - p.createdAt);

    const averageLatencyMs =
      latencies.length > 0
        ? Math.round(
            latencies.reduce((sum, l) => sum + l, 0) / latencies.length
          )
        : null;

    // Compute estimatedCostUsd from results (D-15)
    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_EXTRACTION_PAPERS_PER_JOB * 10);

    const estimatedCostUsd = results.reduce(
      (sum, r) =>
        sum +
        computeCostUsd(
          r.modelUsed ?? "",
          r.tokensIn ?? 0,
          r.tokensOut ?? 0
        ),
      0
    );

    // errorCount from failed papers (D-16)
    const failedPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "failed")
      )
      .take(MAX_EXTRACTION_PAPERS_PER_JOB);
    const errorCount = failedPapers.length;

    // SLO metrics from job row (D-21)
    return {
      papersProcessed: job.processedPapers,
      averageLatencyMs,
      estimatedCostUsd,
      errorCount,
      citationValidityRate: job.citationValidityRate ?? null,
      recallOnInclude: job.recallOnInclude ?? null,
    };
  },
});

/**
 * List extraction jobs for the authenticated user, newest first.
 *
 * Returns a paginated list of job summaries (default limit 20).
 * Returns empty array for unauthenticated users.
 */
export const listUserExtractionJobs = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("extractionJobs"),
      status: extractionJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const jobs = await ctx.db
      .query("extractionJobs")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 20);

    return jobs.map((j) => ({
      _id: j._id,
      status: j.status,
      totalPapers: j.totalPapers,
      processedPapers: j.processedPapers,
      failedPapers: j.failedPapers,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
    }));
  },
});

/**
 * Get a paper's body text for verbatim evidence rendering (D-14).
 *
 * Returns the raw body text so the UI can render
 * `bodyText.slice(evidenceStartChar, evidenceEndChar)` — the LLM's
 * `evidenceQuote` field is never shown to users.
 *
 * User isolation: loads paper -> loads its job -> verifies job.userId
 * matches the authenticated user (T-92-01).
 */
export const getPaperBodyText = query({
  args: { paperId: v.id("extractionPapers") },
  returns: v.union(
    v.null(),
    v.object({ bodyText: v.union(v.string(), v.null()) })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const paper = await ctx.db.get(args.paperId);
    if (!paper) return null;

    const job = await ctx.db.get(paper.jobId);
    if (!job || job.userId !== user._id) return null;

    return { bodyText: paper.bodyText ?? null };
  },
});

// ===================================================================
// INTERNAL QUERIES (for workflow/workpool background context)
// ===================================================================

/**
 * Load an extraction job by ID from background context (no auth).
 *
 * Used by the extraction workflow and onComplete handlers where
 * there is no user identity available.
 */
export const getJobInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("extractionJobs"),
      userId: v.id("users"),
      status: extractionJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      questions: v.array(extractionQuestionValidator),
      workflowId: v.optional(v.string()),
      traceId: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;

    return {
      _id: job._id,
      userId: job.userId,
      status: job.status,
      totalPapers: job.totalPapers,
      processedPapers: job.processedPapers,
      failedPapers: job.failedPapers,
      questions: job.questions,
      workflowId: job.workflowId,
      traceId: job.traceId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  },
});

/**
 * Load a single extraction paper by ID from background context (no auth).
 *
 * Used by the workpool action to check paper state before processing
 * (idempotency guard, DOI/openalexId access for parseFullText).
 */
export const getPaperInternal = internalQuery({
  args: { paperId: v.id("extractionPapers") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("extractionPapers"),
      jobId: v.id("extractionJobs"),
      openalexId: v.string(),
      title: v.string(),
      doi: v.optional(v.string()),
      status: extractionPaperStatusValidator,
      bodyText: v.optional(v.string()),
      parsingSource: v.optional(parsingSourceValidator),
    })
  ),
  handler: async (ctx, args) => {
    const paper = await ctx.db.get(args.paperId);
    if (!paper) return null;

    return {
      _id: paper._id,
      jobId: paper.jobId,
      openalexId: paper.openalexId,
      title: paper.title,
      doi: paper.doi,
      status: paper.status,
      bodyText: paper.bodyText,
      parsingSource: paper.parsingSource,
    };
  },
});

/**
 * Load pending extraction papers for a job from background context (no auth).
 *
 * Returns up to MAX_EXTRACTION_PAPERS_PER_JOB pending papers for
 * the workflow to enqueue into the workpool.
 */
export const getPendingPapers = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.array(
    v.object({
      _id: v.id("extractionPapers"),
      openalexId: v.string(),
      title: v.string(),
      doi: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", args.jobId).eq("status", "pending")
      )
      .take(MAX_EXTRACTION_PAPERS_PER_JOB);

    return papers.map((p) => ({
      _id: p._id,
      openalexId: p.openalexId,
      title: p.title,
      doi: p.doi,
    }));
  },
});
