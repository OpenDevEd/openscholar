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
  /** Where it was published, and how often it's cited: what a job's list shows beside a paper. */
  venue: v.optional(v.string()),
  citedByCount: v.optional(v.number()),
});

/**
 * The papers a job reads (#341), resolved on the server: a saved search by its ID in the
 * browser, a collection, every saved paper, or an earlier job's included papers.
 */
export const paperSetValidator = v.union(
  v.object({ kind: v.literal("search"), searchId: v.string() }),
  v.object({ kind: v.literal("collection"), collectionId: v.id("collections") }),
  v.object({ kind: v.literal("saved") }),
  v.object({ kind: v.literal("screening"), jobId: v.id("screeningJobs") }),
);

/** Where a job's included papers go: nowhere, a new collection by name, or one the person has. */
export const saveToValidator = v.union(
  v.object({ kind: v.literal("none") }),
  v.object({ kind: v.literal("new"), name: v.string() }),
  v.object({ kind: v.literal("collection"), collectionId: v.id("collections") }),
);

/**
 * Where a screened paper landed: included at the job's minimum score; unclear when its
 * unclear answers could still take it there; excluded; or failed, when the model couldn't read it.
 */
export const screeningOutcomeValidator = v.union(v.literal("included"), v.literal("unclear"), v.literal("excluded"), v.literal("failed"));

/** How each question's answers split across a job's papers, kept as papers settle. */
export const screeningTalliesValidator = capped(
  v.optional(v.array(v.object({ key: v.string(), yes: v.number(), no: v.number(), unclear: v.number() }))),
  MAX_QUESTIONS,
);

/** One paper of a job as its list shows it: the paper, its score, and its answer to each question now. */
export const screeningJobPaperValidator = v.object({
  openalexId: v.string(),
  title: v.string(),
  abstract: v.optional(v.string()),
  authors: screeningAuthorsValidator,
  publicationYear: v.optional(v.number()),
  doi: v.optional(v.string()),
  venue: v.optional(v.string()),
  citedByCount: v.optional(v.number()),
  outcome: screeningOutcomeValidator,
  score: v.optional(v.number()),
  stars: v.optional(v.number()),
  /** By question key. `changed`: a person or the assistant set it; `confidence`: the model's in its own answer. */
  answers: capped(v.array(v.object({ key: v.string(), answer: v.union(v.boolean(), v.null()), changed: v.boolean(), confidence: v.optional(v.number()) })), MAX_QUESTIONS),
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
