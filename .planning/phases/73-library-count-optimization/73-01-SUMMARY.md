---
phase: 73-library-count-optimization
plan: 01
subsystem: database
tags: [convex, denormalization, counter, performance, library]

# Dependency graph
requires: []
provides:
  - O(1) library count via denormalized libraryItemCount on users table
  - Atomic counter maintenance in all 3 mutation paths (save, remove, removeByOpenalexId)
  - Lazy backfill fallback for existing users without counter field
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [denormalized counter with Math.max guard, lazy backfill on read]

key-files:
  created: []
  modified:
    - convex/schema.ts
    - convex/library/mutations.ts
    - convex/library/queries.ts
    - convex/library/queries.test.ts

key-decisions:
  - "Skip scheduler backfill in query context (Convex limitation) -- counter initializes on first mutation"
  - "Use Math.max(0, count - 1) to prevent negative counters"

patterns-established:
  - "Denormalized counter: optional field + lazy scan fallback + mutation-driven initialization"

requirements-completed: [PERF-01, PERF-02, PERF-03]

# Metrics
duration: 3min
completed: 2026-03-06
---

# Phase 73 Plan 01: Library Count Optimization Summary

**O(1) library count via denormalized libraryItemCount field on users table with atomic counter maintenance in all mutation paths**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-06T08:09:40Z
- **Completed:** 2026-03-06T08:12:40Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Replaced O(N) scan-based getLibraryCount with O(1) field read from user.libraryItemCount
- All 3 mutation paths (saveToLibrary, removeFromLibrary, removeFromLibraryByOpenalexId) atomically maintain counter
- 8 new tests covering counter increment, decrement, re-rate safety, lazy backfill, and negative guard
- All 786 tests pass across 81 test files (zero regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add schema field + backfill mutation + wire counter into mutations and query** - `9fe3511` (feat)
2. **Task 2: Add tests for counter behavior across all mutation paths** - `1a540dc` (test)

## Files Created/Modified
- `convex/schema.ts` - Added optional libraryItemCount field to users table
- `convex/library/mutations.ts` - Added backfillLibraryCount internal mutation, counter increment/decrement in all 3 mutation paths
- `convex/library/queries.ts` - Updated getLibraryCount to read counter directly with scan fallback
- `convex/library/queries.test.ts` - Added 8 counter behavior tests in new "library counter" describe block

## Decisions Made
- Skipped ctx.scheduler.runAfter backfill in query context since Convex queries do not have scheduler access. Counter initializes on the user's next save/remove mutation instead.
- Used Math.max(0, count - 1) guard to prevent counter from going negative in edge cases.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Library count optimization complete and tested
- No blockers for subsequent phases

---
*Phase: 73-library-count-optimization*
*Completed: 2026-03-06*
