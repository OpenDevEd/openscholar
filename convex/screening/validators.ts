import { v } from "convex/values";
import { MAX_AUTHORS, MAX_QUESTIONS, MAX_STARS, capped } from "../lib/listCaps";

/**
 * Screening question snapshot embedded in job records.
 * Simplified from client-side ScreeningQuestion (no id/type -- screening is boolean-only).
 */
export const screeningQuestionValidator = v.object({
  key: v.string(),
  question: v.string(),
});

/** A screening's questions: at most MAX_QUESTIONS. */
export const screeningQuestionsValidator = capped(v.array(screeningQuestionValidator), MAX_QUESTIONS);

/**
 * Per-question scoring rule: maps yes/no/null answers to point values.
 */
export const screeningScoringRuleValidator = v.object({
  questionKey: v.string(),
  yesPoints: v.number(),
  noPoints: v.number(),
  nullPoints: v.number(),
});

/**
 * Full scoring configuration embedded in screening jobs.
 * Rules define point values per question, thresholds map total scores to star ratings.
 */
export const screeningScoringConfigValidator = v.object({
  rules: capped(v.array(screeningScoringRuleValidator), MAX_QUESTIONS),
  starThresholds: capped(
    v.array(
      v.object({
        minScore: v.number(),
        stars: v.number(),
      })
    ),
    MAX_STARS,
  ),
  minimumScore: v.optional(v.number()),
});

/** A screened paper's authors, the first MAX_AUTHORS of them. */
export const screeningAuthorsValidator = capped(v.optional(v.array(v.string())), MAX_AUTHORS);

/** A screened paper's answers, one per question. */
export const screeningAnswersValidator = capped(v.optional(v.record(v.string(), v.union(v.boolean(), v.null()))), MAX_QUESTIONS);

/**
 * Paper input shape for screening job creation.
 * Snapshot of paper metadata at job creation time.
 */
export const screeningPaperInputValidator = v.object({
  openalexId: v.string(),
  title: v.string(),
  abstract: v.optional(v.string()),
  authors: screeningAuthorsValidator,
  publicationYear: v.optional(v.number()),
  doi: v.optional(v.string()),
});

/**
 * Screening job lifecycle statuses.
 */
export const screeningJobStatusValidator = v.union(
  v.literal("processing"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("failed"),
  v.literal("creditsExhausted")
);

/**
 * Individual screening result statuses.
 */
export const screeningResultStatusValidator = v.union(
  v.literal("processing"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("skipped")
);
