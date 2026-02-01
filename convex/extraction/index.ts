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
export {
  fetchPapersFromHistory,
  enqueuePapersForProcessing,
  processPaper,
  chunkPdf,
  extractAnswer,
} from "./actions";

export { fetchAndCreatePapers } from "./fetchPapersAction";

// Processors (action-only, no internal calls)
export {
  downloadAndProcessPdf,
  extractWithAI,
  storePdfBlob,
  indexWithRag,
} from "./processors";

// Workpool Actions
export { processPaperAction } from "./workpoolActions";

// Mutations (public)
export { startExtraction, cancelExtraction } from "./mutations";

// Mutations (internal - for crons and workflow)
export {
  updateAllJobProgress,
  finalizeJob,
  updateJobProgress,
  updatePaperStatus,
  setPaperStorage,
  saveExtractionResults,
  createJobDirect,
  createJobByWorkosId,
  getUserIdFromJob,
  createQuestionDirect,
  setJobWorkflowId,
  enqueuePaperProcessing,
  handlePaperComplete,
  handlePaperFetchComplete,
} from "./mutations";

// Queries (public)
export {
  getMyJobs,
  getJobDetails,
  getPaperResults,
  getJobResults,
  subscribeToJobProgress,
} from "./queries";

// Queries (internal)
export {
  getPapersByOpenAlexIds,
  getPaperInternal,
  getJobInternal,
  getQuestionsInternal,
  getJobProgressInternal,
} from "./queries";

// User lookup moved to mutations for self-hosted compatibility

// Start extraction action
export { startExtractionAction } from "./startAction";

// Debug queries
export { diagnoseJob } from "./debug";
export { getFailedPapersDebug } from "./debug_errors";
export { getPaperErrorsInternal } from "./debug_papers";

// Test job creation
export { createTestJobForFix } from "./create_test_job";

// Types
export type {
  ExtractionQuestionType,
  ExtractionQuestionInput,
  PaperData,
  ExtractionResult,
  SearchFilters,
} from "./types";
