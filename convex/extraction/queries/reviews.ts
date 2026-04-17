/**
 * Review queue — paginate per-result review entries filtered by state or
 * insufficient-evidence flag, sorted with unreviewed + insufficient first.
 *
 * Gated on the `extraction.reviewQueue` feature flag.
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { ok, statusResultValidator } from "../../lib/query_states";
import { resolveOwnedJob } from "../access";
import { requireFeature } from "../../featureFlags/guard";
import { type QuestionType, type ReviewState } from "../../../lib/extraction/insights";
import {
  answerValidator,
  citationStatusValidator,
  questionTypeValidator,
  reviewStateValidator,
} from "../validators";
import {
  buildQuestionInfoByKey,
  loadJobPapersAndResults,
  toReviewState,
} from "./_shared";

export const getReviewQueue = query({
  args: {
    jobId: v.id("extractionJobs"),
    states: v.optional(
      v.array(
        v.union(
          v.literal("unreviewed"),
          v.literal("accepted"),
          v.literal("rejected"),
          v.literal("needs_followup"),
        ),
      ),
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
          }),
        ),
        citationStatus: citationStatusValidator,
        reviewState: reviewStateValidator,
        reviewNote: v.optional(v.string()),
        correctedAnswer: v.optional(answerValidator),
        reviewedAt: v.optional(v.number()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    const { user } = access;
    await requireFeature(ctx, "extraction.reviewQueue", user._id);

    const { questions, papers, resultsByPaper } = await loadJobPapersAndResults(
      ctx,
      args.jobId,
    );
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

    for (const paper of papers.filter(
      (row: Doc<"extractionPapers">) => row.processable !== false,
    )) {
      const results = resultsByPaper.get(paper._id) || [];
      for (const result of results) {
        const reviewState = toReviewState(result.reviewState) || "unreviewed";
        if (includeStateFilter && !allowedStates.has(reviewState)) continue;
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
      if (
        (statePriority[a.reviewState] ?? 9) !==
        (statePriority[b.reviewState] ?? 9)
      ) {
        return (
          (statePriority[a.reviewState] ?? 9) -
          (statePriority[b.reviewState] ?? 9)
        );
      }
      const aInsufficient = a.citationStatus === "insufficient_evidence" ? 0 : 1;
      const bInsufficient = b.citationStatus === "insufficient_evidence" ? 0 : 1;
      if (aInsufficient !== bInsufficient) return aInsufficient - bInsufficient;
      return (b.confidence || 0) - (a.confidence || 0);
    });

    const counts = {
      total: items.length,
      unreviewed: items.filter((item) => item.reviewState === "unreviewed")
        .length,
      accepted: items.filter((item) => item.reviewState === "accepted").length,
      rejected: items.filter((item) => item.reviewState === "rejected").length,
      needsFollowup: items.filter(
        (item) => item.reviewState === "needs_followup",
      ).length,
      insufficientEvidence: items.filter(
        (item) => item.citationStatus === "insufficient_evidence",
      ).length,
    };

    return ok({
      counts,
      items: items.slice(0, Math.max(1, Math.min(args.limit ?? 200, 1000))),
    });
  },
});
