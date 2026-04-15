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

// ===================================================================
// QUALITY SAMPLING QUERIES (EVAL-05, EVAL-06)
// ===================================================================

/**
 * 7-day rolling quality trend from production sampling (EVAL-05).
 *
 * Returns aggregate counts of supported/unsupported/partial verdicts
 * and a passRate (supported / total). Returns null for unauthenticated requests.
 */
export const getQualityTrend = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      supported: v.number(),
      unsupported: v.number(),
      partial: v.number(),
      total: v.number(),
      passRate: v.number(),
    })
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const checks = await ctx.db
      .query("qualityChecks")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", sevenDaysAgo))
      .take(1000);

    let supported = 0;
    let unsupported = 0;
    let partial = 0;

    for (const check of checks) {
      if (check.verdict === "supported") supported++;
      else if (check.verdict === "unsupported") unsupported++;
      else partial++;
    }

    const total = checks.length;
    const passRate = total > 0 ? supported / total : 0;

    return { supported, unsupported, partial, total, passRate };
  },
});

/**
 * Pending human-review queue for quality-flagged extraction answers (EVAL-06).
 *
 * Returns quality checks with reviewStatus=pending, joined with answer
 * and paper data for review context. Bounded to 100 items.
 * Returns null for unauthenticated requests.
 */
export const getReviewQueue = query({
  args: {},
  returns: v.union(
    v.null(),
    v.array(
      v.object({
        qualityCheckId: v.id("qualityChecks"),
        answerId: v.id("extractionResults"),
        verdict: v.string(),
        judgeModel: v.string(),
        timestamp: v.number(),
        answer: v.union(v.string(), v.null()),
        question: v.union(v.string(), v.null()),
        evidenceQuote: v.union(v.string(), v.null()),
        paperTitle: v.union(v.string(), v.null()),
      })
    )
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    // Get pending review items, most recent first
    const pendingChecks = await ctx.db
      .query("qualityChecks")
      .withIndex("by_timestamp")
      .order("desc")
      .take(100);

    const pending = pendingChecks.filter((c) => c.reviewStatus === "pending");

    const items = [];
    for (const check of pending) {
      // Join with extraction result
      const result = await ctx.db.get(check.answerId);
      // Join with paper for title
      const paper = result ? await ctx.db.get(result.paperId) : null;
      // Get question text from job
      let questionText: string | null = null;
      if (result) {
        const job = await ctx.db.get(result.jobId);
        if (job) {
          const q = job.questions.find((q) => q.key === result.questionId);
          questionText = q?.question ?? null;
        }
      }

      items.push({
        qualityCheckId: check._id,
        answerId: check.answerId,
        verdict: check.verdict,
        judgeModel: check.judgeModel,
        timestamp: check.timestamp,
        answer: result?.answer ?? null,
        question: questionText,
        evidenceQuote: result?.evidenceQuote ?? null,
        paperTitle: paper?.title ?? null,
      });
    }

    return items;
  },
});

// ===================================================================
// RESULTS PAGE + EXPORT QUERIES (D-16, D-20)
// ===================================================================

/**
 * Get per-paper extraction results with nested question answers (D-16).
 *
 * Returns the job summary and all papers with their extraction results
 * for the results page. Each paper includes a flat array of answers
 * (one per question).
 *
 * Auth + ownership: getCurrentUser -> job.userId check -> null if unauthorized.
 * Bounded: papers capped at MAX_EXTRACTION_PAPERS_PER_JOB,
 *          results per paper capped at 100 (bounded by question count).
 */
export const getExtractionResults = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({
      job: v.object({
        _id: v.id("extractionJobs"),
        status: extractionJobStatusValidator,
        questions: v.array(extractionQuestionValidator),
        totalPapers: v.number(),
      }),
      papers: v.array(
        v.object({
          _id: v.id("extractionPapers"),
          title: v.string(),
          openalexId: v.string(),
          doi: v.optional(v.string()),
          status: extractionPaperStatusValidator,
          parsingSource: v.optional(parsingSourceValidator),
          results: v.array(
            v.object({
              questionId: v.string(),
              answer: v.union(v.string(), v.null()),
              confidence: v.optional(
                v.union(
                  v.literal("high"),
                  v.literal("medium"),
                  v.literal("low")
                )
              ),
              evidenceStartChar: v.optional(v.number()),
              evidenceEndChar: v.optional(v.number()),
              reasoning: v.optional(v.string()),
              modelUsed: v.optional(v.string()),
              criticVerdict: v.optional(v.string()),
            })
          ),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_EXTRACTION_PAPERS_PER_JOB);

    const papersWithResults = [];
    for (const paper of papers) {
      const results = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .take(100); // bounded by question count per paper

      papersWithResults.push({
        _id: paper._id,
        title: paper.title,
        openalexId: paper.openalexId,
        doi: paper.doi,
        status: paper.status,
        parsingSource: paper.parsingSource,
        results: results.map((r) => ({
          questionId: r.questionId,
          answer: r.answer,
          confidence: r.confidence,
          evidenceStartChar: r.evidenceStartChar,
          evidenceEndChar: r.evidenceEndChar,
          reasoning: r.reasoning,
          modelUsed: r.modelUsed,
          criticVerdict: r.criticVerdict,
        })),
      });
    }

    return {
      job: {
        _id: job._id,
        status: job.status,
        questions: job.questions,
        totalPapers: job.totalPapers,
      },
      papers: papersWithResults,
    };
  },
});

/**
 * Get flat denormalized extraction results for export (D-20).
 *
 * Returns one row per paper-question pair, suitable for direct
 * serialization into CSV/JSON/XLSX by lib/extraction/export.ts.
 * Includes question text resolved from the job's questions array.
 *
 * Auth + ownership: getCurrentUser -> job.userId check -> null if unauthorized.
 * Bounded: papers capped at MAX_EXTRACTION_PAPERS_PER_JOB,
 *          results per paper capped at 100.
 */
export const getExtractionResultsForExport = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({
      job: v.object({
        _id: v.id("extractionJobs"),
        status: extractionJobStatusValidator,
        questions: v.array(extractionQuestionValidator),
        totalPapers: v.number(),
        createdAt: v.number(),
        completedAt: v.optional(v.number()),
      }),
      results: v.array(
        v.object({
          paperTitle: v.string(),
          openalexId: v.string(),
          doi: v.optional(v.string()),
          parsingSource: v.optional(v.string()),
          questionKey: v.string(),
          question: v.string(),
          answer: v.union(v.string(), v.null()),
          confidence: v.optional(v.string()),
          criticVerdict: v.optional(v.string()),
          evidenceStartChar: v.optional(v.number()),
          evidenceEndChar: v.optional(v.number()),
          reasoning: v.optional(v.string()),
          modelUsed: v.optional(v.string()),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_EXTRACTION_PAPERS_PER_JOB);

    // Build a question key->question text lookup from job.questions
    const questionLookup = new Map(
      job.questions.map((q) => [q.key, q.question])
    );

    const flatResults = [];
    for (const paper of papers) {
      const results = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .take(100);

      for (const r of results) {
        flatResults.push({
          paperTitle: paper.title,
          openalexId: paper.openalexId,
          doi: paper.doi,
          parsingSource: paper.parsingSource,
          questionKey: r.questionId,
          question: questionLookup.get(r.questionId) ?? r.questionId,
          answer: r.answer,
          confidence: r.confidence,
          criticVerdict: r.criticVerdict,
          evidenceStartChar: r.evidenceStartChar,
          evidenceEndChar: r.evidenceEndChar,
          reasoning: r.reasoning,
          modelUsed: r.modelUsed,
        });
      }
    }

    return {
      job: {
        _id: job._id,
        status: job.status,
        questions: job.questions,
        totalPapers: job.totalPapers,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      },
      results: flatResults,
    };
  },
});
