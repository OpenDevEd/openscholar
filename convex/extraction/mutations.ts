/**
 * Extraction mutations barrel.
 *
 * Only the 13 PUBLIC mutations are re-exported here, pinning their stable
 * `api.extraction.mutations.<fn>` paths (zero UI churn). Every internal
 * mutation surfaces at its long path
 * (`internal.extraction.mutations.<scope>.<fn>` — e.g.
 * `internal.extraction.mutations.papers.createPaperRecords`).
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

export { setResultReviewState } from "./mutations/results";

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
