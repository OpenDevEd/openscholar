/**
 * Insights queries for the extraction review UI. All three require the
 * `extraction.insights` feature flag and share a common data shape
 * (job-loaded questions/papers/results bucketed per question).
 *
 * getJobInsights: whole-job summary + per-question aggregates.
 * getQuestionInsights: one question's aggregates + answer distribution.
 * getQuestionDisagreements: one question's cluster profile.
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { notFound, ok, statusResultValidator } from "../../lib/query_states";
import { resolveOwnedJob } from "../access";
import { requireFeature } from "../../featureFlags/guard";
import {
  aggregateQuestionInsights,
  buildArrayAnswerProfileClusters,
  buildDisagreementClusters,
  type DisagreementCluster,
  type InsightEntry,
} from "../../../lib/extraction/insights";
import { answerValidator, questionTypeValidator } from "../validators";
import {
  hasUsableAbstract,
  hasUsablePdfSource,
  loadJobPapersAndResults,
  toCitationStatus,
  toReviewState,
} from "./_shared";
import { readAggregateSummariesByQuestion } from "../aggregates";

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
          }),
        ),
        entityDistribution: v.array(
          v.object({
            entity: v.string(),
            count: v.number(),
            paperIds: v.array(v.string()),
            avgConfidence: v.number(),
            groundedRate: v.number(),
            generic: v.boolean(),
          }),
        ),
        insightMode: v.string(),
        reviewed: v.object({
          accepted: v.number(),
          rejected: v.number(),
          needsFollowup: v.number(),
          unreviewed: v.number(),
        }),
      }),
    ),
    diagnostics: v.object({
      noContentPapers: v.array(
        v.object({
          paperId: v.string(),
          title: v.string(),
          reason: v.string(),
        }),
      ),
    }),
  }),
  handler: async (ctx, args) => {
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    const { user, job } = access;
    await requireFeature(ctx, "extraction.insights", user._id);

    const { questions, papers, resultsByPaper } = await loadJobPapersAndResults(
      ctx,
      args.jobId,
    );

    // T11.3: summary counters live in @convex-dev/aggregate now. Shape
    // matches the legacy `extractionJobStats` rows so the consumer code
    // below stays untouched. `hasPreAggregatedStats` is true when any
    // question has been written to the aggregate (dual-write fills it
    // alongside legacy rows); zero rows means no results yet so the
    // fan-out branch below still works for fresh jobs.
    const jobStats = await readAggregateSummariesByQuestion(
      ctx,
      args.jobId,
      questions.map((q: Doc<"extractionQuestions">) => q.key),
    );
    const hasPreAggregatedStats = jobStats.some((s) => s.totalPapers > 0);
    const processablePapers = papers.filter(
      (paper: Doc<"extractionPapers">) => paper.processable !== false,
    );
    const questionEntries = new Map<string, InsightEntry[]>();
    const noContentPapers: Array<{
      paperId: string;
      title: string;
      reason: string;
    }> = [];
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
      if (!paper.pdfContentUsed && hasAbstract) abstractOnlyCount += 1;

      const paperResults = resultsByPaper.get(paper._id) || [];
      const resultByQuestionKey = new Map(
        paperResults.map((result) => [result.questionKey, result]),
      );

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

    const questionInsights = questions.map(
      (question: Doc<"extractionQuestions">) => {
        const entries = questionEntries.get(question.key) || [];
        const aggregate = aggregateQuestionInsights(entries, question.type);
        answeredTotal += aggregate.answered;
        groundedTotal += aggregate.grounded;
        bestEffortTotal += aggregate.citationStatusMix.best_effort;
        if (aggregate.total > 0) {
          confidenceSum += aggregate.avgConfidence * aggregate.total;
          confidenceCount += aggregate.total;
          effectiveConfidenceSum +=
            aggregate.avgEffectiveConfidence * aggregate.total;
          effectiveConfidenceCount += aggregate.total;
        }
        return {
          key: question.key,
          question: question.question,
          type: question.type,
          description: question.description,
          ...aggregate,
        };
      },
    );

    let summaryAnswered: number;
    let summaryGrounded: number;
    let summaryBestEffort: number;
    let summaryConfidenceSum: number;
    let summaryConfidenceCount: number;

    if (hasPreAggregatedStats && jobStats.length === questions.length) {
      summaryAnswered = jobStats.reduce((sum, s) => sum + s.totalAnswered, 0);
      summaryGrounded = jobStats.reduce((sum, s) => sum + s.groundedCount, 0);
      summaryBestEffort = jobStats.reduce(
        (sum, s) => sum + s.bestEffortCount,
        0,
      );
      summaryConfidenceSum = jobStats.reduce(
        (sum, s) => sum + s.confidenceSum,
        0,
      );
      summaryConfidenceCount = jobStats.reduce(
        (sum, s) => sum + s.confidenceCount,
        0,
      );
    } else {
      summaryAnswered = answeredTotal;
      summaryGrounded = groundedTotal;
      summaryBestEffort = bestEffortTotal;
      summaryConfidenceSum = confidenceSum;
      summaryConfidenceCount = confidenceCount;
    }

    const totalExpectedAnswers =
      processablePapers.length * Math.max(questions.length, 1);
    const answeredRate =
      totalExpectedAnswers > 0 ? summaryAnswered / totalExpectedAnswers : 0;
    const groundedRate =
      totalExpectedAnswers > 0 ? summaryGrounded / totalExpectedAnswers : 0;
    const bestEffortRate =
      totalExpectedAnswers > 0 ? summaryBestEffort / totalExpectedAnswers : 0;

    return ok({
      job: { id: job._id, name: job.name },
      summary: {
        totalPapers: processablePapers.length,
        totalQuestions: questions.length,
        answeredTotal: summaryAnswered,
        groundedTotal: summaryGrounded,
        answeredRate,
        groundedRate,
        bestEffortRate,
        averageConfidence:
          summaryConfidenceCount > 0
            ? summaryConfidenceSum / summaryConfidenceCount
            : 0,
        averageEffectiveConfidence:
          effectiveConfidenceCount > 0
            ? effectiveConfidenceSum / effectiveConfidenceCount
            : 0,
        noContentCount: noContentPapers.length,
        abstractOnlyCount,
      },
      questions: questionInsights,
      diagnostics: { noContentPapers: noContentPapers.slice(0, 20) },
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
            }),
          ),
        }),
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
            }),
          ),
        }),
      ),
      entityDistribution: v.array(
        v.object({
          entity: v.string(),
          count: v.number(),
          paperIds: v.array(v.string()),
          avgConfidence: v.number(),
          groundedRate: v.number(),
          generic: v.boolean(),
        }),
      ),
    },
    true,
  ),
  handler: async (ctx, args) => {
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    const { user } = access;
    await requireFeature(ctx, "extraction.insights", user._id);

    const { questions, papers, resultsByPaper } = await loadJobPapersAndResults(
      ctx,
      args.jobId,
    );
    const question = questions.find(
      (q: Doc<"extractionQuestions">) => q.key === args.questionKey,
    );
    if (!question) return notFound();

    const entries: InsightEntry[] = [];
    for (const paper of papers.filter(
      (item: Doc<"extractionPapers">) => item.processable !== false,
    )) {
      const result = (resultsByPaper.get(paper._id) || []).find(
        (row) => row.questionKey === args.questionKey,
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
      }),
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
      viewMode: v.union(
        v.literal("disagreement"),
        v.literal("answer_profiles"),
      ),
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
            }),
          ),
        }),
      ),
    },
    true,
  ),
  handler: async (ctx, args) => {
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    const { user } = access;
    await requireFeature(ctx, "extraction.insights", user._id);

    const { questions, papers, resultsByPaper } = await loadJobPapersAndResults(
      ctx,
      args.jobId,
    );
    const question = questions.find(
      (q: Doc<"extractionQuestions">) => q.key === args.questionKey,
    );
    if (!question) return notFound();

    const entries: InsightEntry[] = [];
    for (const paper of papers.filter(
      (item: Doc<"extractionPapers">) => item.processable !== false,
    )) {
      const result = (resultsByPaper.get(paper._id) || []).find(
        (row) => row.questionKey === args.questionKey,
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
      }),
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
