/**
 * Extraction Validators
 * Shared Convex validators for extraction document shapes.
 * These mirror the schema definitions in convex/schema.ts exactly.
 */

import { v } from "convex/values";
import { effortValidator } from "../aiModelConfig/validators";
import { errorCodeValidator } from "@/lib/errors/taxonomy";
import { type AssertExactDoc } from "../lib/validators";

/**
 * Re-export so all extraction code can pull the taxonomy validator from
 * one place alongside the other extraction validators.
 */
export { errorCodeValidator };

/**
 * Structured error shape persisted on extractionJobs.error,
 * extractionPapers.lastError, and extractionPaperErrors rows.
 *
 * `at` is the millisecond timestamp the error was captured.
 * `context` is bounded at 4 KB by classifyUnknownError to keep doc
 * sizes well under the 1 MB row limit.
 */
export const structuredErrorValidator = v.object({
  code: errorCodeValidator,
  message: v.string(),
  context: v.optional(v.any()),
  httpStatus: v.optional(v.number()),
  providerName: v.optional(v.string()),
  at: v.number(),
});

/**
 * Wire shape returned from a workpool action's catch site (no `at`
 * timestamp; that's stamped at persistence time). Mirrors the
 * `ClassifiedError` runtime type from `lib/errors/taxonomy`.
 */
export const classifiedErrorValidator = v.object({
  code: errorCodeValidator,
  message: v.string(),
  retryable: v.boolean(),
  context: v.optional(v.any()),
  httpStatus: v.optional(v.number()),
  providerName: v.optional(v.string()),
});

// ---- Input-size caps (enforced at mutation boundary) ----
//
// The per-bucket cap is `PAPER_LIMIT` (lib/extraction/limits.ts), checked by
// `assertBucketWithinLimits`. These question-shape caps still apply and are
// enforced inline.

export const MAX_QUESTIONS_PER_JOB = 50;
export const MAX_QUESTION_TEXT_LENGTH = 2000;
export const MAX_PAPER_TITLE_LENGTH = 500;
export const MAX_PAPER_ABSTRACT_LENGTH = 10000;

// ---- Scalar union validators ----

export const jobStatusValidator = v.union(
  v.literal("pending"),
  v.literal("downloading_pdfs"),
  v.literal("indexing"),
  v.literal("extracting"),
  // Non-terminal: user can top up credits and resume (plan 06 lands
  // the resume mutation; plan 03 persists the status transition).
  v.literal("creditsExhausted"),
  // Non-terminal user-initiated pause (plan 06). Resume restores the
  // phase captured in `pausedFromStatus`.
  v.literal("paused"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled")
);

/**
 * Phases a job can be paused from. Matches the `pausedFromStatus`
 * column on extractionJobs (plan 06). Excludes terminal statuses and
 * the auto-pause `creditsExhausted` (that path resumes to `extracting`
 * unconditionally, not a captured phase).
 */
export const pausedFromStatusValidator = v.union(
  v.literal("pending"),
  v.literal("downloading_pdfs"),
  v.literal("indexing"),
  v.literal("extracting"),
);

export const paperStatusValidator = v.union(
  v.literal("pending"),
  v.literal("downloading"),
  v.literal("download_failed"),
  v.literal("indexing"),
  v.literal("indexing_failed"),
  v.literal("extracting"),
  v.literal("completed"),
  v.literal("failed")
);

export const questionTypeValidator = v.union(
  v.literal("string"),
  v.literal("boolean"),
  v.literal("number"),
  v.literal("array")
);

export const answerValidator = v.union(
  v.string(),
  v.boolean(),
  v.number(),
  v.array(v.string()),
  v.null()
);

export const citationStatusValidator = v.union(
  v.literal("grounded"),
  v.literal("best_effort"),
  v.literal("insufficient_evidence"),
  v.literal("extraction_error")
);

export const sourceTypeValidator = v.union(
  v.literal("history"),
  v.literal("zotero"),
  v.literal("manual"),
  v.literal("mixed")
);

/**
 * Per-paper source classifier. Unlike the job-level `sourceTypeValidator`,
 * a paper always resolves to exactly one origin — "mixed" is a job-level
 * aggregation and is never valid on a paper row.
 */
export const paperSourceTypeValidator = v.union(
  v.literal("history"),
  v.literal("zotero"),
  v.literal("manual")
);

// ---- Nested object validators ----

export const citationValidator = v.object({
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
});

export const retrievalDiagnosticsValidator = v.object({
  denseCandidates: v.number(),
  lexicalCandidates: v.number(),
  fusedCandidates: v.number(),
  rerankedCandidates: v.number(),
  validatedCitations: v.number(),
  strictNull: v.boolean(),
});

// ---- Saved search validators ----
/**
 * A search a chat or extraction runs: the query as typed, for its name, and the
 * exact OpenAlex request the results page made (see
 * lib/openalex/works-query.ts), which the server runs as it is.
 */
export const searchFiltersValidator = v.object({
  query: v.string(),
  openAlexQuery: v.object({
    search: v.optional(v.string()),
    filter: v.optional(v.string()),
    /** An OQL search, filters included, run as a POST instead of search and filter. */
    oql: v.optional(v.string()),
    sort: v.string(),
  }),
  limit: v.optional(v.number()),
});

/**
 * Searches saved before 2026-09-25 kept separate filters that the server
 * rebuilt, sometimes into a different or rejected OpenAlex query. They are never
 * run again, so only stored rows accept this shape. Remove it with a migration
 * once production rows are checked.
 */
const legacySearchFiltersValidator = v.object({
  query: v.optional(v.string()),
  field: v.optional(v.string()),
  searchField: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  yearRange: v.optional(v.array(v.number())),
  dateRange: v.optional(v.object({
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  })),
  selectedRegions: v.optional(v.array(v.string())),
  selectedCountryFocus: v.optional(v.array(v.string())),
  reviewFilter: v.optional(v.boolean()),
  citesItemId: v.optional(v.string()),
  citedByItemId: v.optional(v.string()),
  relatedToItemId: v.optional(v.string()),
  isYearRangeEnabled: v.optional(v.boolean()),
  filterType: v.optional(v.string()),
  ratingRange: v.optional(v.array(v.number())),
  onlyRatedPapers: v.optional(v.boolean()),
  language: v.optional(v.string()),
  perPage: v.optional(v.number()),
  limit: v.optional(v.number()),
});

export const storedSearchFiltersValidator = v.union(
  searchFiltersValidator,
  legacySearchFiltersValidator,
);

// ---- Full document validators ----

export const extractionJobFields = {
  userId: v.id("users"),
  mode: v.union(v.literal("extraction"), v.literal("chat")),
  sourceType: v.optional(sourceTypeValidator),
  status: v.optional(jobStatusValidator),
  totalPapers: v.optional(v.number()),
  processedPapers: v.optional(v.number()),
  failedPapers: v.optional(v.number()),
  runEpoch: v.optional(v.number()),
  usePdfs: v.optional(v.boolean()),
  pausedAt: v.optional(v.number()),
  pausedFromStatus: v.optional(pausedFromStatusValidator),
  // Set while a retry resets failed results in batches (#351); the job doesn't finish until it clears.
  /** Set while a retry resets the job's failures a batch at a time; where the next batch starts. */
  retryReset: v.optional(v.object({ cursor: v.union(v.string(), v.null()) })),
  estimatedCredits: v.optional(
    v.object({
      low: v.number(),
      mid: v.number(),
      high: v.number(),
    })
  ),
  chatThreadId: v.optional(v.string()),
  chatModelId: v.optional(v.id("models")),
  /** The chat's reasoning effort; none means the model's default. */
  chatEffort: v.optional(effortValidator),
  // Resolved per-user server model for extraction-mode runs (credits path).
  // Separate from chatModelId (chat-mode, user-swappable per conversation).
  serverModelId: v.optional(v.id("models")),
  serverEffort: v.optional(effortValidator),
  /** When the user screens with a decision model (Jev), yes/no questions go to it too. */
  decisionModelId: v.optional(v.id("models")),
  lastMessageAt: v.optional(v.number()),
  messageCount: v.optional(v.number()),
  isGenerating: v.optional(v.boolean()),
  generatingStartedAt: v.optional(v.number()),
  chatGenerationAttemptId: v.optional(v.string()),
  shouldAbort: v.optional(v.boolean()),
  webSearchEnabled: v.optional(v.boolean()),
  chatSourceFingerprint: v.optional(v.string()),
  chatSourceOpenAlexIds: v.optional(v.array(v.string())),
  name: v.string(),
  description: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
  error: v.optional(structuredErrorValidator),
};

export const extractionJobValidator = v.object({
  _id: v.id("extractionJobs"),
  _creationTime: v.number(),
  ...extractionJobFields,
});

const _check_extractionJobValidator: AssertExactDoc<"extractionJobs", typeof extractionJobValidator> = true;
void _check_extractionJobValidator;

const bucketItemFields = {
  bucketKey: v.string(),
  source: v.union(
    v.literal("history"),
    v.literal("library"),
    v.literal("collection"),
    v.literal("zotero"),
    v.literal("upload"),
  ),
  sourceRefId: v.string(),
  title: v.string(),
  authors: v.array(v.string()),
  year: v.optional(v.number()),
  doi: v.optional(v.string()),
  openalexId: v.optional(v.string()),
  abstract: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  pdfUrl: v.optional(v.string()),
  citedByCount: v.optional(v.number()),
  venueName: v.optional(v.string()),
  workType: v.optional(v.string()),
  libraryType: v.optional(v.union(v.literal("user"), v.literal("group"))),
  groupId: v.optional(v.string()),
  zoteroUserId: v.optional(v.string()),
  collectionKey: v.optional(v.string()),
  includeDescendants: v.optional(v.boolean()),
};

/**
 * Bucket item input — the single validator for every source-tab payload
 * that reaches startJob or createJobDirect.
 * Server round-trip mirrors `lib/bucket/bucketItem.ts::BucketItem` minus
 * the client-only `addedAt` / `status` fields.
 */
export const bucketItemInputValidator = v.object({
  ...bucketItemFields,
  searchFilters: v.optional(searchFiltersValidator),
});

/** A bucket item read back from a job, which may hold an older search. */
export const storedBucketItemValidator = v.object({
  ...bucketItemFields,
  searchFilters: v.optional(storedSearchFiltersValidator),
});

/** User-authored question input for startJob. */
export const questionInputValidator = v.object({
  key: v.string(),
  question: v.string(),
  type: questionTypeValidator,
  description: v.optional(v.string()),
});

export const extractionQuestionFields = {
  jobId: v.id("extractionJobs"),
  key: v.string(),
  question: v.string(),
  type: questionTypeValidator,
  description: v.optional(v.string()),
  order: v.number(),
  createdAt: v.number(),
};

export const extractionQuestionValidator = v.object({
  _id: v.id("extractionQuestions"),
  _creationTime: v.number(),
  ...extractionQuestionFields,
});

const _check_extractionQuestionValidator: AssertExactDoc<"extractionQuestions", typeof extractionQuestionValidator> = true;
void _check_extractionQuestionValidator;

export const extractionPaperFields = {
  jobId: v.id("extractionJobs"),
  openalexId: v.string(),
  title: v.string(),
  doi: v.optional(v.string()),
  publicationYear: v.optional(v.number()),
  abstract: v.optional(v.string()),
  authors: v.optional(v.array(v.string())),
  isOpenAccess: v.optional(v.boolean()),
  processable: v.optional(v.boolean()),
  status: paperStatusValidator,
  pdfUrl: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  pdfDownloadError: v.optional(v.string()),
  sourceType: v.optional(paperSourceTypeValidator),
  sourceId: v.optional(v.string()),
  ragEntryId: v.optional(v.string()),
  isIndexed: v.optional(v.boolean()),
  indexedAt: v.optional(v.number()),
  indexingBilled: v.optional(v.boolean()),
  workId: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  lastError: v.optional(structuredErrorValidator),
  attemptCount: v.optional(v.number()),
  creditsUsed: v.optional(v.number()),
  questionsBilled: v.optional(v.boolean()),
  admittedEstimateCredits: v.optional(v.number()),
  admittedRunEpoch: v.optional(v.number()),
  admittedAt: v.optional(v.number()),
  pdfContentUsed: v.optional(v.boolean()),
  sortTitle: v.optional(v.string()),
  avgConfidence: v.optional(v.number()),
  hasErrors: v.optional(v.boolean()),
  hasPdfSource: v.optional(v.boolean()),
  questionAnswerTokens: v.optional(v.array(v.string())),
  searchText: v.optional(v.string()),
};

export const extractionPaperValidator = v.object({
  _id: v.id("extractionPapers"),
  _creationTime: v.number(),
  ...extractionPaperFields,
});

const _check_extractionPaperValidator: AssertExactDoc<"extractionPapers", typeof extractionPaperValidator> = true;
void _check_extractionPaperValidator;

/**
 * Append-only history of every error a paper has hit. One row per
 * attempt; pagination/queries via by_paper / by_job indexes.
 */
export const extractionPaperErrorFields = {
  paperId: v.id("extractionPapers"),
  jobId: v.id("extractionJobs"),
  attempt: v.number(),
  at: v.number(),
  code: errorCodeValidator,
  message: v.string(),
  httpStatus: v.optional(v.number()),
  providerName: v.optional(v.string()),
  context: v.optional(v.any()),
};

export const extractionPaperErrorValidator = v.object({
  _id: v.id("extractionPaperErrors"),
  _creationTime: v.number(),
  ...extractionPaperErrorFields,
});

const _check_extractionPaperErrorValidator: AssertExactDoc<
  "extractionPaperErrors",
  typeof extractionPaperErrorValidator
> = true;
void _check_extractionPaperErrorValidator;

export const extractionQueueKindValidator = v.union(
  v.literal("initial"),
  v.literal("retry"),
);

export const extractionQueueStatusValidator = v.union(
  v.literal("pending"),
  v.literal("leased"),
  v.literal("running"),
  v.literal("parked"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const extractionPaperQueueFields = {
  jobId: v.id("extractionJobs"),
  userId: v.id("users"),
  paperId: v.id("extractionPapers"),
  runEpoch: v.number(),
  kind: extractionQueueKindValidator,
  status: extractionQueueStatusValidator,
  priority: v.number(),
  attempt: v.number(),
  leaseOwner: v.optional(v.string()),
  leasedAt: v.optional(v.number()),
  leaseExpiresAt: v.optional(v.number()),
  workId: v.optional(v.string()),
  questionKeys: v.optional(v.array(v.string())),
  lastError: v.optional(structuredErrorValidator),
  // Set when the paper's run releases the row, in commit order, while it waits for the
  // extraction worker to refill the job's window (convex/extraction/queue/dispatcher.ts),
  // which clears it.
  releasedAt: v.optional(v.commitTs()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const extractionPaperQueueValidator = v.object({
  _id: v.id("extractionPaperQueue"),
  _creationTime: v.number(),
  ...extractionPaperQueueFields,
});

const _check_extractionPaperQueueValidator: AssertExactDoc<
  "extractionPaperQueue",
  typeof extractionPaperQueueValidator
> = true;
void _check_extractionPaperQueueValidator;

/** Per-question lifecycle status on an extractionResults row. */
export const resultStatusValidator = v.union(
  v.literal("pending"),
  v.literal("extracting"),
  v.literal("completed"),
  v.literal("failed"),
);

export const extractionResultFields = {
  jobId: v.id("extractionJobs"),
  paperId: v.id("extractionPapers"),
  questionKey: v.string(),
  answer: answerValidator,
  confidence: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  citations: v.array(citationValidator),
  citationStatus: citationStatusValidator,
  retrievalDiagnostics: v.optional(retrievalDiagnosticsValidator),
  status: v.optional(resultStatusValidator),
  billed: v.optional(v.boolean()),
  attemptCount: v.optional(v.number()),
  lastError: v.optional(structuredErrorValidator),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  pdfContentUsed: v.optional(v.boolean()),
  creditsUsed: v.optional(v.number()),
  processedAt: v.number(),
};

export const extractionResultValidator = v.object({
  _id: v.id("extractionResults"),
  _creationTime: v.number(),
  ...extractionResultFields,
});

const _check_extractionResultValidator: AssertExactDoc<"extractionResults", typeof extractionResultValidator> = true;
void _check_extractionResultValidator;

export const extractionEvidenceUnitFields = {
  jobId: v.id("extractionJobs"),
  paperId: v.id("extractionPapers"),
  evidenceId: v.string(),
  page: v.number(),
  charRange: v.array(v.number()),
  text: v.string(),
  section: v.optional(v.string()),
  tokens: v.array(v.string()),
  anchorConfidence: v.number(),
  source: v.string(),
  createdAt: v.number(),
};

export const extractionEvidenceUnitValidator = v.object({
  _id: v.id("extractionEvidenceUnits"),
  _creationTime: v.number(),
  ...extractionEvidenceUnitFields,
});

const _check_extractionEvidenceUnitValidator: AssertExactDoc<
  "extractionEvidenceUnits",
  typeof extractionEvidenceUnitValidator
> = true;
void _check_extractionEvidenceUnitValidator;

/**
 * Shape returned by readJobSources — the bucket items that were frozen
 * onto the job at submission time, replayed in insertion order.
 */
export const jobSourcesReadValidator = v.array(storedBucketItemValidator);

export const resultsSortByValidator = v.union(
  v.literal("default"),
  v.literal("title-asc"),
  v.literal("title-desc"),
  v.literal("confidence-high"),
  v.literal("confidence-low"),
);

export const resultsQuestionFilterValidator = v.object({
  questionKey: v.string(),
  value: answerValidator,
});

export const resultsPageFiltersValidator = v.object({
  searchQuery: v.string(),
  confidenceRange: v.array(v.number()),
  statusFilters: v.array(v.string()),
  questionFilters: v.array(resultsQuestionFilterValidator),
});

// ---- Typed page item validator for extraction results ----
// Shared by the results queries that return paper rows with attached results.
export const paginatedPaperWithResultsValidator = v.object({
  _id: v.id("extractionPapers"),
  _creationTime: v.number(),
  ...extractionPaperFields,
  results: v.array(extractionResultValidator),
});
