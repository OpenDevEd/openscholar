---
phase: 40-performance
plan: 02
subsystem: database
tags: [convex, performance, query-safety, batch-processing, cron]

# Dependency graph
requires:
  - phase: 40-performance-01
    provides: "N+1 query parallelization pattern in extraction mutations"
provides:
  - "5 unbounded .collect() calls bounded with .take(N) safety caps"
  - "Batch reschedule pattern for cleanupOldPdfs"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [".take(N) safety cap for administrative queries", "batch-reschedule with scheduler.runAfter on full batch"]

key-files:
  created: []
  modified:
    - convex/extraction/mutations.ts
    - convex/maintenance/mutations.ts
    - convex/subscriptions/internal.ts

key-decisions:
  - "Used CLEANUP_BATCH constant (500) for cleanupOldPdfs with reschedule since it performs writes in a loop"
  - "Used inline .take(200) for maintenance mutations -- cron handles re-processing on next run"
  - "Used CAP constant (1000) for listGrantEligibleSubscriptionPointers since three queries share the same limit"

patterns-established:
  - "Batch-reschedule: when a mutation processes results in a loop, cap with .take(N) and reschedule if batch is full"
  - "Safety cap: read-only cron/internal queries use .take(N) without reschedule, relying on periodic cron re-execution"

requirements-completed: [PERF-03]

# Metrics
duration: 2min
completed: 2026-03-02
---

# Phase 40 Plan 02: Unbounded .collect() Safety Caps Summary

**Bounded 5 unbounded .collect() calls across 3 files with .take(N) safety caps and batch-reschedule for cleanupOldPdfs**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-02T09:08:44Z
- **Completed:** 2026-03-02T09:10:31Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Bounded cleanupOldPdfs with .take(500) and batch-reschedule when batch is full
- Bounded expirePastDueSubscriptions and monitorFailedStripeEvents with .take(200)
- Bounded listActiveSubscriptions with .take(1000)
- Bounded listGrantEligibleSubscriptionPointers with .take(1000) on all three status queries via CAP constant

## Task Commits

Each task was committed atomically:

1. **Task 1: Bound cleanupOldPdfs with .take(500) and add reschedule** - `1fae848` (feat)
2. **Task 2: Bound maintenance and subscription unbounded .collect() calls** - `42fb600` (feat)

## Files Created/Modified
- `convex/extraction/mutations.ts` - cleanupOldPdfs bounded with .take(CLEANUP_BATCH) and scheduler.runAfter reschedule
- `convex/maintenance/mutations.ts` - expirePastDueSubscriptions and monitorFailedStripeEvents bounded with .take(200)
- `convex/subscriptions/internal.ts` - listActiveSubscriptions bounded with .take(1000), listGrantEligibleSubscriptionPointers bounded with CAP=1000

## Decisions Made
- Used CLEANUP_BATCH constant (500) for cleanupOldPdfs since it performs writes in a loop and needs batch-reschedule logic referencing the constant
- Used inline .take(200) for maintenance mutations since no reschedule needed -- cron handles re-processing on next run
- Used CAP constant (1000) for listGrantEligibleSubscriptionPointers since three separate queries share the same limit value

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 40 (performance) is now complete with both plans executed
- All identified unbounded .collect() calls are now bounded with safety caps
- Ready to proceed to next phase in v2.3 milestone

## Self-Check: PASSED

All files exist. All commits verified (1fae848, 42fb600).

---
*Phase: 40-performance*
*Completed: 2026-03-02*
