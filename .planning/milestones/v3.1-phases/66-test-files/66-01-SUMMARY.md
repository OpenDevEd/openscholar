---
phase: 66-test-files
plan: 01
subsystem: testing
tags: [vitest, mock-factories, type-safety, convex]

# Dependency graph
requires:
  - phase: 65-mock-factories
    provides: Mock factories (createMockQueryCtx, createMockMutationCtx, createMockActionCtx, mockId, createMockUser, createMockSubscription, createMockStripeEvent, etc.)
provides:
  - 7 fully typed Convex backend test files with zero any patterns
  - All 76 tests passing with proper types
affects: [66-test-files]

# Tech tracking
tech-stack:
  added: []
  patterns: [factory-based test mocking, typed handler access via explicit function signatures]

key-files:
  modified:
    - tests/auth-state-machine.test.ts
    - tests/plan-enforcement.test.ts
    - tests/user-creation.test.ts
    - tests/debug-gate.test.ts
    - tests/ensure-user.test.ts
    - tests/sync-profile.test.ts
    - tests/stripe-webhook-handler.test.ts

key-decisions:
  - "Used createMockQueryCtx factory with deep overrides instead of inline partial mocks for auth tests"
  - "Used createMockMutationCtx for requirePlanTier tests since it expects MutationCtx (not QueryCtx)"
  - "Kept local createMockMutationCtx in user-creation.test.ts for insert tracking, typed with Record<string, unknown> and MutationCtx cast"
  - "Used explicit handler type signatures (e.g. { handler: (ctx: MutationCtx, args: ...) => ... }) instead of as any for mutation mock access"
  - "Used as unknown as Id<'users'> in vi.hoisted block for sync-profile since factory imports unavailable before mock hoisting"
  - "Used ReturnType<typeof vi.fn> cast for mock method access on typed ActionCtx in stripe-webhook-handler"

patterns-established:
  - "Factory-first test mocking: import from tests/factories instead of inline as any casts"
  - "Typed handler access: cast mutation mock return to explicit handler signature"

requirements-completed: [TEST-01, TEST-02]

# Metrics
duration: 5min
completed: 2026-03-04
---

# Phase 66 Plan 01: Type Test Files Summary

**Eliminated all `: any`, `as any`, `any[]` from 7 Convex backend test files using Phase 65 mock factories -- 76 tests passing with full type safety**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-04T22:00:57Z
- **Completed:** 2026-03-04T22:06:14Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Replaced 43 `any` patterns across 7 test files with proper types using mock factories
- All 76 tests pass unchanged after type modifications (behavioral equivalence maintained)
- Established factory-first test mocking pattern for future test development

## Task Commits

Each task was committed atomically:

1. **Task 1: Type Convex auth and plan test files** - `8a9dc69` (feat)
2. **Task 2: Type user mutation and webhook test files** - `cb16cf2` (feat)

## Files Created/Modified
- `tests/auth-state-machine.test.ts` - Uses createMockQueryCtx, createMockIdentity, createMockUser from factories
- `tests/plan-enforcement.test.ts` - Uses createMockSubscription, createMockMutationCtx, mockId from factories
- `tests/user-creation.test.ts` - Typed local mock with Record<string, unknown> and MutationCtx cast
- `tests/debug-gate.test.ts` - Replaced error: any with error: unknown + typed assertion
- `tests/ensure-user.test.ts` - Uses createMockMutationDef, createMockMutationCtx, createMockIdentity from factories
- `tests/sync-profile.test.ts` - Uses createMockMutationDef, mockId, typed MutationCtx with Id<"users"> cast
- `tests/stripe-webhook-handler.test.ts` - Uses createMockActionCtx, createMockMutationRefs, createMockGrantRefs, createMockStripeInvoice from factories

## Decisions Made
- Used `createMockMutationCtx` (not `createMockQueryCtx`) for `requirePlanTier` tests since the function signature requires `MutationCtx`
- Kept the local `createMockMutationCtx` in `user-creation.test.ts` because it tracks inserts in an array -- typed it with `Record<string, unknown>` instead of `any` and cast the returned ctx to `MutationCtx`
- For `vi.hoisted` blocks where factory imports are unavailable, used `as unknown as Id<"users">` which follows the same pattern factories use internally
- Cast `ctx.runMutation` to `ReturnType<typeof vi.fn>` for mock method access rather than using `as any` on the whole ctx

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 7 Convex backend test files are fully typed
- Ready for plan 02 (remaining test files) to complete type safety across the full test suite

## Self-Check: PASSED

All 7 modified files verified present. Both task commits (8a9dc69, cb16cf2) verified in git log.

---
*Phase: 66-test-files*
*Completed: 2026-03-04*
