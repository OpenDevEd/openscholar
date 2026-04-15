---
phase: 89-core-schema-workflow-skeleton
plan: 01
subsystem: database
tags: [convex, schema, workpool, validators, extraction]

# Dependency graph
requires:
  - phase: 88-scorched-earth-teardown
    provides: Clean slate with all legacy extraction code and tables removed
provides:
  - Four extraction tables (extractionJobs, extractionPapers, extractionQuestions, extractionResults) with indexes
  - extractionWorkpool component registration
  - extractionPool workpool instance with maxParallelism 5
  - Extraction validators (job status, paper status, question, paper input)
  - Extraction error codes (EXTRACTION_JOB_ALREADY_ACTIVE, NOT_FOUND, NOT_CANCELLABLE)
  - Query bounds constants (MAX_EXTRACTION_PAPERS_PER_JOB, MAX_EXTRACTION_JOBS_PER_USER)
affects: [89-02-PLAN, phase-90, phase-91, phase-92]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Extraction tables mirror screening table patterns (same index naming, same field conventions)"
    - "Separate extractionQuestions table for per-question independent querying in Phase 91"
    - "Named workpool component registration with aliased imports from same package"

key-files:
  created:
    - convex/extraction/validators.ts
  modified:
    - convex/schema.ts
    - convex/convex.config.ts
    - convex/workpool.ts
    - convex/lib/errors.ts
    - convex/lib/queryBounds.ts

key-decisions:
  - "Separate extractionQuestions table instead of array-only on job -- enables per-question parallelism in Phase 91"
  - "extractionResults starts minimal (jobId, paperId, questionId, createdAt) -- answer/confidence/evidence fields added in Phase 91"
  - "maxParallelism 5 for extraction matches screening -- caps concurrent resource consumption per T-89-02"

patterns-established:
  - "Extraction validators in convex/extraction/validators.ts mirror convex/screening/validators.ts structure"
  - "Named component pattern: import alias + { name: string } registration for multiple workpool instances"

requirements-completed: [WORK-01, WORK-02, WORK-07]

# Metrics
duration: 2min
completed: 2026-04-15
---

# Phase 89 Plan 01: Schema, Component, and Validator Foundation Summary

**Four extraction tables with composite indexes, extractionWorkpool component, extractionPool instance, and typed validators for the v6.0 extraction pipeline**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-15T00:33:58Z
- **Completed:** 2026-04-15T00:36:33Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Four extraction tables defined in schema.ts with proper indexes including by_paper_question composite index for idempotent saves
- extractionWorkpool component registered as named component and extractionPool instance created with maxParallelism 5
- Extraction validators exported from convex/extraction/validators.ts matching screening validator patterns
- Error codes and query bounds constants added for extraction pipeline

## Task Commits

Each task was committed atomically:

1. **Task 1: Create extraction validators and add error codes + query bounds** - `16d8874` (feat)
2. **Task 2: Add extraction tables to schema, register workpool component, create pool instance** - `9615e30` (feat)

## Files Created/Modified
- `convex/extraction/validators.ts` - Extraction-specific validators: job status (5 literals), paper status (6 literals with parsing/extracting), question (with expectedType), paper input
- `convex/schema.ts` - Four new extraction tables: extractionJobs, extractionPapers, extractionQuestions, extractionResults with indexes
- `convex/convex.config.ts` - extractionWorkpool component registered as named workpool
- `convex/workpool.ts` - extractionPool instance with maxParallelism 5 and retry config
- `convex/lib/errors.ts` - Three extraction error codes added to ErrorCode union
- `convex/lib/queryBounds.ts` - MAX_EXTRACTION_PAPERS_PER_JOB (200) and MAX_EXTRACTION_JOBS_PER_USER (500)

## Decisions Made
- Separate extractionQuestions table alongside denormalized questions array on extractionJobs -- follows Convex guideline against unbounded arrays, enables Phase 91 per-question parallelism
- extractionResults starts with minimal fields (jobId, paperId, questionId, createdAt) -- answer/confidence/evidence fields deferred to Phase 91 (EXTR-02)
- maxParallelism 5 matches screening pool config -- consistent resource consumption caps

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four extraction tables ready for Plan 02 (workflow and mutation implementation)
- extractionPool instance available for workpool action scheduling
- Validators ready for function argument/return type validation
- Error codes ready for createError() calls in mutations
- Query bounds constants ready for .take(N) guards

## Self-Check: PASSED

All 7 files verified present. Both commit hashes (16d8874, 9615e30) confirmed in git log.
