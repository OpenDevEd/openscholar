---
phase: 56-performance-fixes
plan: 01
subsystem: api, database
tags: [convex, performance, bounded-queries, circuit-breaker, cron, batching]

# Dependency graph
requires: []
provides:
  - Bounded getLibraryCount query (.take(10_000) instead of .collect())
  - Batched checkSubscriptionStatus cron with 45s circuit-breaker and self-scheduling continuation
  - Cleaned up completed migration helpers (listAllConnections, migrateToEncryptedKeys)
affects: [56-performance-fixes]

# Tech tracking
tech-stack:
  added: []
  patterns: [circuit-breaker time budget for long-running cron actions, self-scheduling continuation via ctx.scheduler.runAfter]

key-files:
  created: []
  modified:
    - convex/library/queries.ts
    - convex/maintenance/internal.ts
    - convex/zotero/internal.ts
    - convex/zotero/actions.ts

key-decisions:
  - "Circuit-breaker resets startedAt on each continuation to give each batch a fresh 45s budget"
  - "Batching done at action level (slice + loop) rather than modifying listActiveSubscriptions query"
  - "expirePastDueSubscriptions only runs on first invocation (startIndex === 0) to avoid redundant mutation calls"

patterns-established:
  - "Circuit-breaker pattern: time-budgeted action with self-scheduling continuation for remaining work"
  - "Bounded query pattern: .take(N) instead of .collect() for user-scoped queries"

requirements-completed: [PERF-01, PERF-04, PERF-05]

# Metrics
duration: 3min
completed: 2026-03-04
---

# Phase 56 Plan 01: Performance Fixes Summary

**Bounded getLibraryCount with .take(10_000), batched subscription cron with 45s circuit-breaker, and removed completed migration helpers**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-04T06:21:50Z
- **Completed:** 2026-03-04T06:25:12Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Replaced unbounded .collect() with .take(10_000) in getLibraryCount to prevent full table scans
- Implemented circuit-breaker pattern in checkSubscriptionStatus with 45s time budget and self-scheduling continuation
- Removed completed migration helpers (listAllConnections and migrateToEncryptedKeys) that performed unbounded table scans

## Task Commits

Each task was committed atomically:

1. **Task 1: Bound getLibraryCount and delete migration helpers** - `80966ab` (feat)
2. **Task 2: Implement batched subscription cron with circuit-breaker** - `797664b` (feat)

## Files Created/Modified
- `convex/library/queries.ts` - Changed getLibraryCount from .collect() to .take(10_000)
- `convex/maintenance/internal.ts` - Added batched processing with circuit-breaker and self-scheduling continuation
- `convex/zotero/internal.ts` - Removed listAllConnections migration helper
- `convex/zotero/actions.ts` - Removed migrateToEncryptedKeys migration action

## Decisions Made
- Circuit-breaker resets startedAt to Date.now() on each continuation so every batch gets a fresh 45s budget rather than measuring from the original invocation
- Batching implemented at the action level (array slice + loop) rather than modifying the listActiveSubscriptions query, since it already returns at most 1000 subs
- expirePastDueSubscriptions only runs on the first invocation (when startIndex is 0) to avoid redundant mutation calls on continuation batches

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npx convex typecheck` fails due to pre-existing issue with `convex/lib/crypto.ts` importing `node:crypto` without `"use node"` directive -- not related to this plan's changes. Verified by running typecheck on the codebase before changes (same error). Used `tsc --noEmit` to confirm zero TypeScript errors in modified files.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Performance-critical queries are now bounded and safe for growing data
- Subscription cron can scale to any number of active subscriptions without hitting Convex action time limits
- Ready for Plan 02 (ExcelJS migration) or deployment

## Self-Check: PASSED

All files exist, all commits verified (80966ab, 797664b).

---
*Phase: 56-performance-fixes*
*Completed: 2026-03-04*
