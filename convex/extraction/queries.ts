/**
 * Extraction queries barrel.
 *
 * Only public queries are re-exported here, pinning their stable
 * `api.extraction.queries.<fn>` paths (zero UI churn). Every internal
 * query surfaces at its long path — e.g.
 * `internal.extraction.queries.internal.getJobInternal` or
 * `internal.extraction.queries.papers.byId`.
 *
 * Submodules MUST NOT be imported directly from outside
 * convex/extraction/ — the T4.0 import-boundary guard enforces this.
 */

export {
  listJobs,
  listJobsForAssistant,
  countJobs,
  countJobsForAssistant,
  getJobShell,
  getJobDetails,
  subscribeToJobProgress,
} from "./queries/jobs";

export { countJobFailures, countJobFailuresForAssistant } from "./queries/failures";
export { listJobResults, listJobResultsForAssistant, countJobResults, countJobResultsForAssistant } from "./queries/results";
