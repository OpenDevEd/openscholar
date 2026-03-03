---
phase: 51-performance
plan: 01
subsystem: database
tags: [convex, n+1, batch-query, performance, take-guard]

# Dependency graph
requires: []
provides:
  - Batched review loading via loadReviewsByJob (single by_job query replaces N per-paper queries)
  - applyReviewMetadata synchronous overlay (no DB calls)
  - .take(500) safety bounds on all per-job extractionPapers queries
affects: [extraction]

# Tech tracking
tech-stack:
  added: []
  patterns: [batch-then-map review loading, MAX_PAPERS_PER_JOB safety bound]

key-files:
  created: []
  modified:
    - convex/extraction/queries.ts
    - convex/extraction/mutations.ts

key-decisions:
  - "Kept attachReviewMetadata for single-paper callers (getPaperResults) since 1 query is appropriate"
  - "Used MAX_PAPERS_PER_JOB = 500 as safety bound matching typical job size limits"
  - "Applied .take() to all per-job paper queries including internal/debug queries for consistency"
  - "Did NOT bound questions queries (always 5-20 per job) or paginated queries (inherently bounded)"

patterns-established:
  - "Batch review loading: load all reviews for a job once, apply synchronously per paper"
  - "Safety bounds: all per-job .collect() on large tables use .take(MAX_PAPERS_PER_JOB)"

requirements-completed: [PERF-01, PERF-02]

# Metrics
duration: 6min
completed: 2026-03-03
---

# Phase 51 Plan 01: Extraction Performance Summary

**Batch review loading to eliminate N+1 queries and .take(500) safety bounds on all per-job paper queries**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-03T09:44:09Z
- **Completed:** 2026-03-03T09:50:12Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Eliminated N+1 review queries: loadJobPapersAndResults, getJobResults, and getJobResultsPaginated now load all reviews in a single by_job query instead of one per-paper query
- Added loadReviewsByJob batch function and applyReviewMetadata synchronous overlay
- Bounded all per-job extractionPapers .collect() calls with .take(500) in both queries.ts and mutations.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Batch review loading to fix N+1 queries** - `934bc69` (feat)
2. **Task 2: Bound unbounded .collect() calls with .take() guards** - `cd9f371` (feat)

**Plan metadata:** `22164e4` (docs: complete plan)

## Files Created/Modified
- `convex/extraction/queries.ts` - Added loadReviewsByJob, applyReviewMetadata, MAX_PAPERS_PER_JOB constant; refactored 3 multi-paper query functions to use batch review loading; bounded 7 per-job paper queries with .take(500)
- `convex/extraction/mutations.ts` - Added MAX_PAPERS_PER_JOB constant; bounded 5 per-job paper queries with .take(500)

## Decisions Made
- Kept attachReviewMetadata for single-paper callers (getPaperResults) -- 1 query per request is fine for single-paper lookups
- Used MAX_PAPERS_PER_JOB = 500 as safety bound, matching reasonable upper limit for extraction jobs
- Applied .take() guards to internal/debug queries too for consistency, not just public queries
- Did NOT bound extractionQuestions queries (always small, 5-20 per job) or paginated queries (inherently bounded by .paginate())

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Extraction queries are now optimized for larger job sizes
- No blockers for remaining performance work in 51-02

## Self-Check: PASSED

- All created/modified files exist
- Both task commits verified (934bc69, cd9f371)
- loadReviewsByJob, applyReviewMetadata, MAX_PAPERS_PER_JOB all present

---
*Phase: 51-performance*
*Completed: 2026-03-03*
