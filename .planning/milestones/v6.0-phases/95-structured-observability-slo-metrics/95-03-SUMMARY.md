---
phase: 95-structured-observability-slo-metrics
plan: 03
subsystem: observability
tags: [per-job-metrics, slo-metrics, citation-validity, cost-tracking, extraction-query]

# Dependency graph
requires:
  - phase: 95-structured-observability-slo-metrics
    plan: 01
    provides: "computeCostUsd and COST_PER_MILLION_TOKENS from logging.ts; citationValidityRate and recallOnInclude fields on extractionJobs schema"
  - phase: 95-structured-observability-slo-metrics
    plan: 02
    provides: "traceId propagation and timing instrumentation providing latency data for metrics aggregation"
provides:
  - "getExtractionJobMetrics public query returning 6 typed operational + SLO metrics"
  - "citationValidityRate computed and persisted at job completion in finalizeJobIfDone"
  - "recallOnInclude null placeholder for Phase 96 forward compatibility"
affects: [95-04, extraction-ui, dashboard, phase-96-eval-loop]

# Tech tracking
tech-stack:
  added: []
  patterns: [per-job-metrics-aggregation, slo-persistence-at-finalization]

key-files:
  created: []
  modified:
    - convex/extraction/queries.ts
    - convex/extraction/mutations.ts

key-decisions:
  - "Single combined query for operational + SLO metrics (D-12/D-13/D-21) instead of separate queries"
  - "citationValidityRate computed inside finalizeJobIfDone to avoid OCC contention (same transaction as status update)"
  - "recallOnInclude persisted as null at finalization for Phase 96 forward compatibility"

patterns-established:
  - "Per-job metrics aggregation: compute from child tables (extractionPapers, extractionResults) using indexed queries with .take() bounds"
  - "SLO persistence at finalization: compute once at job completion, persist on job row for O(1) retrieval"

requirements-completed: [OBS-04, OBS-05]

# Metrics
duration: 2min
completed: 2026-04-15
---

# Phase 95 Plan 03: Per-Job Metrics Query and SLO Persistence Summary

**getExtractionJobMetrics query aggregating latency/cost/errors from child tables with citationValidityRate computed at job finalization**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-15T08:24:39Z
- **Completed:** 2026-04-15T08:27:06Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `getExtractionJobMetrics` public query returning 6 typed fields (papersProcessed, averageLatencyMs, estimatedCostUsd, errorCount, citationValidityRate, recallOnInclude)
- Auth + ownership guard follows existing getExtractionProgress pattern (getCurrentUser + job.userId check)
- All reads bounded with MAX_EXTRACTION_PAPERS_PER_JOB limits (200 papers, 2000 results max)
- citationValidityRate computed from criticVerdict supported/total ratio at job finalization
- recallOnInclude set to null as Phase 96 forward-compatible placeholder

## Task Commits

Each task was committed atomically:

1. **Task 1: Add getExtractionJobMetrics query** - `c41775b` (feat)
2. **Task 2: Compute and persist citationValidityRate in finalizeJobIfDone** - `e39b7b4` (feat)

## Files Created/Modified
- `convex/extraction/queries.ts` - Added getExtractionJobMetrics query with auth, latency aggregation, cost computation via computeCostUsd import, error counting, and SLO metric retrieval
- `convex/extraction/mutations.ts` - Modified finalizeJobIfDone to compute citationValidityRate from extractionResults criticVerdict data and persist with recallOnInclude: null

## Decisions Made
- Combined operational metrics (D-12/D-13) and SLO metrics (D-21) into a single query per plan discretion note -- reduces client round trips
- citationValidityRate computed inside finalizeJobIfDone (same transaction as status update) to avoid OCC contention per Pitfall 3 from RESEARCH
- recallOnInclude persisted as null at job finalization -- Phase 96 eval loop will populate this field

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `convex/extraction/mutations.test.ts` fails due to pre-existing `convex-test` infrastructure issue (`_generated` directory not found in worktree). Verified this failure exists on the base commit before any changes -- not caused by this plan. Documented in 95-01-SUMMARY.md and 95-02-SUMMARY.md as well.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `getExtractionJobMetrics` query is ready for UI consumption in Plan 04 (dashboard metrics display)
- citationValidityRate is persisted on completed jobs -- UI can display quality metrics
- recallOnInclude null placeholder ready for Phase 96 eval loop to populate

## Self-Check: PASSED

- convex/extraction/queries.ts exists with getExtractionJobMetrics query
- convex/extraction/mutations.ts exists with citationValidityRate computation
- Commit c41775b found (Task 1)
- Commit e39b7b4 found (Task 2)
- All 6 return validator fields present (papersProcessed, averageLatencyMs, estimatedCostUsd, errorCount, citationValidityRate, recallOnInclude)
- computeCostUsd imported from ./logging
- getCurrentUser auth check in metrics query
- by_job_status and by_job indexes used for bounded queries
- criticVerdict === "supported" computation in finalizeJobIfDone

---
*Phase: 95-structured-observability-slo-metrics*
*Completed: 2026-04-15*
