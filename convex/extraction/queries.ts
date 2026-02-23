/**
 * Extraction Queries
 * Queries for retrieving extraction job data
 */

import { query, internalQuery } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import { noAccess, notFound, ok, unauthenticated } from "../lib/query_states";
import { getProcessableFlags, MIN_ABSTRACT_LENGTH } from "./content";
import { requireExtractionEnabled } from "./guard";
import {
  aggregateQuestionInsights,
  buildArrayAnswerProfileClusters,
  buildDisagreementClusters,
  type CitationStatus,
  type InsightEntry,
  type ReviewState,
} from "../../lib/extraction/insights";
import { createError } from "../lib/errors";

type OwnedJobResolution =
  | { status: "ok"; user: Doc<"users">; job: Doc<"extractionJobs"> }
  | { status: "unauthenticated" }
  | { status: "no_access" };

async function resolveOwnedJob(
  ctx: any,
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
  ctx: any,
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
  ctx: any,
  paperId: Id<"extractionPapers">,
  results: Doc<"extractionResults">[]
) {
  const reviews = await ctx.db
    .query("extractionResultReviews")
    .withIndex("by_paper", (q: any) => q.eq("paperId", paperId))
    .collect();
  const reviewByResultId = new Map<string, any>(
    reviews.map((review: any) => [review.resultId, review] as [string, any])
  );

  return results.map((result) => {
    const review: any = reviewByResultId.get(result._id);
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

async function loadJobPapersAndResults(ctx: any, jobId: Id<"extractionJobs">) {
  const questions = await ctx.db
    .query("extractionQuestions")
    .withIndex("by_job", (q: any) => q.eq("jobId", jobId))
    .order("asc")
    .collect();

  const papers = await ctx.db
    .query("extractionPapers")
    .withIndex("by_job", (q: any) => q.eq("jobId", jobId))
    .collect();

  const resultsByPaper = new Map<string, any[]>();
  for (const paper of papers) {
    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_paper", (q: any) => q.eq("paperId", paper._id))
      .collect();
    resultsByPaper.set(
      paper._id,
      await attachReviewMetadata(ctx, paper._id, results)
    );
  }

  return { questions, papers, resultsByPaper };
}

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
      organizationId: v.optional(v.id("organizations")),
      sourceType: v.union(v.literal("history"), v.literal("zotero"), v.literal("manual"), v.literal("mixed")),
      sourceHistoryId: v.optional(v.string()),
      sourceZoteroCollection: v.optional(v.string()),
      sourceHistoryEntries: v.optional(v.array(v.object({ historyId: v.string(), searchFilters: v.record(v.string(), v.any()) }))),
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
      searchFilters: v.optional(v.record(v.string(), v.any())),
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
  returns: v.union(
    v.object({
      status: v.literal("ok"),
      job: v.any(),
      questions: v.array(v.any()),
      papers: v.array(v.any()),
      progress: v.object({
        total: v.number(),
        processed: v.number(),
        failed: v.number(),
        percentage: v.number(),
      }),
    }),
    v.object({ status: v.literal("unauthenticated") }),
    v.object({ status: v.literal("no_access") })
  ),
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
      .take(100);

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
  returns: v.union(
    v.object({
      status: v.literal("ok"),
      paper: v.any(),
      results: v.array(v.any()),
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
  returns: v.union(
    v.object({
      status: v.literal("ok"),
      job: v.any(),
      questions: v.array(v.any()),
      papers: v.any(),
    }),
    v.object({ status: v.literal("unauthenticated") }),
    v.object({ status: v.literal("no_access") })
  ),
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
      const resultsWithReviews = await attachReviewMetadata(ctx, paper._id, results);

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
  returns: v.any(),
  handler: async (ctx, args) => {
    requireExtractionEnabled();
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return {
        status: access.status,
        page: [],
        isDone: true,
        continueCursor: "",
        questions: [],
        job: null as any,
      };
    }
    const { job } = access;

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

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

    const papersWithResults = await Promise.all(
      result.page.map(async (paper) => {
        const results = await ctx.db
          .query("extractionResults")
          .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
          .collect();
        const resultsWithReviews = await attachReviewMetadata(ctx, paper._id, results);
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
      questions,
      job,
    };
  },
});

export const getJobInsights = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.any(),
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
      const resultByQuestionKey = new Map(paperResults.map((result: any) => [result.questionKey, result]));

      for (const question of questions) {
        const result: any = resultByQuestionKey.get(question.key);
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
      const aggregate = aggregateQuestionInsights(entries, question.type as any);
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
  returns: v.any(),
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
        (row: any) => row.questionKey === args.questionKey
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

    const aggregate = aggregateQuestionInsights(entries, question.type as any);
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
  returns: v.any(),
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
        (row: any) => row.questionKey === args.questionKey
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
    let clusters: any[] = [];

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
      clusters = buildDisagreementClusters(entries, question.type as any, 20);
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
  returns: v.any(),
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
    const items: any[] = [];

    for (const paper of papers.filter((row: Doc<"extractionPapers">) => row.processable !== false)) {
      const results = resultsByPaper.get(paper._id) || [];
      for (const result of results) {
        const reviewState = toReviewState((result as any).reviewState) || "unreviewed";
        if (includeStateFilter && !allowedStates.has(reviewState)) {
          continue;
        }
        if (
          args.onlyInsufficientEvidence &&
          (result as any).citationStatus !== "insufficient_evidence"
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
          answer: (result as any).correctedAnswer ?? result.answer,
          confidence: result.confidence,
          reasoning: result.reasoning,
          citations: (result as any).citations || [],
          citationStatus: (result as any).citationStatus,
          reviewState,
          reviewNote: (result as any).reviewNote,
          correctedAnswer: (result as any).correctedAnswer,
          reviewedAt: (result as any).reviewedAt,
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
  returns: v.any(),
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
  returns: v.array(v.any()),
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
  returns: v.any(),
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
  returns: v.any(),
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
  returns: v.any(),
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
      .withIndex("by_workos_id", (q) => q.eq("workosId", identity.subject))
      .unique();
  },
});
