---
phase: 88-scorched-earth-teardown
plan: 01
subsystem: teardown
tags: [deletion, extraction, cleanup, code-removal]

# Dependency graph
requires: []
provides:
  - "All extraction UI routes, components, lib helpers, and standalone files deleted"
  - "All 26 extraction test files deleted (25 planned + 1 additional debug-internal)"
  - "Clean test suite with zero extraction import references"
affects: [88-02, 88-03, 88-04]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - tests/openalex-email.test.ts

key-decisions:
  - "Deleted tests/debug-internal.test.ts as additional extraction-only test (all 12 referenced files in convex/extraction/)"
  - "Updated tests/openalex-email.test.ts comment to remove stale extraction reference (file is non-extraction, preserved)"

patterns-established: []

requirements-completed: [TEAR-02, TEAR-03, TEAR-06, TEAR-07, TEAR-09]

# Metrics
duration: 4min
completed: 2026-04-15
---

# Phase 88 Plan 01: Wholesale Extraction Deletion Summary

**Deleted 93 extraction files across 5 directories plus 26 test files, removing ~15,800 lines of legacy extraction code**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-14T22:59:08Z
- **Completed:** 2026-04-14T23:03:00Z
- **Tasks:** 2
- **Files modified:** 94 (93 deleted + 1 edited)

## Accomplishments
- Deleted all extraction UI routes (`app/extraction/` -- 7 files), components (`components/extraction/` -- 44 files), and lib helpers (`lib/extraction/` -- 15 files)
- Deleted standalone extraction files: `lib/store/extraction.ts`, `lib/types/extraction.types.ts`, `lib/pdf/download.ts`, `convex/debug.ts`, `convex/debug_papers.ts`
- Deleted 26 extraction test files (25 planned + 1 discovered `debug-internal.test.ts`)
- All screening tests preserved (`tests/screening-utils.test.ts`, `tests/export-screening.test.ts`, etc.)
- Zero remaining test files reference deleted extraction modules

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete extraction UI directories and standalone files** - `3d04e75` (feat) -- 67 files deleted, 11,797 lines removed
2. **Task 2: Delete all extraction test files** - `fe44f09` (feat) -- 26 files deleted + 1 edited, 4,017 lines removed

## Files Created/Modified
- `app/extraction/` -- Deleted (7 files: routes and pages)
- `components/extraction/` -- Deleted (44 files: feature components including results-views/)
- `lib/extraction/` -- Deleted (15 files: UI helpers)
- `lib/store/extraction.ts` -- Deleted (Zustand extraction store)
- `lib/types/extraction.types.ts` -- Deleted (extraction type definitions)
- `lib/pdf/download.ts` -- Deleted (extraction-only PDF download utility per D-10)
- `convex/debug.ts` -- Deleted (extraction debug query)
- `convex/debug_papers.ts` -- Deleted (extraction debug query)
- `tests/extraction/` -- Deleted (2 files: rate-limit, workflow-cancel)
- `tests/answer-grouping.test.ts` through `tests/summary-cards.test.tsx` -- Deleted (21 test files)
- `tests/components/grouped-answer-row.test.tsx` -- Deleted
- `tests/debug-internal.test.ts` -- Deleted (deviation: discovered during Task 2)
- `tests/openalex-email.test.ts` -- Modified (removed stale extraction comment reference)

## Decisions Made
- `lib/pdf/download.ts` deleted entirely per D-10: verified only consumer was `convex/extraction/workpoolActions.ts`
- `tests/debug-internal.test.ts` deleted as additional extraction-only test: all 12 files it referenced were in `convex/extraction/`, making it entirely extraction-specific
- `tests/openalex-email.test.ts` preserved with comment update: tests OPENALEX_CONTACT_EMAIL env var validation (non-extraction concern), only had a comment referencing extraction

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Deleted tests/debug-internal.test.ts as additional extraction test**
- **Found during:** Task 2 (extraction test deletion)
- **Issue:** Post-deletion grep found `tests/debug-internal.test.ts` references `convex/extraction/` paths (12 files). Not in the plan's 25-file list but is entirely extraction-specific.
- **Fix:** Deleted the file since all 12 referenced files are in `convex/extraction/` (being deleted in Plan 02)
- **Files modified:** tests/debug-internal.test.ts (deleted)
- **Verification:** `grep -rl "convex/extraction" tests/` returns zero results
- **Committed in:** fe44f09 (Task 2 commit)

**2. [Rule 2 - Missing Critical] Updated stale extraction comment in tests/openalex-email.test.ts**
- **Found during:** Task 2 (extraction test deletion)
- **Issue:** Comment on line 18 referenced `convex/extraction/actions.ts` which is being deleted
- **Fix:** Updated comment to remove stale extraction path reference (file itself is not extraction-specific)
- **Files modified:** tests/openalex-email.test.ts
- **Verification:** `grep -c "extraction" tests/openalex-email.test.ts` returns 0
- **Committed in:** fe44f09 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 missing critical)
**Impact on plan:** Both auto-fixes necessary for clean test suite. No scope creep -- stayed within extraction teardown boundary.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None -- this plan is purely destructive deletion with no new code.

## Self-Check: PASSED

All claims verified:
- SUMMARY.md exists on disk
- Task 1 commit `3d04e75` found in git log
- Task 2 commit `fe44f09` found in git log
- All extraction directories confirmed deleted
- All standalone files confirmed deleted
- All test files confirmed deleted
- Screening tests confirmed preserved

## Next Phase Readiness
- All extraction-only directories and standalone files are deleted
- Codebase will NOT compile at this point (expected per D-02) -- shared files still reference deleted extraction modules
- Plan 02 handles shared file surgery (schema.ts, store.ts, sidebar, etc.)
- Plans 03-04 handle convex function deletion, config cleanup, and compilation restoration

---
*Phase: 88-scorched-earth-teardown*
*Completed: 2026-04-15*
