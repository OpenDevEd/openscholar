/**
 * Extraction Module Index
 * Export all extraction-related functions
 *
 * Test and debug internals (debug.ts, debug_*.ts, tests/fixtures.ts,
 * tests/runners.ts) are intentionally NOT re-exported here. Each handler
 * calls `assertNonProd` at its top to block prod invocations — callers in
 * dev still address them via their full internal path
 * (internal.extraction.debug.*, internal.extraction.tests.fixtures.*, ...).
 */

// Workflows
export { runExtractionWorkflow } from "./workflow";

// Note: "use node" action files (workpoolActions.ts,
// debug_pdfjs_alignment.ts, tests/runners.ts) are NOT re-exported here.
// Re-exporting from a non-"use node" barrel file causes the Convex bundler
// to fail on transitive node:crypto imports. These files are registered
// individually by the Convex bundler via their own module entries.
// actions.ts, prompts.ts, and evidence_units.ts are default-runtime
// (no "use node") and can be imported from anywhere.

// Mutations (public)
export {
  startExtraction,
  cancelExtraction,
  duplicateExtraction,
  deleteExtraction,
  setResultReviewState,
  saveExtractionSavedView,
  deleteExtractionSavedView,
  saveWorkflowTemplateFromJob,
  saveWorkflowTemplate,
  deleteWorkflowTemplate,
  startExtractionFromTemplate,
  createExtractionReportSnapshot,
  createExtractionRunDiff,
} from "./mutations";

// Mutations (internal - for workflow)
export {
  maybeFinalizeJob,
  updatePaperStatus,
  updatePaperProcessable,
  setPaperStorage,
  saveExtractionResultsAndComplete,
  createJobDirect,
  createQuestionDirect,
  setJobWorkflowId,
  enqueuePaperProcessing,
  handleDownloadAndIndexComplete,
  handleExtractionComplete,
  markPaperIndexed,
  replacePaperEvidenceUnits,
} from "./mutations";

// Queries (public)
export {
  getMyJobs,
  getJobDetails,
  getPaperResults,
  getJobResults,
  getJobInsights,
  getQuestionInsights,
  getQuestionDisagreements,
  getReviewQueue,
  getSavedViews,
  getWorkflowTemplates,
  getReportSnapshots,
  getRunDiff,
  subscribeToJobProgress,
} from "./queries";

// Queries (internal)
export {
  getPapersByOpenAlexIds,
  getPaperInternal,
  getPaperResultsInternal,
  getJobInternal,
  getQuestionsInternal,
  getJobProgressInternal,
  getEvidenceUnitsInternal,
} from "./queries";

// Types
export type {
  ExtractionQuestionType,
  ExtractionQuestionInput,
  PaperData,
  ExtractionResult,
  SearchFilters,
} from "./types";
