---
phase: 47-test-safety-net
plan: 02
subsystem: testing
tags: [convex-test, vitest, credits, cascade-delete, integration-tests, occ, edge-runtime]

requires:
  - phase: none
    provides: existing deductCredits and deleteExtractionInternal mutations
provides:
  - Integration tests for concurrent credit deduction OCC behavior
  - Partial-failure recovery tests for cascade deletion
  - Idempotency verification for cascade deletion re-invocation
affects: [48-billing-simplification, 49-type-armor]

tech-stack:
  added: []
  patterns: [seedUserWithCredits helper for credit test seeding, partial-failure simulation via manual record deletion]

key-files:
  created:
    - convex/credits/deduct-credits.test.ts
  modified:
    - convex/extraction/cascade-delete.test.ts

key-decisions:
  - "Tests verify OCC behavior via sequential mutations -- convex-test serializes the same way production OCC does"
  - "Partial-failure simulated by manually deleting records before re-invoking cascade delete"

patterns-established:
  - "seedUserWithCredits(t, freeBalance, paidBalance): reusable credit test seeding helper"
  - "Partial-failure testing pattern: seed -> manually delete subset -> re-invoke -> verify completion"

requirements-completed: [TEST-02, TEST-04]

duration: 2min
completed: 2026-03-03
---

# Phase 47 Plan 02: Concurrent Credit Deduction & Cascade Delete Recovery Tests Summary

**convex-test integration tests for credit deduction OCC serialization and cascade deletion partial-failure recovery**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T07:16:22Z
- **Completed:** 2026-03-03T07:18:42Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- 6 credit deduction tests covering single deduction, split across free/paid pools, insufficient balance, exact deduction, and sequential OCC behavior
- 3 cascade deletion recovery tests covering partial-failure resume, exhaustive orphan checks, and idempotent re-invocation
- Full test suite passes (710 tests across 71 files, zero regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Concurrent credit deduction integration tests** - `2ff3eb2` (test)
2. **Task 2: Cascade deletion partial-failure recovery tests** - `41f277a` (test)

## Files Created/Modified
- `convex/credits/deduct-credits.test.ts` - 6 integration tests for deductCredits mutation: free-only deduction, free+paid split, insufficient balance, exact deduction, sequential deductions, post-exhaustion failure
- `convex/extraction/cascade-delete.test.ts` - 3 new tests added: partial-failure recovery after evidence unit pre-removal, complete deletion orphan verification, idempotent re-invocation on deleted job

## Decisions Made
- Tests verify OCC serialization behavior via sequential mutations in convex-test, which serializes the same way Convex production OCC does. No actual concurrent thread racing needed.
- Partial-failure simulation achieved by manually deleting specific records (evidence units) before re-invoking the cascade delete function, verifying it picks up from the correct step.
- Credit transaction records verified alongside balance updates to ensure audit trail completeness.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Credit deduction behavior is now documented by tests, safe for refactoring in later phases
- Cascade deletion recovery pattern is verified, safe for billing simplification work
- Both test files follow existing convex-test patterns and run in edge-runtime environment

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 47-test-safety-net*
*Completed: 2026-03-03*
