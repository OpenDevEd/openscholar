/**
 * Extraction Queries
 * Queries for retrieving extraction job data
 */

import { query, internalQuery } from "../_generated/server";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import { notFound, ok } from "../lib/query_states";
import { resolveOwnedJob, resolveOwnedPaper } from "./access";
import { getProcessableFlags } from "./content";
import { requireFeature, getFlag } from "../featureFlags/guard";
import {
  aggregateQuestionInsights,
  buildArrayAnswerProfileClusters,
  buildDisagreementClusters,
  type DisagreementCluster,
  type InsightEntry,
  type QuestionType,
  type ReviewState,
} from "../../lib/extraction/insights";
import {
  MAX_EXTRACTION_JOBS_PER_USER,
  MAX_EVIDENCE_UNITS_PER_PAPER,
  MAX_PAPERS_PER_JOB,
} from "../lib/queryBounds";
import {
  extractionEvidenceUnitValidator,
  extractionJobValidator,
  extractionQuestionValidator,
  extractionPaperValidator,
  extractionResultValidator,
  extractionResultWithReviewValidator,
  extractionSavedViewValidator,
  extractionReportSnapshotValidator,
  extractionRunDiffValidator,
  questionTypeValidator,
  citationStatusValidator,
  reviewStateValidator,
  answerValidator,
  jobSourcesReadValidator,
  paperStatusValidator,
  paginatedPaperWithResultsValidator,
  workflowTemplateValidator,
} from "./validators";
import { statusResultValidator } from "../lib/query_states";
import { readJobSources } from "./jobSources";
import {
  applyReviewMetadata,
  attachReviewMetadata,
  buildQuestionInfoByKey,
  hasUsableAbstract,
  hasUsablePdfSource,
  loadJobPapersAndResults,
  loadResultsByJob,
  loadReviewsByJob,
  toCitationStatus,
  toReviewState,
} from "./queries/_shared";

const paginatedPaperResultValidator = paginationResultValidator(paginatedPaperWithResultsValidator);

export { getMyJobs, getJobDetails, subscribeToJobProgress } from "./queries/jobs";
export { getJobResults, getJobResultsPaginated } from "./queries/results";

export const getPdfExtractionEnabledInternal = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    return pdfFlag?.enabled ?? true;
  },
});


// Get all results for a job (public API) - for export

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

    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }
    const { user, job } = access;
    await requireFeature(ctx, "extraction.insights", user._id);

    // Cardinality: ~1 stat record per question per job
    const jobStats = await ctx.db
      .query("extractionJobStats")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    const hasPreAggregatedStats = jobStats.length > 0;

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

    // Summary counters: use pre-aggregated stats when available, else fan-out values
    let summaryAnswered: number;
    let summaryGrounded: number;
    let summaryBestEffort: number;
    let summaryConfidenceSum: number;
    let summaryConfidenceCount: number;

    if (hasPreAggregatedStats && jobStats.length === questions.length) {
      // Fast path: derive summary from pre-aggregated stats
      summaryAnswered = jobStats.reduce((sum, s) => sum + s.totalAnswered, 0);
      summaryGrounded = jobStats.reduce((sum, s) => sum + s.groundedCount, 0);
      summaryBestEffort = jobStats.reduce((sum, s) => sum + s.bestEffortCount, 0);
      summaryConfidenceSum = jobStats.reduce((sum, s) => sum + s.confidenceSum, 0);
      summaryConfidenceCount = jobStats.reduce((sum, s) => sum + s.confidenceCount, 0);
    } else {
      // Fallback: compute from per-question aggregates (existing fan-out behavior)
      summaryAnswered = answeredTotal;
      summaryGrounded = groundedTotal;
      summaryBestEffort = bestEffortTotal;
      summaryConfidenceSum = confidenceSum;
      summaryConfidenceCount = confidenceCount;
    }

    const totalExpectedAnswers = processablePapers.length * Math.max(questions.length, 1);
    const answeredRate =
      totalExpectedAnswers > 0 ? summaryAnswered / totalExpectedAnswers : 0;
    const groundedRate =
      totalExpectedAnswers > 0 ? summaryGrounded / totalExpectedAnswers : 0;
    const bestEffortRate =
      totalExpectedAnswers > 0 ? summaryBestEffort / totalExpectedAnswers : 0;

    return ok({
      job: {
        id: job._id,
        name: job.name,
      },
      summary: {
        totalPapers: processablePapers.length,
        totalQuestions: questions.length,
        answeredTotal: summaryAnswered,
        groundedTotal: summaryGrounded,
        answeredRate,
        groundedRate,
        bestEffortRate,
        averageConfidence: summaryConfidenceCount > 0 ? summaryConfidenceSum / summaryConfidenceCount : 0,
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

    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }
    const { user, job } = access;
    await requireFeature(ctx, "extraction.insights", user._id);

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

    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }
    const { user, job } = access;
    await requireFeature(ctx, "extraction.insights", user._id);

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

    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }
    const { user } = access;
    await requireFeature(ctx, "extraction.reviewQueue", user._id);

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

    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }

    // Cardinality: ~1-5 report snapshots per job
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
  returns: v.array(workflowTemplateValidator),
  handler: async (ctx) => {

    const user = await getCurrentUser(ctx);
    if (!user) return [];

    return await ctx.db
      .query("extractionWorkflowTemplates")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(MAX_EXTRACTION_JOBS_PER_USER);
  },
});

export const getReportSnapshots = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    reports: v.array(extractionReportSnapshotValidator),
  }),
  handler: async (ctx, args) => {

    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return access;
    }
    const { user } = access;
    await requireFeature(ctx, "extraction.reportBuilder", user._id);

    // Cardinality: ~1-5 report snapshots per job
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
    if (access.status !== "ok") {
      return access;
    }

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

// Internal queries (called by workflow/actions)

export const getJobInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(v.null(), extractionJobValidator),
  handler: async (ctx, args) => {
    return await ctx.db.get("extractionJobs", args.jobId);
  },
});

export const debugRecentPapers = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("extractionPapers"),
      title: v.string(),
      status: paperStatusValidator,
      pdfUrl: v.boolean(),
      storageId: v.optional(v.id("_storage")),
      ragEntryId: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      completedAt: v.union(v.string(), v.null()),
    }),
  ),
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
  returns: v.array(extractionQuestionValidator),
  handler: async (ctx, args) => {
    // Cardinality: ~5-20 questions per extraction job
    return await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();
  },
});

export const getJobSourcesInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: jobSourcesReadValidator,
  handler: async (ctx, args) => {
    return await readJobSources(ctx, args.jobId, MAX_PAPERS_PER_JOB * 2);
  },
});

// Combined read so the workpool actions fetch job + pdfEnabled in one
// round trip instead of two at the top of downloadAndIndexPdfAction and
// waitAndExtractAction.
export const getJobAndFlagsInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    job: v.union(v.null(), extractionJobValidator),
    pdfEnabled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const [job, pdfFlag] = await Promise.all([
      ctx.db.get("extractionJobs", args.jobId),
      getFlag(ctx, "extraction.pdf"),
    ]);
    return {
      job,
      pdfEnabled: pdfFlag?.enabled ?? true,
    };
  },
});


export const getEvidenceUnitsInternal = internalQuery({
  args: { paperId: v.id("extractionPapers") },
  returns: v.array(extractionEvidenceUnitValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("extractionEvidenceUnits")
      .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
      .take(MAX_EVIDENCE_UNITS_PER_PAPER);
  },
});

export const getJobProgressInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    totalPapers: v.number(),
    processedPapers: v.number(),
    failedPapers: v.number(),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("extractionJobs", args.jobId);
    if (!job) {
      return { totalPapers: 0, processedPapers: 0, failedPapers: 0 };
    }

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_PAPERS_PER_JOB);
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
  // v.any() on the return shape is intentional: this is a dev-only
  // diagnostic that surfaces an evolving, deeply-nested per-paper
  // snapshot (processable flags, content counts, workId lists). Every
  // caller is an assertNonProd-gated debug path; investing in a precise
  // validator would be churn-heavy with no prod consumer.
  returns: v.any(),
  handler: async (ctx, args) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_PAPERS_PER_JOB);

    const pdfFlag = await getFlag(ctx, "extraction.pdf");
    const pdfEnabled = pdfFlag?.enabled ?? true;

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
        pdfEnabled,
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

// Subscribe to job progress (real-time updates).
// Reads only the `extractionJobs` row and returns a constant-size payload.
// Every terminal paper transition already bumps processedPapers/failedPapers
// on the job doc (see markPaperTerminalTx in mutations.ts), so Convex
// reactivity notices exactly one doc-change per transition instead of
// replaying the full paper set to every subscribed tab.
