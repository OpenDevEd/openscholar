---
phase: 03-operational-hardening
plan: 02
subsystem: payments
tags: [stripe, webhooks, idempotency, toctou, convex, occ]

# Dependency graph
requires:
  - phase: 02-credit-system-correctness
    provides: "DEDUP CONTRACT pattern on grantMonthlyCredits, credit grant/refund/deduction mutations"
provides:
  - "IDEMPOTENCY CONTRACT JSDoc on all 4 financial webhook handlers in http.ts"
  - "IDEMPOTENCY CONTRACT JSDoc on grantPurchasedCreditsFromPaymentIntent and reversePurchasedCreditsFromRefund"
  - "TOCTOU CONTRACT JSDoc on deductCredits with race condition analysis and mitigation strategy"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: ["IDEMPOTENCY CONTRACT JSDoc pattern for webhook handler audit trail", "TOCTOU CONTRACT JSDoc pattern for race condition documentation"]

key-files:
  created: []
  modified:
    - convex/http.ts
    - convex/credits/internal.ts

key-decisions:
  - "All 4 financial webhook handlers confirmed idempotent -- no code fixes needed, documentation only"
  - "TOCTOU mitigation trigger is observed incident (negative balance in prod), not user count threshold"
  - "Preferred TOCTOU mitigation path is per-user workpool (maxParallelism: 1) over version field"

patterns-established:
  - "IDEMPOTENCY CONTRACT: JSDoc block on each financial webhook handler documenting dedup gate, replay behavior, side effects, verification date"
  - "TOCTOU CONTRACT: JSDoc block on mutation documenting current protection, risk window, trigger criteria, and mitigation path"

requirements-completed: [INFRA-03, INFRA-04]

# Metrics
duration: 2min
completed: 2026-02-27
---

# Phase 03 Plan 02: Financial Idempotency Contracts and TOCTOU Documentation Summary

**Formal IDEMPOTENCY CONTRACT JSDoc on all 6 financial mutation paths plus TOCTOU CONTRACT on deductCredits with race condition analysis and mitigation strategy**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-27T11:22:50Z
- **Completed:** 2026-02-27T11:25:28Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Audited all 4 financial webhook handlers (invoice.paid, payment_intent.succeeded, charge.refunded, checkout.session.completed) and confirmed each is idempotent
- Added IDEMPOTENCY CONTRACT JSDoc blocks on all 4 handlers in http.ts and 2 backing mutations in credits/internal.ts
- Added TOCTOU CONTRACT JSDoc on deductCredits documenting OCC protection, risk window, safety rationale, trigger criteria, and mitigation path

## Task Commits

Each task was committed atomically:

1. **Task 1: Audit and document idempotency contracts for financial webhook handlers** - `7f1d1f8` (docs)
2. **Task 2: Document TOCTOU credit deduction race condition on deductCredits** - `22e40da` (docs)

## Files Created/Modified
- `convex/http.ts` - Added 4 IDEMPOTENCY CONTRACT JSDoc blocks (one per financial webhook handler)
- `convex/credits/internal.ts` - Added 2 IDEMPOTENCY CONTRACT JSDoc blocks (on grantPurchasedCreditsFromPaymentIntent and reversePurchasedCreditsFromRefund) + 1 TOCTOU CONTRACT JSDoc block (on deductCredits)

## Decisions Made
- All 4 financial webhook handlers confirmed idempotent via code audit -- no code changes needed, documentation-only task
- TOCTOU trigger criterion: observed incident (real double-deduction producing negative balance), not a user count threshold
- Preferred TOCTOU mitigation: per-user workpool with maxParallelism: 1 (Option A) over version field (Option B)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All financial handlers now have formal idempotency documentation following the DEDUP CONTRACT pattern from Phase 2
- TOCTOU race condition is fully documented with clear trigger criteria and mitigation path
- Phase 03 operational hardening documentation complete

## Self-Check: PASSED

All files and commits verified.

---
*Phase: 03-operational-hardening*
*Completed: 2026-02-27*
