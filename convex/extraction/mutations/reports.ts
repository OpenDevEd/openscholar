/**
 * Report-snapshot + run-diff mutations. createExtractionReportSnapshot
 * builds a point-in-time report section bundle; createExtractionRunDiff
 * compares two runs (same question set, different papers) and persists
 * the change summary.
 *
 * T4.12 will lift the pure data-shaping (everything that runs on the
 * loaded records, independent of ctx.db) into
 * lib/extraction/report-builder.ts. Until then the helpers live here.
 */

import { mutation, type MutationCtx } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { requireFeature } from "../../featureFlags/guard";
import { MAX_PAPERS_PER_JOB } from "../../lib/queryBounds";
import { assertJobOwnership } from "../access";
import {
  aggregateQuestionInsights,
  buildDisagreementClusters,
  buildRunDiff,
  formatAnswerForDisplay,
  type DisagreementCluster,
  type InsightEntry,
  type QuestionInsightAggregate,
  type RunDiffRecord,
} from "../../../lib/extraction/insights";

async function loadJobDataForReporting(
  ctx: MutationCtx,
  jobId: Id<"extractionJobs">,
) {
  // Four indexed job-scoped reads replace the previous per-paper fan-out
  // (which was O(papers) separate result queries + O(papers) review queries).
  const [questions, papers, allResults, allReviews] = await Promise.all([
    ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .order("asc")
      .collect(),
    ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(MAX_PAPERS_PER_JOB),
    ctx.db
      .query("extractionResults")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(MAX_PAPERS_PER_JOB * 20),
    ctx.db
      .query("extractionResultReviews")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(MAX_PAPERS_PER_JOB * 20),
  ]);

  const resultsByPaper = new Map<string, Doc<"extractionResults">[]>();
  for (const row of allResults) {
    const bucket = resultsByPaper.get(row.paperId);
    if (bucket) bucket.push(row);
    else resultsByPaper.set(row.paperId, [row]);
  }

  const reviewsByResult = new Map<string, Doc<"extractionResultReviews">>();
  for (const review of allReviews) {
    reviewsByResult.set(review.resultId, review);
  }

  return { questions, papers, resultsByPaper, reviewsByResult };
}

function toInsightEntry(
  paper: Doc<"extractionPapers">,
  questionKey: string,
  result: Doc<"extractionResults"> | undefined,
  review?: Doc<"extractionResultReviews">,
): InsightEntry {
  return {
    paperId: paper._id,
    title: paper.title,
    openalexId: paper.openalexId,
    questionKey,
    answer: review?.correctedAnswer ?? result?.answer ?? null,
    confidence: result?.confidence,
    citationStatus: result?.citationStatus,
    pdfContentUsed: Boolean(result?.pdfContentUsed),
    reviewState: review?.state || "unreviewed",
  };
}

export const createExtractionReportSnapshot = mutation({
  args: {
    jobId: v.id("extractionJobs"),
    name: v.optional(v.string()),
    scope: v.optional(
      v.object({
        filteredPaperIds: v.optional(v.array(v.id("extractionPapers"))),
        selectedQuestionKeys: v.optional(v.array(v.string())),
        viewName: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({ reportId: v.id("extractionReportSnapshots") }),
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await requireFeature(ctx, "extraction.reportBuilder", user._id);
    const job = await assertJobOwnership(ctx, user._id, args.jobId);
    const { questions, papers, resultsByPaper, reviewsByResult } =
      await loadJobDataForReporting(ctx, args.jobId);

    const jobStats = await ctx.db
      .query("extractionJobStats")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    const hasStats = jobStats.length > 0;

    const filteredPaperIds = new Set(
      args.scope?.filteredPaperIds ||
        papers.map((p: Doc<"extractionPapers">) => p._id),
    );
    const selectedQuestions = new Set(
      args.scope?.selectedQuestionKeys ||
        questions.map((question: Doc<"extractionQuestions">) => question.key),
    );
    const scopedPapers = papers.filter((paper: Doc<"extractionPapers">) =>
      filteredPaperIds.has(paper._id),
    );
    const scopedQuestions = questions.filter(
      (question: Doc<"extractionQuestions">) =>
        selectedQuestions.has(question.key),
    );

    const insightByQuestion = scopedQuestions.map(
      (question: Doc<"extractionQuestions">) => {
        const entries: InsightEntry[] = scopedPapers.map(
          (paper: Doc<"extractionPapers">) => {
            const result = (resultsByPaper.get(paper._id) || []).find(
              (row: Doc<"extractionResults">) =>
                row.questionKey === question.key,
            );
            const review = result ? reviewsByResult.get(result._id) : undefined;
            return toInsightEntry(paper, question.key, result, review);
          },
        );

        return {
          question,
          aggregate: aggregateQuestionInsights(entries, question.type),
          disagreements: buildDisagreementClusters(entries, question.type),
          entries,
        };
      },
    );

    type InsightRow = {
      question: Doc<"extractionQuestions">;
      aggregate: QuestionInsightAggregate;
      disagreements: DisagreementCluster[];
      entries: InsightEntry[];
    };

    const keyFindingsLines = insightByQuestion.map((row: InsightRow) => {
      const top = row.aggregate.topAnswers[0];
      const topText = top
        ? `"${top.display}" (${top.count})`
        : "No dominant answer";
      return `- ${row.question.question}: ${topText}`;
    });

    const disagreementLines = insightByQuestion
      .filter((row: InsightRow) => row.disagreements.length > 1)
      .map((row: InsightRow) => {
        const topCluster = row.disagreements
          .slice(0, 2)
          .map((cluster) => `${cluster.displayAnswer} (${cluster.count})`)
          .join(" vs ");
        return `- ${row.question.question}: ${topCluster}`;
      });

    const evidenceHighlights = insightByQuestion
      .flatMap((row: InsightRow) => {
        const groundedEntries = row.entries
          .filter(
            (entry: InsightEntry) =>
              entry.citationStatus === "grounded" && entry.answer !== null,
          )
          .slice(0, 2);
        return groundedEntries.map(
          (entry: InsightEntry) =>
            `- ${row.question.question}: ${formatAnswerForDisplay(
              entry.answer,
              row.question.type,
            )} (${entry.title})`,
        );
      })
      .slice(0, 12);

    // Metrics: use pre-aggregated stats when available and unscoped, else fan-out.
    let metricsAnsweredRate: number;
    let metricsGroundedRate: number;
    let metricsBestEffortRate: number;

    const isUnscoped =
      !args.scope?.filteredPaperIds && !args.scope?.selectedQuestionKeys;
    if (hasStats && jobStats.length === scopedQuestions.length && isUnscoped) {
      const totalFromStats = jobStats.reduce((sum, s) => sum + s.totalPapers, 0);
      const answeredFromStats = jobStats.reduce(
        (sum, s) => sum + s.totalAnswered,
        0,
      );
      const groundedFromStats = jobStats.reduce(
        (sum, s) => sum + s.groundedCount,
        0,
      );
      const bestEffortFromStats = jobStats.reduce(
        (sum, s) => sum + s.bestEffortCount,
        0,
      );
      metricsAnsweredRate =
        totalFromStats > 0 ? answeredFromStats / totalFromStats : 0;
      metricsGroundedRate =
        totalFromStats > 0 ? groundedFromStats / totalFromStats : 0;
      metricsBestEffortRate =
        totalFromStats > 0 ? bestEffortFromStats / totalFromStats : 0;
    } else {
      const totalExpected =
        scopedPapers.length * Math.max(scopedQuestions.length, 1);
      const answeredTotal = insightByQuestion.reduce(
        (sum: number, row: InsightRow) => sum + row.aggregate.answered,
        0,
      );
      const groundedTotal = insightByQuestion.reduce(
        (sum: number, row: InsightRow) => sum + row.aggregate.grounded,
        0,
      );
      const bestEffortTotal = insightByQuestion.reduce(
        (sum: number, row: InsightRow) =>
          sum + row.aggregate.citationStatusMix.best_effort,
        0,
      );
      metricsAnsweredRate =
        totalExpected > 0 ? answeredTotal / totalExpected : 0;
      metricsGroundedRate =
        totalExpected > 0 ? groundedTotal / totalExpected : 0;
      metricsBestEffortRate =
        totalExpected > 0 ? bestEffortTotal / totalExpected : 0;
    }

    const methodsAnsweredPct = Math.round(metricsAnsweredRate * 100);
    const methodsGroundedPct = Math.round(metricsGroundedRate * 100);
    const methodsBestEffortPct = Math.round(metricsBestEffortRate * 100);

    const reportId = await ctx.db.insert("extractionReportSnapshots", {
      jobId: job._id,
      userId: user._id,
      name:
        args.name?.trim() ||
        `${job.name} report ${new Date().toISOString().slice(0, 10)}`,
      scope: {
        filteredPaperIds: args.scope?.filteredPaperIds,
        selectedQuestionKeys: args.scope?.selectedQuestionKeys,
        viewName: args.scope?.viewName,
      },
      sections: [
        {
          id: "key-findings",
          title: "Key Findings",
          body:
            keyFindingsLines.length > 0
              ? keyFindingsLines.join("\n")
              : "- No findings yet.",
        },
        {
          id: "conflicts-uncertainties",
          title: "Conflicts and Uncertainties",
          body:
            disagreementLines.length > 0
              ? disagreementLines.join("\n")
              : "- No major disagreements detected.",
        },
        {
          id: "evidence-highlights",
          title: "Evidence Highlights",
          body:
            evidenceHighlights.length > 0
              ? evidenceHighlights.join("\n")
              : "- No grounded evidence highlights available.",
        },
        {
          id: "methods-limitations",
          title: "Methods and Limitations",
          body: [
            `- Scope: ${scopedPapers.length} papers, ${scopedQuestions.length} questions.`,
            `- Answered rate: ${methodsAnsweredPct}%.`,
            `- Grounded rate: ${methodsGroundedPct}%.`,
            `- Best-effort rate: ${methodsBestEffortPct}%.`,
          ].join("\n"),
        },
      ],
      metrics: {
        totalPapers: scopedPapers.length,
        answeredRate: metricsAnsweredRate,
        groundedRate: metricsGroundedRate,
        bestEffortRate: metricsBestEffortRate,
      },
      generatedAt: Date.now(),
      createdAt: Date.now(),
    });

    // Lazy backfill for legacy completed jobs that never wrote the stats table.
    if (!hasStats && job.status === "completed") {
      await ctx.scheduler.runAfter(
        0,
        internal.extraction.mutations.backfillJobStats,
        { jobId: args.jobId },
      );
    }

    return { reportId };
  },
});

export const createExtractionRunDiff = mutation({
  args: {
    jobId: v.id("extractionJobs"),
    baselineJobId: v.id("extractionJobs"),
  },
  returns: v.object({
    diffId: v.id("extractionRunDiffs"),
    summary: v.object({
      newAnswers: v.number(),
      changedAnswers: v.number(),
      removedAnswers: v.number(),
      confidenceShifts: v.number(),
      newlyInsufficientEvidence: v.number(),
      totalCompared: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    await assertJobOwnership(ctx, user._id, args.jobId);
    await assertJobOwnership(ctx, user._id, args.baselineJobId);

    const currentData = await loadJobDataForReporting(ctx, args.jobId);
    const baselineData = await loadJobDataForReporting(ctx, args.baselineJobId);

    const toDiffRecords = (
      papers: Doc<"extractionPapers">[],
      resultsByPaper: Map<string, Doc<"extractionResults">[]>,
    ): RunDiffRecord[] => {
      const rows: RunDiffRecord[] = [];
      for (const paper of papers.filter((row) => row.processable !== false)) {
        const results = resultsByPaper.get(paper._id) || [];
        for (const result of results) {
          rows.push({
            key: `${paper.openalexId}::${result.questionKey}`,
            openalexId: paper.openalexId,
            title: paper.title,
            questionKey: result.questionKey,
            answer: result.answer,
            confidence: result.confidence,
            citationStatus: result.citationStatus,
          });
        }
      }
      return rows;
    };

    const { summary, changes } = buildRunDiff(
      toDiffRecords(baselineData.papers, baselineData.resultsByPaper),
      toDiffRecords(currentData.papers, currentData.resultsByPaper),
    );

    const DIFF_CHANGES_CAP = 1000;
    const isTruncated = changes.length > DIFF_CHANGES_CAP;

    const diffId = await ctx.db.insert("extractionRunDiffs", {
      jobId: args.jobId,
      baselineJobId: args.baselineJobId,
      userId: user._id,
      summary,
      changes: changes.slice(0, DIFF_CHANGES_CAP),
      ...(isTruncated
        ? { isTruncated: true, totalChanges: changes.length }
        : {}),
      generatedAt: Date.now(),
      createdAt: Date.now(),
    });

    return { diffId, summary };
  },
});
