---
phase: 40-performance
plan: 01
subsystem: api
tags: [convex, promise-all, n-plus-one, performance, extraction]

# Dependency graph
requires:
  - phase: 36-type-safety-sweep
    provides: "Type-safe extraction helpers and queries"
provides:
  - "Parallelized loadJobDataForReporting (mutations.ts)"
  - "Parallelized loadJobPapersAndResults (queries.ts)"
affects: [40-performance]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Promise.all(items.map(async ...)) for concurrent DB reads within Convex transactions"]

key-files:
  created: []
  modified:
    - convex/extraction/mutations.ts
    - convex/extraction/queries.ts

key-decisions:
  - "Pure scheduling change: only for-loop open/close lines modified, preserving all logic and return types"

patterns-established:
  - "Promise.all(papers.map(async ...)) pattern for concurrent per-item DB queries in Convex"

requirements-completed: [PERF-01, PERF-02]

# Metrics
duration: 1min
completed: 2026-03-02
---

# Phase 40 Plan 01: N+1 Query Parallelization Summary

**Replaced sequential for-loops with Promise.all(papers.map(...)) in loadJobDataForReporting and loadJobPapersAndResults to eliminate N+1 query bottlenecks**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-02T09:04:55Z
- **Completed:** 2026-03-02T09:06:15Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Parallelized `loadJobDataForReporting` in mutations.ts -- results and reviews for all papers now fetched concurrently instead of sequentially
- Parallelized `loadJobPapersAndResults` in queries.ts -- results and review metadata for all papers now fetched concurrently
- Return types and data shapes unchanged: all 6 callers continue to work without modification
- Total diff: 4 insertions, 4 deletions (pure scheduling change)

## Task Commits

Each task was committed atomically:

1. **Task 1: Parallelize loadJobDataForReporting in mutations.ts** - `c56af8c` (perf)
2. **Task 2: Parallelize loadJobPapersAndResults in queries.ts** - `3189332` (perf)

## Files Created/Modified
- `convex/extraction/mutations.ts` - loadJobDataForReporting now uses Promise.all(papers.map(...)) for concurrent results/reviews fetching
- `convex/extraction/queries.ts` - loadJobPapersAndResults now uses Promise.all(papers.map(...)) for concurrent results+review metadata fetching

## Decisions Made
- Pure scheduling change only: modified only the for-loop open/close lines, preserving all inner logic, Map declarations, and return statements identically

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both extraction reporting helpers now run concurrent queries
- Ready for 40-02 (additional performance optimizations if planned)
- All callers (createExtractionReportSnapshot, createExtractionRunDiff, getJobDashboard, getQuestionInsight, getQuestionDisagreements, getReviewQueue) unaffected

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 40-performance*
*Completed: 2026-03-02*
