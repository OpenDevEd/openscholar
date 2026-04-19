/**
 * Extraction queries barrel.
 *
 * Only the 15 PUBLIC queries are re-exported here, pinning their stable
 * `api.extraction.queries.<fn>` paths (zero UI churn). Every internal
 * query surfaces at its long path — e.g.
 * `internal.extraction.queries.internal.getJobInternal` or
 * `internal.extraction.queries.papers.byId`.
 *
 * Submodules MUST NOT be imported directly from outside
 * convex/extraction/ — the T4.0 import-boundary guard enforces this.
 */

export {
  getMyJobs,
  getJobDetails,
  subscribeToJobProgress,
  getJobSources,
} from "./queries/jobs";

export { getJobResults, getJobResultsPaginated } from "./queries/results";

export {
  getJobInsights,
  getQuestionInsights,
  getQuestionDisagreements,
} from "./queries/insights";

export { getReviewQueue } from "./queries/reviews";
export { getSavedViews } from "./queries/views";
export { getWorkflowTemplates } from "./queries/templates";
export { getReportSnapshots, getRunDiff } from "./queries/reports";
