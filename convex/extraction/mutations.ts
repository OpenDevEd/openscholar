/**
 * Extraction mutations barrel.
 *
 * Every mutation in this file has been relocated to a cohesive submodule
 * under `./mutations/**`. This file exists purely to re-export them at
 * the stable `api.extraction.mutations.<fn>` / `internal.extraction.
 * mutations.<fn>` paths so external callers don't know where the
 * implementation lives.
 *
 * Submodules MUST NOT be imported directly from outside
 * convex/extraction/ — the T4.0 import-boundary guard enforces this.
 */

export {
  startExtraction,
  cancelExtraction,
  duplicateExtraction,
  startExtractionFromTemplate,
  deleteExtraction,
} from "./mutations/jobs";

export {
  createPaperRecords,
  updatePaperStatus,
  updatePaperProcessable,
  setPaperStorage,
  markPaperIndexed,
} from "./mutations/papers";

export {
  setResultReviewState,
  updateJobStatus,
  saveExtractionResultsAndComplete,
} from "./mutations/results";

export {
  saveWorkflowTemplate,
  saveWorkflowTemplateFromJob,
  deleteWorkflowTemplate,
} from "./mutations/templates";

export {
  saveExtractionSavedView,
  deleteExtractionSavedView,
} from "./mutations/savedViews";

export {
  createExtractionReportSnapshot,
  createExtractionRunDiff,
} from "./mutations/reports";

export { replacePaperEvidenceUnits } from "./mutations/evidence";

// Internal mutations — re-exported here so existing callers resolve via
// internal.extraction.mutations.<fn>. T4.14 will drop these and migrate
// callers to internal.extraction.mutations.internal.<scope>.<fn>, the
// long path that matches the public/internal boundary.

export {
  maybeFinalizeJob,
  createJobDirect,
  createQuestionDirect,
  setJobWorkflowId,
  enqueuePaperProcessing,
} from "./mutations/internal/lifecycle";

export {
  handleDownloadAndIndexComplete,
  handleExtractionComplete,
} from "./mutations/internal/onComplete";

export {
  deleteExtractionInternal,
  cleanupFailedPaperStorage,
  backfillJobStats,
  cleanupOldPdfs,
} from "./mutations/internal/admin";
