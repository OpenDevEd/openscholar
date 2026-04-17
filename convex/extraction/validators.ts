/**
 * Extraction Validators
 * Shared Convex validators for extraction document shapes.
 * These mirror the schema definitions in convex/schema.ts exactly.
 */

import { v } from "convex/values";
import { MAX_PDF_URL_LENGTH } from "../../lib/pdf/url-allowlist";
import { createError } from "../lib/errors";

// ---- Input-size caps (enforced at mutation boundary) ----
//
// Convex validators cannot express `v.array(...).max(n)` natively, so these
// are checked manually in each mutation handler that accepts user input.
// Re-use `assertExtractionInputLimits` below to avoid drift across call sites.

export const MAX_QUESTIONS_PER_JOB = 50;
export const MAX_MANUAL_ITEMS_PER_JOB = 1000;
export const MAX_ZOTERO_ITEMS_PER_JOB = 1000;
export const MAX_HISTORY_ENTRIES_PER_JOB = 20;
export const MAX_QUESTION_TEXT_LENGTH = 2000;
export const MAX_PAPER_TITLE_LENGTH = 500;
export const MAX_PAPER_ABSTRACT_LENGTH = 10000;

export type ExtractionInputLimitsArgs = {
  questions: ReadonlyArray<{ question: string }>;
  sourceManualItems?: ReadonlyArray<{
    title: string;
    abstract?: string;
    pdfUrl?: string;
  }>;
  sourceZoteroSelection?: {
    items: ReadonlyArray<unknown>;
  };
  sourceHistoryEntries?: ReadonlyArray<unknown>;
};

export function assertExtractionInputLimits(
  input: ExtractionInputLimitsArgs,
): void {
  if (input.questions.length > MAX_QUESTIONS_PER_JOB) {
    throw createError(
      "VALIDATION_ERROR",
      `questions exceeds maximum of ${MAX_QUESTIONS_PER_JOB}`,
    );
  }
  for (const q of input.questions) {
    if (q.question.length > MAX_QUESTION_TEXT_LENGTH) {
      throw createError(
        "VALIDATION_ERROR",
        `question text exceeds maximum length of ${MAX_QUESTION_TEXT_LENGTH}`,
      );
    }
  }
  if (input.sourceManualItems) {
    if (input.sourceManualItems.length > MAX_MANUAL_ITEMS_PER_JOB) {
      throw createError(
        "VALIDATION_ERROR",
        `sourceManualItems exceeds maximum of ${MAX_MANUAL_ITEMS_PER_JOB}`,
      );
    }
    for (const item of input.sourceManualItems) {
      if (item.title.length > MAX_PAPER_TITLE_LENGTH) {
        throw createError(
          "VALIDATION_ERROR",
          `sourceManualItems[].title exceeds maximum length of ${MAX_PAPER_TITLE_LENGTH}`,
        );
      }
      if (
        item.abstract !== undefined &&
        item.abstract.length > MAX_PAPER_ABSTRACT_LENGTH
      ) {
        throw createError(
          "VALIDATION_ERROR",
          `sourceManualItems[].abstract exceeds maximum length of ${MAX_PAPER_ABSTRACT_LENGTH}`,
        );
      }
      if (
        item.pdfUrl !== undefined &&
        item.pdfUrl.length > MAX_PDF_URL_LENGTH
      ) {
        throw createError(
          "VALIDATION_ERROR",
          `sourceManualItems[].pdfUrl exceeds maximum length of ${MAX_PDF_URL_LENGTH}`,
        );
      }
    }
  }
  if (
    input.sourceZoteroSelection &&
    input.sourceZoteroSelection.items.length > MAX_ZOTERO_ITEMS_PER_JOB
  ) {
    throw createError(
      "VALIDATION_ERROR",
      `sourceZoteroSelection.items exceeds maximum of ${MAX_ZOTERO_ITEMS_PER_JOB}`,
    );
  }
  if (
    input.sourceHistoryEntries &&
    input.sourceHistoryEntries.length > MAX_HISTORY_ENTRIES_PER_JOB
  ) {
    throw createError(
      "VALIDATION_ERROR",
      `sourceHistoryEntries exceeds maximum of ${MAX_HISTORY_ENTRIES_PER_JOB}`,
    );
  }
}

// ---- Scalar union validators ----

export const jobStatusValidator = v.union(
  v.literal("pending"),
  v.literal("downloading_pdfs"),
  v.literal("indexing"),
  v.literal("extracting"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled")
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

export const reviewStateValidator = v.union(
  v.literal("unreviewed"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("needs_followup")
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

// ---- Typed search filters validator ----
// Matches the actual shape of searchFilters stored in Convex.
// All fields MUST be optional to remain compatible with existing stored data.
export const searchFiltersValidator = v.object({
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

// ---- Full document validators ----

export const extractionJobValidator = v.object({
  _id: v.id("extractionJobs"),
  _creationTime: v.number(),
  userId: v.id("users"),
  sourceType: sourceTypeValidator,
  status: jobStatusValidator,
  totalPapers: v.number(),
  processedPapers: v.number(),
  failedPapers: v.number(),
  workflowId: v.optional(v.string()),
  name: v.string(),
  description: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

// ---- Input validators for source rows ----
// Shared across startExtraction / duplicateExtraction /
// startExtractionFromTemplate / saveWorkflowTemplate*.

export const historyEntryInputValidator = v.object({
  historyId: v.string(),
  searchFilters: searchFiltersValidator,
});

export const zoteroItemInputValidator = v.object({
  itemKey: v.string(),
  title: v.string(),
  abstract: v.optional(v.string()),
  authors: v.array(v.string()),
  year: v.optional(v.number()),
  doi: v.optional(v.string()),
});

export const zoteroSelectionInputValidator = v.object({
  libraryType: v.union(v.literal("user"), v.literal("group")),
  groupId: v.optional(v.string()),
  zoteroUserId: v.optional(v.string()),
  collectionKey: v.optional(v.string()),
  includeDescendants: v.optional(v.boolean()),
  items: v.array(zoteroItemInputValidator),
});

export const manualItemInputValidator = v.object({
  id: v.string(),
  title: v.string(),
  abstract: v.optional(v.string()),
  authors: v.optional(v.array(v.string())),
  year: v.optional(v.number()),
  doi: v.optional(v.string()),
  pdfUrl: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
});

/**
 * Bucket item input for startExtraction. Parallels the BucketItem shape
 * on the client. Covers every source tab in one validator; the mutation
 * groups rows by `source` to produce the three legacy jobSources shapes.
 */
export const bucketItemInputValidator = v.object({
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
  // Source-specific
  searchFilters: v.optional(searchFiltersValidator),
  libraryType: v.optional(v.union(v.literal("user"), v.literal("group"))),
  groupId: v.optional(v.string()),
  zoteroUserId: v.optional(v.string()),
  collectionKey: v.optional(v.string()),
});

/** User-authored question input for startExtraction / templates. */
export const questionInputValidator = v.object({
  key: v.string(),
  question: v.string(),
  type: questionTypeValidator,
  description: v.optional(v.string()),
});

/**
 * Full extractionWorkflowTemplates document shape — reused by
 * queries/mutations returning saved templates.
 */
export const workflowTemplateValidator = v.object({
  _id: v.id("extractionWorkflowTemplates"),
  _creationTime: v.number(),
  userId: v.id("users"),
  name: v.string(),
  description: v.optional(v.string()),
  sourceType: sourceTypeValidator,
  bucketItems: v.array(bucketItemInputValidator),
  questions: v.array(questionInputValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const extractionQuestionValidator = v.object({
  _id: v.id("extractionQuestions"),
  _creationTime: v.number(),
  jobId: v.id("extractionJobs"),
  key: v.string(),
  question: v.string(),
  type: questionTypeValidator,
  description: v.optional(v.string()),
  order: v.number(),
  createdAt: v.number(),
});

export const extractionPaperValidator = v.object({
  _id: v.id("extractionPapers"),
  _creationTime: v.number(),
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
  errorMessage: v.optional(v.string()),
  creditsUsed: v.optional(v.number()),
  extractionBilled: v.optional(v.boolean()),
  pdfContentUsed: v.optional(v.boolean()),
});

export const extractionResultValidator = v.object({
  _id: v.id("extractionResults"),
  _creationTime: v.number(),
  jobId: v.id("extractionJobs"),
  paperId: v.id("extractionPapers"),
  questionKey: v.string(),
  answer: answerValidator,
  confidence: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  citations: v.array(citationValidator),
  citationStatus: citationStatusValidator,
  retrievalDiagnostics: v.optional(retrievalDiagnosticsValidator),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  pdfContentUsed: v.optional(v.boolean()),
  processedAt: v.number(),
});

export const extractionEvidenceUnitValidator = v.object({
  _id: v.id("extractionEvidenceUnits"),
  _creationTime: v.number(),
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
});

/**
 * Shape returned by readJobSources — the bucket items that were frozen
 * onto the job at submission time, replayed in insertion order.
 */
export const jobSourcesReadValidator = v.array(bucketItemInputValidator);

export const extractionResultReviewValidator = v.object({
  _id: v.id("extractionResultReviews"),
  _creationTime: v.number(),
  jobId: v.id("extractionJobs"),
  paperId: v.id("extractionPapers"),
  resultId: v.id("extractionResults"),
  questionKey: v.string(),
  state: reviewStateValidator,
  note: v.optional(v.string()),
  correctedAnswer: v.optional(answerValidator),
  reviewedBy: v.optional(v.id("users")),
  reviewedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const extractionResultWithReviewValidator = v.object({
  _id: v.id("extractionResults"),
  _creationTime: v.number(),
  jobId: v.id("extractionJobs"),
  paperId: v.id("extractionPapers"),
  questionKey: v.string(),
  answer: answerValidator,
  confidence: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  citations: v.array(citationValidator),
  citationStatus: citationStatusValidator,
  retrievalDiagnostics: v.optional(retrievalDiagnosticsValidator),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  pdfContentUsed: v.optional(v.boolean()),
  processedAt: v.number(),
  // Review overlay fields
  reviewState: v.optional(reviewStateValidator),
  reviewNote: v.optional(v.string()),
  correctedAnswer: v.optional(answerValidator),
  reviewedAt: v.optional(v.number()),
  reviewedBy: v.optional(v.id("users")),
});

// ---- Typed pagination item validator for extraction results ----
// Used by getJobResultsPaginated to replace paginationResultValidator(v.any())
export const paginatedPaperWithResultsValidator = v.object({
  ...extractionPaperValidator.fields,
  results: v.array(extractionResultWithReviewValidator),
});

export const extractionSavedViewValidator = v.object({
  _id: v.id("extractionSavedViews"),
  _creationTime: v.number(),
  jobId: v.id("extractionJobs"),
  userId: v.id("users"),
  name: v.string(),
  filters: v.object({
    searchQuery: v.string(),
    confidenceRange: v.array(v.number()),
    statusFilters: v.array(v.string()),
  }),
  sortBy: v.optional(v.string()),
  viewMode: v.optional(v.string()),
  selectedQuestionKeys: v.optional(v.array(v.string())),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const extractionReportSnapshotValidator = v.object({
  _id: v.id("extractionReportSnapshots"),
  _creationTime: v.number(),
  jobId: v.id("extractionJobs"),
  userId: v.id("users"),
  name: v.string(),
  scope: v.object({
    filteredPaperIds: v.optional(v.array(v.id("extractionPapers"))),
    selectedQuestionKeys: v.optional(v.array(v.string())),
    viewName: v.optional(v.string()),
  }),
  sections: v.array(
    v.object({
      id: v.string(),
      title: v.string(),
      body: v.string(),
    })
  ),
  metrics: v.object({
    totalPapers: v.number(),
    answeredRate: v.number(),
    groundedRate: v.number(),
    bestEffortRate: v.number(),
  }),
  generatedAt: v.number(),
  createdAt: v.number(),
});

export const extractionRunDiffValidator = v.object({
  _id: v.id("extractionRunDiffs"),
  _creationTime: v.number(),
  jobId: v.id("extractionJobs"),
  baselineJobId: v.id("extractionJobs"),
  userId: v.id("users"),
  summary: v.object({
    newAnswers: v.number(),
    changedAnswers: v.number(),
    removedAnswers: v.number(),
    confidenceShifts: v.number(),
    newlyInsufficientEvidence: v.number(),
    totalCompared: v.number(),
  }),
  changes: v.array(
    v.object({
      openalexId: v.string(),
      title: v.string(),
      questionKey: v.string(),
      changeType: v.union(
        v.literal("new"),
        v.literal("changed"),
        v.literal("removed"),
        v.literal("confidence_shift"),
        v.literal("newly_insufficient_evidence")
      ),
      previousAnswer: v.optional(answerValidator),
      nextAnswer: v.optional(answerValidator),
      previousConfidence: v.optional(v.number()),
      nextConfidence: v.optional(v.number()),
    })
  ),
  generatedAt: v.number(),
  createdAt: v.number(),
  isTruncated: v.optional(v.boolean()),
  totalChanges: v.optional(v.number()),
});
