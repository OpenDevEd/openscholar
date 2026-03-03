/**
 * Extraction Queries
 * Queries for retrieving extraction job data
 */

import { query, internalQuery, type QueryCtx } from "../_generated/server";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import { noAccess, notFound, ok, unauthenticated } from "../lib/query_states";
import {
  getProcessableFlags,
  isPdfExtractionEnabled,
  MIN_ABSTRACT_LENGTH,
} from "./content";
import { requireExtractionEnabled } from "./guard";
import {
  aggregateQuestionInsights,
  buildArrayAnswerProfileClusters,
  buildDisagreementClusters,
  type CitationStatus,
  type DisagreementCluster,
  type InsightEntry,
  type QuestionType,
  type ReviewState,
} from "../../lib/extraction/insights";
import { createError } from "../lib/errors";
import {
  extractionJobValidator,
  extractionQuestionValidator,
  extractionPaperValidator,
  extractionResultWithReviewValidator,
  extractionSavedViewValidator,
  extractionReportSnapshotValidator,
  extractionRunDiffValidator,
  questionTypeValidator,
  citationStatusValidator,
  reviewStateValidator,
  answerValidator,
  jobStatusValidator,
  paperStatusValidator,
  searchFiltersValidator,
  paginatedPaperWithResultsValidator,
} from "./validators";
import { statusResultValidator } from "../lib/query_states";

/** Result document with optional review overlay fields from attachReviewMetadata. */
type ResultWithReview = Doc<"extractionResults"> & {
  reviewState?: ReviewState;
  reviewNote?: string;
  correctedAnswer?: Doc<"extractionResults">["answer"];
  reviewedAt?: number;
  reviewedBy?: Id<"users">;
};

type OwnedJobResolution =
  | { status: "ok"; user: Doc<"users">; job: Doc<"extractionJobs"> }
  | { status: "unauthenticated" }
  | { status: "no_access" };

async function resolveOwnedJob(
  ctx: QueryCtx,
  jobId: Id<"extractionJobs">
): Promise<OwnedJobResolution> {
  const user = await getCurrentUser(ctx);
  if (!user) return unauthenticated();

  const job = await ctx.db.get(jobId);
  if (!job || job.userId !== user._id) return noAccess();

  return ok({ user, job });
}

type OwnedPaperResolution =
  | { status: "ok"; user: Doc<"users">; job: Doc<"extractionJobs">; paper: Doc<"extractionPapers"> }
  | { status: "unauthenticated" }
  | { status: "no_access" };

async function resolveOwnedPaper(
  ctx: QueryCtx,
  paperId: Id<"extractionPapers">
): Promise<OwnedPaperResolution> {
  const user = await getCurrentUser(ctx);
  if (!user) return unauthenticated();

  const paper = await ctx.db.get(paperId);
  if (!paper) return noAccess();

  const job = await ctx.db.get(paper.jobId);
  if (!job || job.userId !== user._id) return noAccess();

  return ok({ user, job, paper });
}

function hasUsableAbstract(abstract?: string) {
  return typeof abstract === "string" && abstract.trim().length > MIN_ABSTRACT_LENGTH;
}

function hasUsablePdfSource(paper: Doc<"extractionPapers">) {
  return Boolean(
    paper.pdfUrl ||
      paper.storageId ||
      paper.ragEntryId ||
      paper.isIndexed
  );
}

function toReviewState(value?: string): ReviewState | undefined {
  if (
    value === "unreviewed" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "needs_followup"
  ) {
    return value;
  }
  return undefined;
}

function toCitationStatus(value?: string): CitationStatus | undefined {
  if (
    value === "grounded" ||
    value === "best_effort" ||
    value === "insufficient_evidence" ||
    value === "extraction_error"
  ) {
    return value;
  }
  return undefined;
}

async function attachReviewMetadata(
  ctx: QueryCtx,
  paperId: Id<"extractionPapers">,
  results: Doc<"extractionResults">[]
) {
  const reviews = await ctx.db
    .query("extractionResultReviews")
    .withIndex("by_paper", (q) => q.eq("paperId", paperId))
    .collect();
  const reviewByResultId = new Map<string, Doc<"extractionResultReviews">>(
    reviews.map((review) => [review.resultId, review])
  );

  return results.map((result): ResultWithReview => {
    const review = reviewByResultId.get(result._id);
    if (!review) return result;
    return {
      ...result,
      reviewState: toReviewState(review.state),
      reviewNote: review.note,
      correctedAnswer: review.correctedAnswer,
      reviewedAt: review.reviewedAt,
      reviewedBy: review.reviewedBy,
    };
  });
}

/**
 * Load ALL reviews for a job in a single batch query (uses by_job index).
 * Returns a Map keyed by resultId for O(1) lookup.
 * This replaces per-paper review queries to eliminate N+1 patterns.
 */
async function loadReviewsByJob(ctx: QueryCtx, jobId: Id<"extractionJobs">) {
  const allReviews = await ctx.db
    .query("extractionResultReviews")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .collect();
  return new Map<string, Doc<"extractionResultReviews">>(
    allReviews.map((review) => [review.resultId, review])
  );
}

/**
 * Apply pre-loaded review metadata to results synchronously (no database calls).
 * Use with loadReviewsByJob for batch processing of multiple papers.
 */
function applyReviewMetadata(
  results: Doc<"extractionResults">[],
  reviewMap: Map<string, Doc<"extractionResultReviews">>
): ResultWithReview[] {
  return results.map((result): ResultWithReview => {
    const review = reviewMap.get(result._id);
    if (!review) return result;
    return {
      ...result,
      reviewState: toReviewState(review.state),
      reviewNote: review.note,
      correctedAnswer: review.correctedAnswer,
      reviewedAt: review.reviewedAt,
      reviewedBy: review.reviewedBy,
    };
  });
}

function buildQuestionInfoByKey(questions: Doc<"extractionQuestions">[]) {
  return new Map(
    questions.map((question) => [
      question.key,
      {
        key: question.key,
        question: question.question,
        type: question.type,
        description: question.description,
      },
    ])
  );
}

async function loadJobPapersAndResults(ctx: QueryCtx, jobId: Id<"extractionJobs">) {
  const questions = await ctx.db
    .query("extractionQuestions")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .order("asc")
    .collect();

  const papers = await ctx.db
    .query("extractionPapers")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .collect();

  // Load all reviews for the job in a single batch query (fixes N+1)
  const reviewMap = await loadReviewsByJob(ctx, jobId);

  const resultsByPaper = new Map<string, ResultWithReview[]>();
  await Promise.all(papers.map(async (paper) => {
    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
      .collect();
    resultsByPaper.set(
      paper._id,
      applyReviewMetadata(results, reviewMap)
    );
  }));

  return { questions, papers, resultsByPaper };
}

const paginatedPaperResultValidator = paginationResultValidator(paginatedPaperWithResultsValidator);

// Get user's extraction jobs (public API)
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
        v.literal("cancelled")
      )
    ),
  },
  returns: v.array(
    v.object({
      _id: v.id("extractionJobs"),
      _creationTime: v.number(),
      userId: v.id("users"),
      sourceType: v.union(v.literal("history"), v.literal("zotero"), v.literal("manual"), v.literal("mixed")),
      sourceHistoryId: v.optional(v.string()),
      sourceZoteroCollection: v.optional(v.string()),
      sourceHistoryEntries: v.optional(v.array(v.object({ historyId: v.string(), searchFilters: searchFiltersValidator }))),
      sourceZoteroSelection: v.optional(v.object({
        libraryType: v.union(v.literal("user"), v.literal("group")),
        groupId: v.optional(v.string()),
        zoteroUserId: v.optional(v.string()),
        collectionKey: v.optional(v.string()),
        includeDescendants: v.optional(v.boolean()),
        items: v.array(v.object({ itemKey: v.string(), title: v.string(), abstract: v.optional(v.string()), authors: v.array(v.string()), year: v.optional(v.number()), doi: v.optional(v.string()) }))
      })),
      sourceManualItems: v.optional(v.array(v.object({
        id: v.string(), title: v.string(), abstract: v.optional(v.string()), authors: v.optional(v.array(v.string())), year: v.optional(v.number()), doi: v.optional(v.string()), pdfUrl: v.optional(v.string()), storageId: v.optional(v.id("_storage"))
      }))),
      searchFilters: v.optional(searchFiltersValidator),
      status: v.union(v.literal("pending"), v.literal("downloading_pdfs"), v.literal("indexing"), v.literal("extracting"), v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      workflowId: v.optional(v.string()),
      name: v.string(),
      description: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    // Handle unauthenticated gracefully
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    let jobs: Doc<"extractionJobs">[];
    if (args.status) {
      jobs = await ctx.db
        .query("extractionJobs")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", user._id).eq("status", args.status!)
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

    if (jobs.length === 0) {
      return jobs;
    }

    return jobs;
  },
});

// Get job details with progress (public API)
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
    requireExtractionEnabled();
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }
    const { job } = access;

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_processable", (q) =>
        q.eq("jobId", args.jobId).eq("processable", true)
      )
      .order("asc")
      .collect();

    const processablePapers = papers.filter((p) => p.processable !== false);
    const processed = processablePapers.filter((p) => p.status === "completed").length;
    const failed = processablePapers.filter(
      (p) =>
        p.status === "failed" ||
        p.status === "download_failed" ||
        p.status === "indexing_failed"
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

// Get paper extraction results (public API)
export const getPaperResults = query({
  args: { paperId: v.id("extractionPapers") },
  returns: statusResultValidator({
    paper: extractionPaperValidator,
    results: v.array(extractionResultWithReviewValidator),
  }),
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    const access = await resolveOwnedPaper(ctx, args.paperId);
    if (access.status !== "ok") {
      return access;
    }
    const { paper } = access;

    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();

    const resultsWithReviews = await attachReviewMetadata(ctx, args.paperId, results);

    return ok({ paper, results: resultsWithReviews });
  },
});

export const getPaperResultsInternal = internalQuery({
  args: { paperId: v.id("extractionPapers") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();
  },
});

export const getPdfExtractionEnabledInternal = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async () => {
    return isPdfExtractionEnabled();
  },
});

export const getPaperPdfUrl = query({
  args: { paperId: v.id("extractionPapers") },
  returns: v.union(
    v.object({
      status: v.literal("ok"),
      pdfUrl: v.union(v.string(), v.null()),
    }),
    v.object({ status: v.literal("unauthenticated") }),
    v.object({ status: v.literal("no_access") })
  ),
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    const access = await resolveOwnedPaper(ctx, args.paperId);
    if (access.status !== "ok") {
      return access;
    }

    if (!isPdfExtractionEnabled()) {
      return ok({ pdfUrl: null });
    }

    const { paper } = access;

    let pdfUrl: string | null = null;
    if (paper.storageId) {
      pdfUrl = await ctx.storage.getUrl(paper.storageId);
    } else {
      pdfUrl = paper.pdfUrl || null;
    }

    return ok({ pdfUrl });
  },
});

// Get all results for a job (public API) - for export
export const getJobResults = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    job: extractionJobValidator,
    questions: v.array(extractionQuestionValidator),
    papers: v.record(
      v.string(),
      v.object({
        paper: extractionPaperValidator,
        results: v.array(extractionResultWithReviewValidator),
      })
    ),
  }),
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }
    const { job } = access;

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    // Load all reviews for the job in a single batch query (fixes N+1)
    const reviewMap = await loadReviewsByJob(ctx, args.jobId);

    // Get all results for all papers
    const allResults: Record<
      string,
      { paper: Doc<"extractionPapers">; results: Doc<"extractionResults">[] }
    > = {};

    for (const paper of papers) {
      const results = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect();
      const resultsWithReviews = applyReviewMetadata(results, reviewMap);

      allResults[paper._id] = {
        paper,
        results: resultsWithReviews,
      };
    }

    return ok({
      job,
      questions,
      papers: allResults,
    });
  },
});

// Get paginated results for a job
export const getJobResultsPaginated = query({
  args: {
    jobId: v.id("extractionJobs"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.union(
    v.object({
      status: v.literal("ok"),
      ...paginatedPaperResultValidator.fields,
    }),
    v.object({
      status: v.union(v.literal("unauthenticated"), v.literal("no_access")),
      ...paginatedPaperResultValidator.fields,
    })
  ),
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return {
        status: access.status,
        page: [],
        isDone: true,
        continueCursor: "",
        splitCursor: null,
        pageStatus: null,
      };
    }

    const result = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_processable", (q) =>
        q.eq("jobId", args.jobId).eq("processable", true)
      )
      //.order("desc") // User wants oldest (processing) first? Or if FIFO queue. 
      // If user said "scroll to bottom to see updates" and it WAS desc, then updates were at bottom -> Oldest were at bottom.
      // So FIFO processing matches desc list having updates at bottom.
      // To see updates at TOP, we need ASC (Oldest at top).
      .order("asc")
      .paginate(args.paginationOpts);

    // Load all reviews for the job in a single batch query (fixes N+1)
    const reviewMap = await loadReviewsByJob(ctx, args.jobId);

    const papersWithResults = await Promise.all(
      result.page.map(async (paper) => {
        const results = await ctx.db
          .query("extractionResults")
          .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
          .collect();
        const resultsWithReviews = applyReviewMetadata(results, reviewMap);
        return {
          ...paper,
          results: resultsWithReviews,
        };
      })
    );

    return {
      status: "ok" as const,
      ...result,
      page: papersWithResults,
    };
  },
});

export const getJobInsights = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    job: v.object({
      id: v.id("extractionJobs"),
      name: v.string(),
    }),
    summary: v.object({
      totalPapers: v.number(),
      totalQuestions: v.number(),
      answeredTotal: v.number(),
      groundedTotal: v.number(),
      answeredRate: v.number(),
      groundedRate: v.number(),
      bestEffortRate: v.number(),
      averageConfidence: v.number(),
      averageEffectiveConfidence: v.number(),
      noContentCount: v.number(),
      abstractOnlyCount: v.number(),
    }),
    questions: v.array(
      v.object({
        key: v.string(),
        question: v.string(),
        type: questionTypeValidator,
        description: v.optional(v.string()),
        total: v.number(),
        answered: v.number(),
        grounded: v.number(),
        avgConfidence: v.number(),
        avgEffectiveConfidence: v.number(),
        confidenceBuckets: v.object({
          high: v.number(),
          medium: v.number(),
          low: v.number(),
          unknown: v.number(),
        }),
        citationStatusMix: v.object({
          grounded: v.number(),
          best_effort: v.number(),
          insufficient_evidence: v.number(),
          extraction_error: v.number(),
        }),
        topAnswers: v.array(
          v.object({
            normalized: v.string(),
            display: v.string(),
            count: v.number(),
            avgConfidence: v.number(),
            paperIds: v.array(v.string()),
          })
        ),
        entityDistribution: v.array(
          v.object({
            entity: v.string(),
            count: v.number(),
            paperIds: v.array(v.string()),
            avgConfidence: v.number(),
            groundedRate: v.number(),
            generic: v.boolean(),
          })
        ),
        insightMode: v.string(),
        reviewed: v.object({
          accepted: v.number(),
          rejected: v.number(),
          needsFollowup: v.number(),
          unreviewed: v.number(),
        }),
      })
    ),
    diagnostics: v.object({
      noContentPapers: v.array(
        v.object({
          paperId: v.string(),
          title: v.string(),
          reason: v.string(),
        })
      ),
    }),
  }),
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }
    const { job } = access;

    const { questions, papers, resultsByPaper } = await loadJobPapersAndResults(ctx, args.jobId);
    const processablePapers = papers.filter(
      (paper: Doc<"extractionPapers">) => paper.processable !== false
    );
    const questionEntries = new Map<string, InsightEntry[]>();
    const noContentPapers: Array<{ paperId: string; title: string; reason: string }> = [];
    let abstractOnlyCount = 0;
    let answeredTotal = 0;
    let groundedTotal = 0;
    let bestEffortTotal = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;
    let effectiveConfidenceSum = 0;
    let effectiveConfidenceCount = 0;

    for (const question of questions) {
      questionEntries.set(question.key, []);
    }

    for (const paper of processablePapers) {
      const hasAbstract = hasUsableAbstract(paper.abstract);
      const hasPdf = hasUsablePdfSource(paper);
      if (!hasPdf && !hasAbstract) {
        noContentPapers.push({
          paperId: paper._id,
          title: paper.title,
          reason: "No usable PDF and no abstract",
        });
      }
      if (!paper.pdfContentUsed && hasAbstract) {
        abstractOnlyCount += 1;
      }

      const paperResults = resultsByPaper.get(paper._id) || [];
      const resultByQuestionKey = new Map(paperResults.map((result) => [result.questionKey, result]));

      for (const question of questions) {
        const result = resultByQuestionKey.get(question.key);
        const entry: InsightEntry = {
          paperId: paper._id,
          title: paper.title,
          openalexId: paper.openalexId,
          questionKey: question.key,
          answer: result?.correctedAnswer ?? result?.answer ?? null,
          confidence: result?.confidence,
          citationStatus: toCitationStatus(result?.citationStatus),
          pdfContentUsed: Boolean(result?.pdfContentUsed),
          reviewState: toReviewState(result?.reviewState),
        };
        questionEntries.get(question.key)!.push(entry);
      }
    }

    const questionInsights = questions.map((question: Doc<"extractionQuestions">) => {
      const entries = questionEntries.get(question.key) || [];
      const aggregate = aggregateQuestionInsights(entries, question.type);
      answeredTotal += aggregate.answered;
      groundedTotal += aggregate.grounded;
      bestEffortTotal += aggregate.citationStatusMix.best_effort;
      if (aggregate.total > 0) {
        confidenceSum += aggregate.avgConfidence * aggregate.total;
        confidenceCount += aggregate.total;
        effectiveConfidenceSum += aggregate.avgEffectiveConfidence * aggregate.total;
        effectiveConfidenceCount += aggregate.total;
      }
      return {
        key: question.key,
        question: question.question,
        type: question.type,
        description: question.description,
        ...aggregate,
      };
    });

    const totalExpectedAnswers = processablePapers.length * Math.max(questions.length, 1);
    const answeredRate =
      totalExpectedAnswers > 0 ? answeredTotal / totalExpectedAnswers : 0;
    const groundedRate =
      totalExpectedAnswers > 0 ? groundedTotal / totalExpectedAnswers : 0;
    const bestEffortRate =
      totalExpectedAnswers > 0 ? bestEffortTotal / totalExpectedAnswers : 0;

    return ok({
      job: {
        id: job._id,
        name: job.name,
      },
      summary: {
        totalPapers: processablePapers.length,
        totalQuestions: questions.length,
        answeredTotal,
        groundedTotal,
        answeredRate,
        groundedRate,
        bestEffortRate,
        averageConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
        averageEffectiveConfidence:
          effectiveConfidenceCount > 0
            ? effectiveConfidenceSum / effectiveConfidenceCount
            : 0,
        noContentCount: noContentPapers.length,
        abstractOnlyCount,
      },
      questions: questionInsights,
      diagnostics: {
        noContentPapers: noContentPapers.slice(0, 20),
      },
    });
  },
});

export const getQuestionInsights = query({
  args: {
    jobId: v.id("extractionJobs"),
    questionKey: v.string(),
  },
  returns: statusResultValidator(
    {
      question: v.object({
        key: v.string(),
        question: v.string(),
        type: questionTypeValidator,
        description: v.optional(v.string()),
      }),
      total: v.number(),
      answered: v.number(),
      grounded: v.number(),
      avgConfidence: v.number(),
      avgEffectiveConfidence: v.number(),
      insightMode: v.string(),
      confidenceBuckets: v.object({
        high: v.number(),
        medium: v.number(),
        low: v.number(),
        unknown: v.number(),
      }),
      citationStatusMix: v.object({
        grounded: v.number(),
        best_effort: v.number(),
        insufficient_evidence: v.number(),
        extraction_error: v.number(),
      }),
      reviewed: v.object({
        accepted: v.number(),
        rejected: v.number(),
        needsFollowup: v.number(),
        unreviewed: v.number(),
      }),
      topAnswers: v.array(
        v.object({
          normalized: v.string(),
          display: v.string(),
          count: v.number(),
          avgConfidence: v.number(),
          paperIds: v.array(v.string()),
          examples: v.array(
            v.object({
              paperId: v.string(),
              title: v.string(),
              openalexId: v.string(),
              answer: answerValidator,
              confidence: v.optional(v.number()),
            })
          ),
        })
      ),
      rawAnswerDistribution: v.array(
        v.object({
          normalized: v.string(),
          display: v.string(),
          count: v.number(),
          avgConfidence: v.number(),
          paperIds: v.array(v.string()),
          examples: v.array(
            v.object({
              paperId: v.string(),
              title: v.string(),
              openalexId: v.string(),
              answer: answerValidator,
              confidence: v.optional(v.number()),
            })
          ),
        })
      ),
      entityDistribution: v.array(
        v.object({
          entity: v.string(),
          count: v.number(),
          paperIds: v.array(v.string()),
          avgConfidence: v.number(),
          groundedRate: v.number(),
          generic: v.boolean(),
        })
      ),
    },
    true // includeNotFound
  ),
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }
    const { job } = access;

    const { questions, papers, resultsByPaper } = await loadJobPapersAndResults(ctx, args.jobId);
    const question = questions.find(
      (q: Doc<"extractionQuestions">) => q.key === args.questionKey
    );
    if (!question) {
      return notFound();
    }

    const entries: InsightEntry[] = [];
    for (const paper of papers.filter((item: Doc<"extractionPapers">) => item.processable !== false)) {
      const result = (resultsByPaper.get(paper._id) || []).find(
        (row) => row.questionKey === args.questionKey
      );
      entries.push({
        paperId: paper._id,
        title: paper.title,
        openalexId: paper.openalexId,
        questionKey: args.questionKey,
        answer: result?.correctedAnswer ?? result?.answer ?? null,
        confidence: result?.confidence,
        citationStatus: toCitationStatus(result?.citationStatus),
        pdfContentUsed: Boolean(result?.pdfContentUsed),
        reviewState: toReviewState(result?.reviewState),
      });
    }

    const aggregate = aggregateQuestionInsights(entries, question.type);
    const rawAnswerDistribution = aggregate.topAnswers.map((answer) => ({
      ...answer,
      examples: entries
        .filter((entry) => answer.paperIds.includes(entry.paperId))
        .slice(0, 5)
        .map((entry) => ({
          paperId: entry.paperId,
          title: entry.title,
          openalexId: entry.openalexId,
          answer: entry.answer,
          confidence: entry.confidence,
        })),
    }));

    console.info(
      "[getQuestionInsights] mode selected",
      JSON.stringify({
        jobId: args.jobId,
        questionKey: args.questionKey,
        questionType: question.type,
        mode: aggregate.insightMode,
        rawAnswerBuckets: rawAnswerDistribution.length,
        entityBuckets: aggregate.entityDistribution.length,
      })
    );

    return ok({
      question: {
        key: question.key,
        question: question.question,
        type: question.type,
        description: question.description,
      },
      ...aggregate,
      rawAnswerDistribution,
      topAnswers: rawAnswerDistribution,
    });
  },
});

export const getQuestionDisagreements = query({
  args: {
    jobId: v.id("extractionJobs"),
    questionKey: v.string(),
  },
  returns: statusResultValidator(
    {
      question: v.object({
        key: v.string(),
        question: v.string(),
        type: questionTypeValidator,
      }),
      viewMode: v.union(v.literal("disagreement"), v.literal("answer_profiles")),
      hasDisagreement: v.boolean(),
      clusterCount: v.number(),
      totalClusterCount: v.number(),
      suppressedSingletonCount: v.number(),
      clusters: v.array(
        v.object({
          normalizedAnswer: v.string(),
          displayAnswer: v.string(),
          count: v.number(),
          avgConfidence: v.number(),
          citationStatusMix: v.object({
            grounded: v.number(),
            best_effort: v.number(),
            insufficient_evidence: v.number(),
            extraction_error: v.number(),
          }),
          examples: v.array(
            v.object({
              paperId: v.string(),
              title: v.string(),
              openalexId: v.string(),
              answer: answerValidator,
              confidence: v.optional(v.number()),
            })
          ),
        })
      ),
    },
    true // includeNotFound
  ),
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }
    const { job } = access;

    const { questions, papers, resultsByPaper } = await loadJobPapersAndResults(ctx, args.jobId);
    const question = questions.find(
      (q: Doc<"extractionQuestions">) => q.key === args.questionKey
    );
    if (!question) {
      return notFound();
    }

    const entries: InsightEntry[] = [];
    for (const paper of papers.filter((item: Doc<"extractionPapers">) => item.processable !== false)) {
      const result = (resultsByPaper.get(paper._id) || []).find(
        (row) => row.questionKey === args.questionKey
      );
      entries.push({
        paperId: paper._id,
        title: paper.title,
        openalexId: paper.openalexId,
        questionKey: args.questionKey,
        answer: result?.correctedAnswer ?? result?.answer ?? null,
        confidence: result?.confidence,
        citationStatus: toCitationStatus(result?.citationStatus),
        reviewState: toReviewState(result?.reviewState),
      });
    }

    let viewMode: "disagreement" | "answer_profiles" = "disagreement";
    let suppressedSingletonCount = 0;
    let totalClusterCount = 0;
    let clusters: DisagreementCluster[] = [];

    if (question.type === "array") {
      viewMode = "answer_profiles";
      const profile = buildArrayAnswerProfileClusters(entries, {
        minClusterSize: 2,
        maxClusters: 20,
      });
      clusters = profile.clusters;
      suppressedSingletonCount = profile.suppressedSingletonCount;
      totalClusterCount = profile.totalClusterCount;
    } else {
      clusters = buildDisagreementClusters(entries, question.type, 20);
      totalClusterCount = clusters.length;
    }

    console.info(
      "[getQuestionDisagreements] cluster diagnostics",
      JSON.stringify({
        jobId: args.jobId,
        questionKey: args.questionKey,
        questionType: question.type,
        mode: viewMode,
        clusterCount: clusters.length,
        totalClusterCount,
        suppressedSingletonCount,
      })
    );

    return ok({
      question: {
        key: question.key,
        question: question.question,
        type: question.type,
      },
      viewMode,
      hasDisagreement:
        viewMode === "disagreement" ? clusters.length > 1 : clusters.length > 0,
      clusterCount: clusters.length,
      totalClusterCount,
      suppressedSingletonCount,
      clusters,
    });
  },
});

export const getReviewQueue = query({
  args: {
    jobId: v.id("extractionJobs"),
    states: v.optional(
      v.array(
        v.union(
          v.literal("unreviewed"),
          v.literal("accepted"),
          v.literal("rejected"),
          v.literal("needs_followup")
        )
      )
    ),
    onlyInsufficientEvidence: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: statusResultValidator({
    counts: v.object({
      total: v.number(),
      unreviewed: v.number(),
      accepted: v.number(),
      rejected: v.number(),
      needsFollowup: v.number(),
      insufficientEvidence: v.number(),
    }),
    items: v.array(
      v.object({
        resultId: v.id("extractionResults"),
        paperId: v.id("extractionPapers"),
        paperTitle: v.string(),
        openalexId: v.string(),
        questionKey: v.string(),
        question: v.string(),
        questionType: v.optional(questionTypeValidator),
        answer: answerValidator,
        confidence: v.optional(v.number()),
        reasoning: v.optional(v.string()),
        citations: v.array(
          v.object({
            evidenceId: v.string(),
            page: v.number(),
            charRange: v.array(v.number()),
            quote: v.string(),
            retrieval: v.object({
              denseScore: v.optional(v.number()),
              lexicalScore: v.optional(v.number()),
              fusedScore: v.optional(v.number()),
              rerankScore: v.optional(v.number()),
            }),
            validated: v.boolean(),
          })
        ),
        citationStatus: citationStatusValidator,
        reviewState: reviewStateValidator,
        reviewNote: v.optional(v.string()),
        correctedAnswer: v.optional(answerValidator),
        reviewedAt: v.optional(v.number()),
      })
    ),
  }),
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }

    const { questions, papers, resultsByPaper } = await loadJobPapersAndResults(ctx, args.jobId);
    const questionByKey = buildQuestionInfoByKey(questions);
    const allowedStates = new Set(args.states || []);
    const includeStateFilter = allowedStates.size > 0;
    const items: Array<{
      resultId: Id<"extractionResults">;
      paperId: Id<"extractionPapers">;
      paperTitle: string;
      openalexId: string;
      questionKey: string;
      question: string;
      questionType: QuestionType | undefined;
      answer: Doc<"extractionResults">["answer"];
      confidence: number | undefined;
      reasoning: string | undefined;
      citations: Doc<"extractionResults">["citations"];
      citationStatus: Doc<"extractionResults">["citationStatus"];
      reviewState: ReviewState;
      reviewNote: string | undefined;
      correctedAnswer: Doc<"extractionResults">["answer"] | undefined;
      reviewedAt: number | undefined;
    }> = [];

    for (const paper of papers.filter((row: Doc<"extractionPapers">) => row.processable !== false)) {
      const results = resultsByPaper.get(paper._id) || [];
      for (const result of results) {
        const reviewState = toReviewState(result.reviewState) || "unreviewed";
        if (includeStateFilter && !allowedStates.has(reviewState)) {
          continue;
        }
        if (
          args.onlyInsufficientEvidence &&
          result.citationStatus !== "insufficient_evidence"
        ) {
          continue;
        }
        const question = questionByKey.get(result.questionKey);
        items.push({
          resultId: result._id,
          paperId: paper._id,
          paperTitle: paper.title,
          openalexId: paper.openalexId,
          questionKey: result.questionKey,
          question: question?.question || result.questionKey,
          questionType: question?.type,
          answer: result.correctedAnswer ?? result.answer,
          confidence: result.confidence,
          reasoning: result.reasoning,
          citations: result.citations,
          citationStatus: result.citationStatus,
          reviewState,
          reviewNote: result.reviewNote,
          correctedAnswer: result.correctedAnswer,
          reviewedAt: result.reviewedAt,
        });
      }
    }

    const statePriority: Record<string, number> = {
      unreviewed: 0,
      needs_followup: 1,
      rejected: 2,
      accepted: 3,
    };
    items.sort((a, b) => {
      if ((statePriority[a.reviewState] ?? 9) !== (statePriority[b.reviewState] ?? 9)) {
        return (statePriority[a.reviewState] ?? 9) - (statePriority[b.reviewState] ?? 9);
      }
      const aInsufficient = a.citationStatus === "insufficient_evidence" ? 0 : 1;
      const bInsufficient = b.citationStatus === "insufficient_evidence" ? 0 : 1;
      if (aInsufficient !== bInsufficient) return aInsufficient - bInsufficient;
      return (b.confidence || 0) - (a.confidence || 0);
    });

    const counts = {
      total: items.length,
      unreviewed: items.filter((item) => item.reviewState === "unreviewed").length,
      accepted: items.filter((item) => item.reviewState === "accepted").length,
      rejected: items.filter((item) => item.reviewState === "rejected").length,
      needsFollowup: items.filter((item) => item.reviewState === "needs_followup").length,
      insufficientEvidence: items.filter(
        (item) => item.citationStatus === "insufficient_evidence"
      ).length,
    };

    return ok({
      counts,
      items: items.slice(0, Math.max(1, Math.min(args.limit ?? 200, 1000))),
    });
  },
});

export const getSavedViews = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    views: v.array(extractionSavedViewValidator),
  }),
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }

    const views = await ctx.db
      .query("extractionSavedViews")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .collect();
    return ok({ views });
  },
});

export const getWorkflowTemplates = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("extractionWorkflowTemplates"),
    _creationTime: v.number(),
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    sourceType: v.union(v.literal("history"), v.literal("zotero"), v.literal("manual"), v.literal("mixed")),
    sourceHistoryEntries: v.optional(v.array(v.object({ historyId: v.string(), searchFilters: searchFiltersValidator }))),
    sourceZoteroSelection: v.optional(v.object({
      libraryType: v.union(v.literal("user"), v.literal("group")),
      groupId: v.optional(v.string()),
      zoteroUserId: v.optional(v.string()),
      collectionKey: v.optional(v.string()),
      includeDescendants: v.optional(v.boolean()),
      items: v.array(v.object({ itemKey: v.string(), title: v.string(), abstract: v.optional(v.string()), authors: v.array(v.string()), year: v.optional(v.number()), doi: v.optional(v.string()) }))
    })),
    sourceManualItems: v.optional(v.array(v.object({
      id: v.string(), title: v.string(), abstract: v.optional(v.string()), authors: v.optional(v.array(v.string())), year: v.optional(v.number()), doi: v.optional(v.string()), pdfUrl: v.optional(v.string()), storageId: v.optional(v.id("_storage"))
    }))),
    questions: v.array(v.object({
      key: v.string(),
      question: v.string(),
      type: v.union(v.literal("string"), v.literal("boolean"), v.literal("number"), v.literal("array")),
      description: v.optional(v.string()),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })),
  handler: async (ctx) => {
    requireExtractionEnabled();
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    return await ctx.db
      .query("extractionWorkflowTemplates")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
  },
});

export const getReportSnapshots = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    reports: v.array(extractionReportSnapshotValidator),
  }),
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }

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
    requireExtractionEnabled();
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }

    if (args.diffId) {
      const diff = await ctx.db.get(args.diffId);
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

// Internal queries (called by workflow/actions)

export const getJobInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

export const debugRecentPapers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const papers = await ctx.db.query("extractionPapers")
      .order("desc")
      .take(10);
      
    return papers.map(p => ({
      id: p._id,
      title: p.title.substring(0, 30),
      status: p.status,
      pdfUrl: !!p.pdfUrl,
      storageId: p.storageId,
      ragEntryId: p.ragEntryId,
      errorMessage: p.errorMessage,
      completedAt: p.completedAt ? new Date(p.completedAt).toISOString() : null
    }));
  }
});

export const getQuestionsInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();
  },
});

export const getPapersByOpenAlexIds = internalQuery({
  args: {
    jobId: v.id("extractionJobs"),
    openalexIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    // Filter by OpenAlex IDs
    return papers.filter((p) => args.openalexIds.includes(p.openalexId));
  },
});

export const getPaperInternal = internalQuery({
  args: { paperId: v.id("extractionPapers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.paperId);
  },
});

export const getEvidenceUnitsInternal = internalQuery({
  args: { paperId: v.id("extractionPapers") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("extractionEvidenceUnits")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .collect();
  },
});

export const getJobProgressInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return { totalPapers: 0, processedPapers: 0, failedPapers: 0 };
    }

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    const processablePapers = papers.filter((p) => p.processable !== false);
    const processed = processablePapers.filter((p) => p.status === "completed").length;
    const failed = processablePapers.filter(
      (p) =>
        p.status === "failed" ||
        p.status === "download_failed" ||
        p.status === "indexing_failed"
    ).length;

    return {
      totalPapers: job.totalPapers || processablePapers.length,
      processedPapers: processed,
      failedPapers: failed,
    };
  },
});

// Debug query to get all papers for a job with their statuses
export const getPapersDebug = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    const statusCounts: Record<string, number> = {};
    const contentCounts = {
      total: papers.length,
      processable: 0,
      hasPdfUrl: 0,
      hasAbstract: 0,
      abstractOnly: 0,
      pdfOnly: 0,
      pdfAndAbstract: 0,
    };
    const pendingPapers = [];
    const papersWithWorkIds = [];

    for (const paper of papers) {
      statusCounts[paper.status] = (statusCounts[paper.status] || 0) + 1;
      const { hasPdfUrl, hasAbstract } = getProcessableFlags({
        pdfUrl: paper.pdfUrl,
        storageId: paper.storageId,
        abstract: paper.abstract,
      });
      const isProcessable = paper.processable !== false;

      if (hasPdfUrl) contentCounts.hasPdfUrl++;
      if (hasAbstract) contentCounts.hasAbstract++;
      if (hasPdfUrl && hasAbstract) contentCounts.pdfAndAbstract++;
      if (hasPdfUrl && !hasAbstract) contentCounts.pdfOnly++;
      if (!hasPdfUrl && hasAbstract) contentCounts.abstractOnly++;
      if (isProcessable) contentCounts.processable++;

      if (paper.status === "pending") {
        pendingPapers.push({
          id: paper._id,
          openalexId: paper.openalexId,
          title: paper.title,
          pdfUrl: paper.pdfUrl,
          workId: paper.workId,
        });
      }
      if (paper.workId) {
        papersWithWorkIds.push({
          id: paper._id,
          status: paper.status,
          workId: paper.workId,
        });
      }
    }

    return {
      totalPapers: papers.length,
      statusCounts,
      contentCounts,
      pendingPapers: pendingPapers.slice(0, 20),
      papersWithWorkIds: papersWithWorkIds.slice(0, 20),
      samplePaper: papers[0] || null,
    };
  },
});

// Subscribe to job progress (real-time updates)
export const subscribeToJobProgress = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    job: extractionJobValidator,
    statusCounts: v.object({
      pending: v.number(),
      downloading: v.number(),
      download_failed: v.number(),
      indexing: v.number(),
      indexing_failed: v.number(),
      extracting: v.number(),
      completed: v.number(),
      failed: v.number(),
    }),
    recentPapers: v.array(extractionPaperValidator),
  }),
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }
    const { job } = access;

    // Get status counts
    const allPapers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    const statusCounts = {
      pending: 0,
      downloading: 0,
      download_failed: 0,
      indexing: 0,
      indexing_failed: 0,
      extracting: 0,
      completed: 0,
      failed: 0,
    };

    for (const paper of allPapers) {
      if (paper.processable === false) continue;
      const status = paper.status as keyof typeof statusCounts;
      if (status in statusCounts) {
        statusCounts[status]++;
      }
    }

    return ok({
      job,
      statusCounts,
      recentPapers: allPapers
        .filter((paper) => paper.processable !== false)
        .slice(-20), // Last 20 updated
    });
  },
});

// Get current user for actions
export const getCurrentUserInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    
    return await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
  },
});
