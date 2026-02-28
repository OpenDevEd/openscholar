---
phase: 09-lifecycle-and-credit-specs
plan: 02
subsystem: testing
tags: [playwright, stripe, credits, e2e, paymentintent, pro-rata]

# Dependency graph
requires:
  - phase: 07-billing-e2e-infrastructure
    provides: "billing fixtures, page objects, stripe-helpers, webhook-waiter"
  - phase: 08-subscription-and-upgrade-specs
    provides: "subscribe and upgrade spec patterns, checkout-bypass pattern"
provides:
  - "Credit E2E spec covering free signup, pro-rata upgrade, topup, and cap banner"
  - "createTopupBypass helper for PaymentIntent-based credit purchases"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PaymentIntent checkout-bypass for credit topup (mirrors subscription checkout-bypass)"
    - "Subscription item period fields for Stripe clover API (current_period_start/end moved to items)"

key-files:
  created:
    - e2e/billing/specs/credits.spec.ts
  modified:
    - e2e/billing/stripe-helpers.ts

key-decisions:
  - "Used subscription item period fields (items.data[0]) instead of top-level subscription fields for Stripe clover API compatibility"
  - "Pro-rata credit tolerance set to +-2 to account for timing gap between test calculation and server execution"
  - "Credit topup test subscribes to Go first to establish Stripe customer with payment method"

patterns-established:
  - "PaymentIntent bypass: createTopupBypass helper for credit purchases that bypass Stripe Checkout"
  - "Subscription item access: item.current_period_start/end for Stripe 2026-01-28 clover API"

requirements-completed: [CRED-01, CRED-03, CRED-04, CRED-05]

# Metrics
duration: 3min
completed: 2026-02-28
---

# Phase 09 Plan 02: Credits Spec Summary

**Credit E2E spec with four tests: free signup balance (2,000 exact), Go-to-Pro pro-rata grant (calculated from Stripe timestamps), PaymentIntent topup bypass (10,000 credits), and free credit cap banner visibility**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-28T07:13:38Z
- **Completed:** 2026-02-28T07:16:41Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `createTopupBypass` helper to `stripe-helpers.ts` for PaymentIntent-based credit topup bypass
- Created `credits.spec.ts` with 4 independent credit tests covering CRED-01, CRED-03, CRED-04, CRED-05
- Pro-rata test calculates expected credits from Stripe subscription item period timestamps with +-2 tolerance
- All E2E credit flows now covered: signup grants, upgrade pro-rata, topup purchase, cap banner

## Task Commits

Each task was committed atomically:

1. **Task 1: Add createTopupBypass helper to stripe-helpers.ts** - `0645128` (feat)
2. **Task 2: Create credits.spec.ts with four credit tests** - `5ce66e5` (feat)

## Files Created/Modified
- `e2e/billing/stripe-helpers.ts` - Added `createTopupBypass` function for PaymentIntent-based credit topup bypass
- `e2e/billing/specs/credits.spec.ts` - Four credit E2E tests: free signup, pro-rata upgrade, topup, cap banner

## Decisions Made
- Used `subscription.items.data[0].current_period_start/end` instead of top-level `subscription.current_period_start/end` because the Stripe clover API (2026-01-28) moved period fields to subscription items
- Pro-rata credit assertion uses +-2 tolerance (not +-1) to account for timing gap between test and server calculation
- Credit topup test subscribes to Go first to establish a Stripe customer with a payment method before purchasing credits

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed Stripe API type access for subscription period fields**
- **Found during:** Task 2 (credits.spec.ts creation)
- **Issue:** `subscription.current_period_start` and `subscription.current_period_end` do not exist on `Response<Subscription>` in the Stripe clover API (2026-01-28) -- these fields moved to subscription items
- **Fix:** Changed to `subscription.items.data[0].current_period_start/end` with a null guard
- **Files modified:** e2e/billing/specs/credits.spec.ts
- **Verification:** TypeScript compilation passes with no new errors
- **Committed in:** 5ce66e5 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for TypeScript compilation. No scope creep.

## Issues Encountered
None beyond the Stripe API type issue documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All credit E2E specs complete
- Combined with Phase 08 subscribe/upgrade specs and Phase 09 Plan 01 (lifecycle), the full billing E2E test suite is ready
- 3 pre-existing TypeScript errors in unrelated test files remain (tracked in STATE.md)

---
*Phase: 09-lifecycle-and-credit-specs*
*Completed: 2026-02-28*

## Self-Check: PASSED

- FOUND: e2e/billing/stripe-helpers.ts
- FOUND: e2e/billing/specs/credits.spec.ts
- FOUND: 09-02-SUMMARY.md
- FOUND: commit 0645128
- FOUND: commit 5ce66e5
