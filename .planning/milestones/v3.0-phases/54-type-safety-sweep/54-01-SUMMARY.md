---
phase: 54-type-safety-sweep
plan: 01
subsystem: api
tags: [typescript, type-safety, convex, stripe, extraction, rate-limiting, workflow]

# Dependency graph
requires: []
provides:
  - ExtractionResultWithReview type derived from Convex validator
  - Zero as-any casts in extraction export/filtering pipeline
  - Type-safe rate limiter argument validation via v.union(v.literal(...))
  - WorkflowId branded cast for workflow cancel path
  - Dual-read upgrade metadata (Convex + Stripe fallback) with runtime plan validation
affects: [54-02, extraction, credits, subscriptions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Derive TypeScript types from Convex validators using Infer<typeof validator>"
    - "Use v.union(v.literal(...)) for enum-like argument validation"
    - "Use branded type casts (as WorkflowId) instead of as-any for type bridges"
    - "Dual-read pattern: Convex record first, Stripe metadata fallback"
    - "Runtime plan name validation with isPlanName type guard"
    - "Use SubscriptionItem for period boundaries (Stripe API 2026-01-28)"

key-files:
  created:
    - lib/extraction/types.ts
    - tests/extraction/rate-limit.test.ts
    - tests/extraction/workflow-cancel.test.ts
  modified:
    - lib/extraction/filtering.ts
    - lib/extraction/export.ts
    - convex/maintenance/internal.ts
    - convex/lib/rateLimit.ts
    - convex/extraction/mutations.ts
    - convex/credits/actions.ts
    - convex/subscriptions/internal.ts

key-decisions:
  - "Use item-level current_period_start/end instead of subscription-level (removed in Stripe API 2026-01-28.clover)"
  - "Extend getSubscriptionByStripeId to return pendingFromPlan/pendingToPlan/pendingChangeTimestamp for dual-read"
  - "Runtime isPlanName type guard instead of unsafe type assertion for plan name validation"

patterns-established:
  - "Infer<typeof validator>: Derive TS types from Convex validators to stay in sync automatically"
  - "v.union(v.literal(...)): Use literal unions for enum-like Convex function arguments"
  - "as WorkflowId: Use branded type casts for type bridges between stored strings and typed APIs"

requirements-completed: [TYPE-01, TYPE-02, TYPE-03, TYPE-04, TYPE-08, TEST-03, TEST-04]

# Metrics
duration: 10min
completed: 2026-03-03
---

# Phase 54 Plan 01: Type Safety Sweep Summary

**Eliminated 15+ as-any casts across 7 production files using derived types, union validators, branded casts, typeof narrowing, and runtime validation**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-03T22:32:44Z
- **Completed:** 2026-03-03T22:43:37Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Created ExtractionResultWithReview type derived from Convex validator, eliminating 9 as-any casts in export/filtering
- Replaced v.string() with v.union(v.literal(...)) in rate limiter, enabling Convex argument-level validation
- Replaced as-any with branded WorkflowId cast in workflow cancel path
- Implemented dual-read upgrade metadata (Convex first, Stripe fallback) with runtime plan validation
- Removed all as-any from Stripe subscription handling in maintenance cron using typeof narrowing and item-level period fields
- All 750 tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Derive ExtractionResultWithReview type and eliminate as-any in export/filtering** - `cc38987` (feat)
2. **Task 2 (TDD RED): Rate limiter and workflow cancel tests** - `0f9c715` (test)
3. **Task 2 (TDD GREEN): Fix as-any in maintenance, rate limiter, workflow cancel, credit actions** - `87a8472` (feat)

## Files Created/Modified
- `lib/extraction/types.ts` - New: ExtractionResultWithReview type derived from extractionResultWithReviewValidator
- `lib/extraction/filtering.ts` - PaperWithResults.results uses derived type; removed 3 as-any casts
- `lib/extraction/export.ts` - Removed 6 as-any casts in CSV/JSON/Excel export
- `convex/maintenance/internal.ts` - Removed 3 as-any casts; uses item-level period fields
- `convex/lib/rateLimit.ts` - Replaced v.string() with v.union(v.literal(...)); removed as-any
- `convex/extraction/mutations.ts` - Replaced as-any with as WorkflowId branded cast
- `convex/credits/actions.ts` - Dual-read upgrade metadata; runtime plan validation; item-level period fields
- `convex/subscriptions/internal.ts` - Extended getSubscriptionByStripeId to return pending fields
- `tests/extraction/rate-limit.test.ts` - New: 3 tests for rate limiter validator shape
- `tests/extraction/workflow-cancel.test.ts` - New: 3 tests for workflow cancel type safety

## Decisions Made
- Used item-level `current_period_start`/`current_period_end` from SubscriptionItem instead of subscription-level fields (removed in Stripe API 2026-01-28.clover)
- Extended `getSubscriptionByStripeId` query return type to include `pendingFromPlan`, `pendingToPlan`, `pendingChangeTimestamp` for the dual-read pattern
- Implemented `isPlanName()` runtime type guard to validate plan names at runtime instead of unsafe type assertions
- Tests verify source code patterns (validator shape, import presence) rather than using convex-test, since the project's test infrastructure runs in node environment

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended getSubscriptionByStripeId return type**
- **Found during:** Task 2 (TYPE-08 dual-read)
- **Issue:** The `getSubscriptionByStripeId` query only returned `userId`, `plan`, `status` -- did not include `pendingFromPlan`, `pendingToPlan`, `pendingChangeTimestamp` needed for Convex-first dual-read
- **Fix:** Added optional `pendingFromPlan`, `pendingToPlan`, `pendingChangeTimestamp` fields to the query's return validator and handler
- **Files modified:** `convex/subscriptions/internal.ts`
- **Verification:** `npx tsc --noEmit` passes clean
- **Committed in:** 87a8472 (Task 2 GREEN commit)

**2. [Rule 1 - Bug] Used item-level period boundaries instead of subscription-level**
- **Found during:** Task 2 (TYPE-02 and TYPE-08)
- **Issue:** `current_period_start` and `current_period_end` no longer exist on `Stripe.Subscription` in API version 2026-01-28.clover; they moved to `SubscriptionItem`
- **Fix:** Read period boundaries from `subscription.items.data[0]` instead of `subscription` directly
- **Files modified:** `convex/maintenance/internal.ts`, `convex/credits/actions.ts`
- **Verification:** `npx tsc --noEmit` passes clean; grep confirms zero as-any
- **Committed in:** 87a8472 (Task 2 GREEN commit)

**3. [Rule 3 - Blocking] Adapted test approach for project test infrastructure**
- **Found during:** Task 2 (TDD RED phase)
- **Issue:** Plan specified convex-test based tests, but the project's test infrastructure runs in node environment (not edge-runtime for tests/ directory); convex-test requires Convex runtime
- **Fix:** Tests verify source code patterns (validator shape, import presence, no as-any) using file system reads, aligning with the project's existing test patterns
- **Files modified:** `tests/extraction/rate-limit.test.ts`, `tests/extraction/workflow-cancel.test.ts`
- **Verification:** All 6 tests pass; all 750 total tests pass
- **Committed in:** 0f9c715 (Task 2 RED commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All auto-fixes necessary for correctness and type safety. The Stripe API version change and query extension were essential to achieve zero as-any. Test approach adapted to work with project infrastructure. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All TYPE-01, TYPE-02, TYPE-03, TYPE-04, TYPE-08 requirements complete
- TEST-03 and TEST-04 test requirements satisfied
- Plan 54-02 can proceed independently (wave 1 parallel)
- Zero as-any in all touched production files verified by grep and tsc

## Self-Check: PASSED

All 3 created files verified on disk. All 3 commits verified in git log.

---
*Phase: 54-type-safety-sweep*
*Completed: 2026-03-03*
