---
phase: 57-incremental-aggregation
plan: 01
subsystem: database
tags: [convex, incremental-aggregation, extraction, upsert, cascade-delete, tdd]

requires:
  - phase: 56-performance-fixes
    provides: bounded queries and circuit-breaker cron patterns
provides:
  - extractionJobStats table with per-question scalar aggregation counters
  - incremental upsert on paper completion in saveExtractionResultsAndComplete
  - cascade delete step for extractionJobStats in deleteExtractionInternal
affects: [57-02 fast-path reads, extraction report queries, extraction pipeline]

tech-stack:
  added: []
  patterns: [incremental-upsert-on-write, confidence-bucket-classification, cascade-delete-step]

key-files:
  created:
    - convex/extraction/job-stats.test.ts
  modified:
    - convex/schema.ts
    - convex/extraction/mutations.ts

key-decisions:
  - "Test placed in convex/extraction/ (not tests/) to match convex-test edge-runtime requirement"
  - "Stats upsert placed after paper existence check, before paper patch, to ensure paper.jobId is available"
  - "Confidence buckets: >=0.8 high, >=0.5 medium, <0.5 low, undefined unknown"

patterns-established:
  - "Incremental upsert: query by_job_question unique, compute delta, patch existing or insert new"
  - "Confidence bucket classification: high>=0.8, medium>=0.5, low<0.5, unknown=undefined"

requirements-completed: [PERF-02]

duration: 4min
completed: 2026-03-04
---

# Phase 57 Plan 01: Stats Table and Incremental Upsert Summary

**extractionJobStats table with incremental per-question counter upsert on paper completion and cascade delete**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-04T06:51:57Z
- **Completed:** 2026-03-04T06:55:57Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 3

## Accomplishments
- Added extractionJobStats table to schema with by_job and by_job_question indexes
- Implemented incremental upsert in saveExtractionResultsAndComplete that tracks totalPapers, answered counts, citation status breakdown, confidence sum/count, and confidence bucket counts per question
- Added Step 7b cascade delete in deleteExtractionInternal for extractionJobStats cleanup
- 4 convex-test unit tests covering stats creation, confidence bucket classification, accumulation across papers, and cascade delete

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests for extractionJobStats** - `384c2d5` (test)
2. **Task 1 (GREEN): Implement schema, upsert, and cascade delete** - `af272d6` (feat)

_TDD task with RED and GREEN commits._

## Files Created/Modified
- `convex/schema.ts` - Added extractionJobStats table definition with 14 counter fields and 2 indexes
- `convex/extraction/mutations.ts` - Added upsert logic in saveExtractionResultsAndComplete and Step 7b cascade delete in deleteExtractionInternal
- `convex/extraction/job-stats.test.ts` - 4 convex-test unit tests for stats upsert and cascade delete

## Decisions Made
- Test file placed at `convex/extraction/job-stats.test.ts` instead of `tests/extraction-job-stats.test.ts` because convex-test requires edge-runtime environment, which is only configured for `convex/**/*.test.ts` in vitest.config.ts
- Stats upsert positioned after paper existence check but before paper patch to ensure paper.jobId is available for the upsert query
- Confidence bucket thresholds: >=0.8 high, >=0.5 medium, <0.5 low, undefined unknown -- matching the plan specification

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test file location adjusted for edge-runtime requirement**
- **Found during:** Task 1 (TDD RED phase)
- **Issue:** Plan specified `tests/extraction-job-stats.test.ts` but convex-test tests require edge-runtime environment, only configured for `convex/**/*.test.ts` glob in vitest.config.ts
- **Fix:** Placed test at `convex/extraction/job-stats.test.ts` matching existing pattern (cascade-delete.test.ts)
- **Files modified:** convex/extraction/job-stats.test.ts
- **Verification:** Tests run and pass correctly with edge-runtime

**2. [Rule 1 - Bug] Fixed invalid job status in test seed data**
- **Found during:** Task 1 (TDD RED phase)
- **Issue:** Test used `"processing"` status which is not a valid extractionJobs status literal
- **Fix:** Changed to `"extracting"` which is a valid status value per schema
- **Files modified:** convex/extraction/job-stats.test.ts
- **Verification:** Schema validation passes, tests run correctly

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for test infrastructure compatibility. No scope creep.

## Issues Encountered
- Pre-existing TypeScript errors in unrelated files (convex/crons.ts, convex/apiKeys/, convex/zotero/, convex/lib/envValidation.ts) about missing `audit` and `envValidation` modules. These are from undeployed phases and are out of scope. No new TS errors introduced by this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- extractionJobStats table is ready for fast-path reads in Plan 02
- Report queries (getJobInsights, getQuestionInsights) can now read from pre-aggregated stats instead of full fan-out
- Lazy backfill for existing completed jobs without stats rows can be implemented in Plan 02

## Self-Check: PASSED

All files verified present, all commits verified in git log.

---
*Phase: 57-incremental-aggregation*
*Completed: 2026-03-04*
