---
phase: 38-deletion-cascade-storage-cleanup
plan: 01
subsystem: database
tags: [convex, cascade-delete, scheduler, storage-cleanup, data-integrity]

# Dependency graph
requires:
  - phase: 37-schema-additions
    provides: "Schema with all extraction tables and indexes"
provides:
  - "Full cascade deletion for extraction jobs covering all 8 child tables"
  - "Scheduler-based batch deletion pattern (ctx.scheduler.runAfter) replacing ctx.runMutation"
  - "Inline PDF storage cleanup during paper deletion"
  - "cleanupFailedPaperStorage internal mutation for standalone storage cleanup"
affects: [40-extraction-workflow-fixes]

# Tech tracking
tech-stack:
  added: []
  patterns: ["scheduler.runAfter(0, ...) for self-scheduling batch deletes", "inline storage cleanup with try/catch per-item error isolation"]

key-files:
  created: []
  modified: ["convex/extraction/mutations.ts"]

key-decisions:
  - "No storageId patch after delete in cascade Step 4 since paper row is deleted immediately after"
  - "Job-scoped cleanupFailedPaperStorage avoids need for new global schema index"

patterns-established:
  - "Cascade deletion via scheduler self-scheduling: delete batch, schedule self, return null"
  - "Per-item error isolation for storage operations: catch and log per paper, never block loop"

requirements-completed: [DATA-01, DATA-02, DATA-03]

# Metrics
duration: 2min
completed: 2026-03-02
---

# Phase 38 Plan 01: Deletion Cascade and Storage Cleanup Summary

**Full cascade deletion for extraction jobs covering all 8 child tables with scheduler-based batching and inline PDF storage cleanup**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-02T08:11:09Z
- **Completed:** 2026-03-02T08:12:54Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Rewrote deleteExtraction to use ctx.scheduler.runAfter(0, ...) instead of ctx.runMutation, enabling independent batch commits that avoid transaction limits
- Added 5 missing child tables to the deletion cascade: extractionEvidenceUnits, extractionResultReviews, extractionSavedViews, extractionReportSnapshots, extractionRunDiffs
- Added inline PDF storage cleanup (ctx.storage.delete) during paper deletion step with per-paper error isolation
- Created cleanupFailedPaperStorage internal mutation for standalone job-scoped storage file cleanup

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite deleteExtraction and deleteExtractionInternal** - `7ad499f` (feat)
2. **Task 2: Add cleanupFailedPaperStorage internal mutation** - `476fd86` (feat)

## Files Created/Modified
- `convex/extraction/mutations.ts` - Rewrote deleteExtraction (scheduler pattern), deleteExtractionInternal (9-step full cascade), added cleanupFailedPaperStorage

## Decisions Made
- Skipped storageId patch-to-undefined in cascade Step 4 since the paper row is deleted immediately after storage cleanup -- patching would be a wasted write
- Scoped cleanupFailedPaperStorage to a single job (by_job index) to avoid needing a new global schema index on storageId

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Deletion cascade now covers all child entity types in correct dependency order
- Storage cleanup integrated for both cascade deletion and standalone failed-paper scenarios
- Ready for phase 40 (extraction workflow fixes) which also touches convex/extraction/mutations.ts

## Self-Check: PASSED

- FOUND: 38-01-SUMMARY.md
- FOUND: commit 7ad499f (Task 1)
- FOUND: commit 476fd86 (Task 2)
- FOUND: convex/extraction/mutations.ts

---
*Phase: 38-deletion-cascade-storage-cleanup*
*Completed: 2026-03-02*
