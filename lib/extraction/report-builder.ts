/**
 * Pure report-builder helpers. Lifted from convex/extraction/mutations/reports.ts
 * (T4.12). Takes already-loaded records and produces the snapshot body /
 * run-diff records — no ctx.db reads.
 *
 * Doc<> types from Convex are structurally compatible with the flat types
 * below, so call sites pass them directly.
 */

import {
  aggregateQuestionInsights,
  buildDisagreementClusters,
  formatAnswerForDisplay,
  type CitationStatus,
  type DisagreementCluster,
  type ExtractionAnswer,
  type InsightEntry,
  type QuestionInsightAggregate,
  type QuestionType,
  type ReviewState,
  type RunDiffRecord,
} from "./insights";

export type ReportPaper = {
  _id: string;
  title: string;
  openalexId: string;
  processable?: boolean;
};

export type ReportQuestion = {
  key: string;
  question: string;
  type: QuestionType;
};

export type ReportResult = {
  _id: string;
  paperId: string;
  questionKey: string;
  answer: ExtractionAnswer;
  confidence?: number;
  citationStatus?: CitationStatus;
  pdfContentUsed?: boolean;
};

export type ReportReview = {
  resultId: string;
  correctedAnswer?: ExtractionAnswer;
  state?: ReviewState;
};

export type ReportJobStats = {
  totalPapers: number;
  totalAnswered: number;
  groundedCount: number;
  bestEffortCount: number;
};

export type ReportSnapshotScope = {
  filteredPaperIds?: string[];
  selectedQuestionKeys?: string[];
};

export type ReportSnapshotSection = {
  id: string;
  title: string;
  body: string;
};

export type ReportSnapshotMetrics = {
  totalPapers: number;
  answeredRate: number;
  groundedRate: number;
  bestEffortRate: number;
};

export type ReportSnapshotBody = {
  sections: ReportSnapshotSection[];
  metrics: ReportSnapshotMetrics;
};

export type BuildReportSnapshotInputs = {
  questions: ReportQuestion[];
  papers: ReportPaper[];
  resultsByPaper: Map<string, ReportResult[]>;
  reviewsByResult: Map<string, ReportReview>;
  jobStats: ReportJobStats[];
  scope?: ReportSnapshotScope;
};

export function buildResultMaps<
  R extends { _id: string; paperId: string },
  V extends { resultId: string },
>(
  allResults: R[],
  allReviews: V[],
): { resultsByPaper: Map<string, R[]>; reviewsByResult: Map<string, V> } {
  const resultsByPaper = new Map<string, R[]>();
  for (const row of allResults) {
    const bucket = resultsByPaper.get(row.paperId);
    if (bucket) bucket.push(row);
    else resultsByPaper.set(row.paperId, [row]);
  }
  const reviewsByResult = new Map<string, V>();
  for (const review of allReviews) {
    reviewsByResult.set(review.resultId, review);
  }
  return { resultsByPaper, reviewsByResult };
}

export function toInsightEntry(
  paper: ReportPaper,
  questionKey: string,
  result: ReportResult | undefined,
  review?: ReportReview,
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
    reviewState: review?.state ?? "unreviewed",
  };
}

export function buildReportSnapshot(
  inputs: BuildReportSnapshotInputs,
): ReportSnapshotBody {
  const { questions, papers, resultsByPaper, reviewsByResult, jobStats, scope } =
    inputs;

  const filteredPaperIds = new Set(
    scope?.filteredPaperIds ?? papers.map((p) => p._id),
  );
  const selectedQuestions = new Set(
    scope?.selectedQuestionKeys ?? questions.map((q) => q.key),
  );
  const scopedPapers = papers.filter((p) => filteredPaperIds.has(p._id));
  const scopedQuestions = questions.filter((q) => selectedQuestions.has(q.key));

  type InsightRow = {
    question: ReportQuestion;
    aggregate: QuestionInsightAggregate;
    disagreements: DisagreementCluster[];
    entries: InsightEntry[];
  };

  const insightByQuestion: InsightRow[] = scopedQuestions.map((question) => {
    const entries: InsightEntry[] = scopedPapers.map((paper) => {
      const result = (resultsByPaper.get(paper._id) ?? []).find(
        (row) => row.questionKey === question.key,
      );
      const review = result ? reviewsByResult.get(result._id) : undefined;
      return toInsightEntry(paper, question.key, result, review);
    });
    return {
      question,
      aggregate: aggregateQuestionInsights(entries, question.type),
      disagreements: buildDisagreementClusters(entries, question.type),
      entries,
    };
  });

  const keyFindingsLines = insightByQuestion.map((row) => {
    const top = row.aggregate.topAnswers[0];
    const topText = top
      ? `"${top.display}" (${top.count})`
      : "No dominant answer";
    return `- ${row.question.question}: ${topText}`;
  });

  const disagreementLines = insightByQuestion
    .filter((row) => row.disagreements.length > 1)
    .map((row) => {
      const topCluster = row.disagreements
        .slice(0, 2)
        .map((cluster) => `${cluster.displayAnswer} (${cluster.count})`)
        .join(" vs ");
      return `- ${row.question.question}: ${topCluster}`;
    });

  const evidenceHighlights = insightByQuestion
    .flatMap((row) => {
      const groundedEntries = row.entries
        .filter(
          (entry) =>
            entry.citationStatus === "grounded" && entry.answer !== null,
        )
        .slice(0, 2);
      return groundedEntries.map(
        (entry) =>
          `- ${row.question.question}: ${formatAnswerForDisplay(
            entry.answer,
            row.question.type,
          )} (${entry.title})`,
      );
    })
    .slice(0, 12);

  // Metrics: use pre-aggregated stats when available and unscoped, else fan-out.
  const isUnscoped =
    !scope?.filteredPaperIds && !scope?.selectedQuestionKeys;
  const hasStats = jobStats.length > 0;
  let metricsAnsweredRate: number;
  let metricsGroundedRate: number;
  let metricsBestEffortRate: number;

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
      (sum, row) => sum + row.aggregate.answered,
      0,
    );
    const groundedTotal = insightByQuestion.reduce(
      (sum, row) => sum + row.aggregate.grounded,
      0,
    );
    const bestEffortTotal = insightByQuestion.reduce(
      (sum, row) => sum + row.aggregate.citationStatusMix.best_effort,
      0,
    );
    metricsAnsweredRate = totalExpected > 0 ? answeredTotal / totalExpected : 0;
    metricsGroundedRate = totalExpected > 0 ? groundedTotal / totalExpected : 0;
    metricsBestEffortRate =
      totalExpected > 0 ? bestEffortTotal / totalExpected : 0;
  }

  const methodsAnsweredPct = Math.round(metricsAnsweredRate * 100);
  const methodsGroundedPct = Math.round(metricsGroundedRate * 100);
  const methodsBestEffortPct = Math.round(metricsBestEffortRate * 100);

  const sections: ReportSnapshotSection[] = [
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
  ];

  return {
    sections,
    metrics: {
      totalPapers: scopedPapers.length,
      answeredRate: metricsAnsweredRate,
      groundedRate: metricsGroundedRate,
      bestEffortRate: metricsBestEffortRate,
    },
  };
}

export function buildDiffRecords(
  papers: ReportPaper[],
  resultsByPaper: Map<string, ReportResult[]>,
): RunDiffRecord[] {
  const rows: RunDiffRecord[] = [];
  for (const paper of papers.filter((row) => row.processable !== false)) {
    const results = resultsByPaper.get(paper._id) ?? [];
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
}
