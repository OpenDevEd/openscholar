/**
 * Shared helpers used across every queries/* submodule.
 *
 * Split into three layers by purpose:
 *  - Pure type guards: toReviewState, toCitationStatus.
 *  - Doc shape helpers: hasUsableAbstract, hasUsablePdfSource, applyReviewMetadata.
 *  - ctx.db loaders: attachReviewMetadata, loadReviewsByJob, loadResultsByJob,
 *    buildQuestionInfoByKey, loadJobPapersAndResults.
 *
 * Nothing here is publicly exported as a Convex function — this file only
 * defines TS helpers for the neighbouring query submodules. The
 * import-boundary guard (SN-T4.0) blocks importing queries/_shared from
 * outside convex/extraction/.
 */

import type { QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { MIN_ABSTRACT_LENGTH } from "../content";
import {
  type CitationStatus,
  type ReviewState,
} from "../../../lib/extraction/insights";
import { MAX_REVIEWS_PER_JOB } from "../../lib/queryBounds";
import { PAPER_LIMIT_MAX } from "../bucket/limits";

/** Result document with optional review overlay fields. */
export type ResultWithReview = Doc<"extractionResults"> & {
  reviewState?: ReviewState;
  reviewNote?: string;
  correctedAnswer?: Doc<"extractionResults">["answer"];
  reviewedAt?: number;
  reviewedBy?: Id<"users">;
};

export function hasUsableAbstract(abstract?: string) {
  return (
    typeof abstract === "string" && abstract.trim().length > MIN_ABSTRACT_LENGTH
  );
}

export function hasUsablePdfSource(paper: Doc<"extractionPapers">) {
  return Boolean(
    paper.pdfUrl || paper.storageId || paper.ragEntryId || paper.isIndexed,
  );
}

export function toReviewState(value?: string): ReviewState | undefined {
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

export function toCitationStatus(value?: string): CitationStatus | undefined {
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

export async function attachReviewMetadata(
  ctx: QueryCtx,
  paperId: Id<"extractionPapers">,
  results: Doc<"extractionResults">[],
) {
  // Cardinality: ~5-20 reviews per paper (one per question)
  const reviews = await ctx.db
    .query("extractionResultReviews")
    .withIndex("by_paper", (q) => q.eq("paperId", paperId))
    .collect();
  const reviewByResultId = new Map<string, Doc<"extractionResultReviews">>(
    reviews.map((review) => [review.resultId, review]),
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
export async function loadReviewsByJob(
  ctx: QueryCtx,
  jobId: Id<"extractionJobs">,
) {
  const allReviews = await ctx.db
    .query("extractionResultReviews")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .take(MAX_REVIEWS_PER_JOB);
  return new Map<string, Doc<"extractionResultReviews">>(
    allReviews.map((review) => [review.resultId, review]),
  );
}

/**
 * Apply pre-loaded review metadata to results synchronously (no database calls).
 * Use with loadReviewsByJob for batch processing of multiple papers.
 */
export function applyReviewMetadata(
  results: Doc<"extractionResults">[],
  reviewMap: Map<string, Doc<"extractionResultReviews">>,
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

export function buildQuestionInfoByKey(
  questions: Doc<"extractionQuestions">[],
) {
  return new Map(
    questions.map((question) => [
      question.key,
      {
        key: question.key,
        question: question.question,
        type: question.type,
        description: question.description,
      },
    ]),
  );
}

/**
 * Load all results for a job in one indexed query and bucket by paperId in
 * JS. Replaces the previous N+1 pattern (one by_paper query per paper).
 * Cardinality: ≤ PAPER_LIMIT_MAX × ~20 questions.
 */
export async function loadResultsByJob(
  ctx: QueryCtx,
  jobId: Id<"extractionJobs">,
): Promise<Map<string, Doc<"extractionResults">[]>> {
  const all = await ctx.db
    .query("extractionResults")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .take(PAPER_LIMIT_MAX * 20);

  const byPaper = new Map<string, Doc<"extractionResults">[]>();
  for (const row of all) {
    const bucket = byPaper.get(row.paperId);
    if (bucket) bucket.push(row);
    else byPaper.set(row.paperId, [row]);
  }
  return byPaper;
}

export async function loadJobPapersAndResults(
  ctx: QueryCtx,
  jobId: Id<"extractionJobs">,
) {
  // Cardinality: ~5-20 questions per extraction job (enforced by UI limit)
  const questions = await ctx.db
    .query("extractionQuestions")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .order("asc")
    .collect();

  const papers = await ctx.db
    .query("extractionPapers")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .take(PAPER_LIMIT_MAX);

  // Batch-load reviews + results for the whole job in two indexed queries
  // (eliminates the per-paper fan-out that dominated this path).
  const [reviewMap, resultsByPaperRaw] = await Promise.all([
    loadReviewsByJob(ctx, jobId),
    loadResultsByJob(ctx, jobId),
  ]);

  const resultsByPaper = new Map<string, ResultWithReview[]>();
  for (const paper of papers) {
    const rawResults = resultsByPaperRaw.get(paper._id) ?? [];
    resultsByPaper.set(paper._id, applyReviewMetadata(rawResults, reviewMap));
  }

  return { questions, papers, resultsByPaper };
}
