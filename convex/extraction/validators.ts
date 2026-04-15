import { v } from "convex/values";

/**
 * Extraction job lifecycle statuses.
 * Unlike screening, extraction has no `creditsExhausted` state --
 * credit failures surface as `failed` with an error message.
 */
export const extractionJobStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("failed")
);

/**
 * Individual extraction paper statuses.
 * Includes `parsing` and `extracting` as distinct phases for
 * progress visibility -- parsing retrieves full text, extracting
 * runs the LLM extraction pipeline.
 */
export const extractionPaperStatusValidator = v.union(
  v.literal("pending"),
  v.literal("parsing"),
  v.literal("extracting"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled")
);

/**
 * Parsing source tag indicating which tier produced the body text.
 * Surfaced in UI for transparency (PARSE-07).
 */
export const parsingSourceValidator = v.union(
  v.literal("pmc"),
  v.literal("arxiv"),
  v.literal("unpdf"),
  v.literal("gemini"),
  v.literal("abstract_only")
);

/**
 * Extraction question shape.
 * Includes `expectedType` for guiding LLM output format
 * (e.g. "number", "date", "boolean") -- extraction-specific,
 * not present in screening questions.
 */
export const extractionQuestionValidator = v.object({
  key: v.string(),
  question: v.string(),
  expectedType: v.optional(v.string()),
});

/**
 * Paper input shape for extraction job creation.
 * Snapshot of paper metadata at job creation time.
 */
export const extractionPaperInputValidator = v.object({
  openalexId: v.string(),
  title: v.string(),
  abstract: v.optional(v.string()),
  authors: v.optional(v.array(v.string())),
  publicationYear: v.optional(v.number()),
  doi: v.optional(v.string()),
});

/**
 * Extraction confidence level for an answer (EXTR-09).
 * - high: explicit statement found in text
 * - medium: inferred from context
 * - low: uncertain or partial evidence
 */
export const extractionConfidenceValidator = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low")
);

/**
 * Extraction result value shape (EXTR-09, D-03).
 *
 * Shared contract between the saveResult mutation args and the
 * extraction cascade output. All fields except `answer` are optional
 * because failed questions have `answer: null` with only `errorMessage`
 * populated (D-15).
 */
export const extractionResultValueValidator = v.object({
  answer: v.union(v.string(), v.null()),
  confidence: v.optional(extractionConfidenceValidator),
  evidenceQuote: v.optional(v.string()),
  evidenceSourceId: v.optional(v.string()),
  evidenceStartChar: v.optional(v.number()),
  evidenceEndChar: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  modelUsed: v.optional(v.string()),
  tokensIn: v.optional(v.number()),
  tokensOut: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
});
