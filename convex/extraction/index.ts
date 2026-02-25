/**
 * Extraction Module Index
 * Export all extraction-related functions
 */

// Workflows
export { runExtractionWorkflow } from "./workflow";
export { testSimpleWorkflow } from "./testWorkflow";

// Test actions
export { createTestJob } from "./testActions";

// Actions
export { fetchPapersFromHistory } from "./actions";

// Workpool Actions
export {
  downloadAndIndexPdfAction,
  waitAndExtractAction,
} from "./workpoolActions";

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
  finalizeJob,
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
  finalizeJobIfDone,
  markPaperIndexed,
  backfillIsIndexed,
  backfillProcessable,
  replacePaperEvidenceUnits,
  resetExtractionMvpData,
  purgeLegacyExtractionRowsBatch,
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


// Debug queries
export { diagnoseJob } from "./debug";
export { getFailedPapersDebug } from "./debug_errors";
export { getPaperErrorsInternal } from "./debug_papers";
export { debugPaperResults } from "./debug_paper_results";
export { debugJobContent } from "./debug_job_content";
export { debugJobCitations } from "./debug_job_citations";
export { debugPdfAlignment } from "./debug_pdfjs_alignment";

// Test job creation
export { createTestJobForFix } from "./create_test_job";

// Test runner (internal)
export {
  createAndRunTestJob,
  getTestJobStatus,
} from "./test_runner";

// Test automation - FULL AUTOMATED TEST
export { runPdfTestNow } from "./test_automation";

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
