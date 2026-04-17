/**
 * Extraction Module Index
 * Export all extraction-related functions
 */

// Workflows
export { runExtractionWorkflow } from "./workflow";

// Test actions
export { createTestJob } from "./testActions";

// Note: "use node" action files (actions.ts, workpoolActions.ts,
// debug_pdfjs_alignment.ts, test_automation.ts) are NOT re-exported here.
// Re-exporting from a non-"use node" barrel file causes the Convex bundler
// to fail on transitive node:crypto imports. These files are registered
// individually by the Convex bundler via their own module entries.

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
  getUserIdFromJob,
  createQuestionDirect,
  setJobWorkflowId,
  enqueuePaperProcessing,
  handlePaperFetchComplete,
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

// User lookup moved to mutations for self-hosted compatibility


// Debug queries (internal -- not exposed to public API; used for internal diagnostics only)
export { diagnoseJob } from "./debug";
export { getFailedPapersDebug } from "./debug_errors";
export { getPaperErrorsInternal } from "./debug_papers";
export { debugPaperResults } from "./debug_paper_results";
export { debugJobContent } from "./debug_job_content";
export { debugJobCitations } from "./debug_job_citations";
// debugPdfAlignment is in a "use node" file -- imported directly, not re-exported

// Test job creation
export { createTestJobForFix } from "./create_test_job";

// Test runner (internal)
export {
  createAndRunTestJob,
  getTestJobStatus,
} from "./test_runner";

// runPdfTestNow is in a "use node" file -- imported directly, not re-exported

// Internal test automation helpers
export {
  getFirstUserId,
  createTestJob as createTestJobInternal,
  getJobStatus as getJobStatusInternal,
  getJobResults as getJobResultsInternal,
} from "./test_automation_internal";

// Types
export type {
  ExtractionQuestionType,
  ExtractionQuestionInput,
  PaperData,
  ExtractionResult,
  SearchFilters,
} from "./types";
