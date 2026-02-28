---
phase: 08-subscription-and-upgrade-specs
plan: 01
subsystem: testing
tags: [playwright, e2e, stripe, subscription, billing]

# Dependency graph
requires:
  - phase: 07-test-infrastructure-foundation
    provides: billing fixtures, page objects, stripe-helpers, webhook-waiter
provides:
  - Subscribe E2E spec with Go and Pro subscription tests
  - Public userId getter on WebhookWaiter
affects: [08-02, 09-subscription-and-upgrade-specs]

# Tech tracking
tech-stack:
  added: []
  patterns: [checkout-bypass subscription testing, webhook-waiter polling before UI assertions]

key-files:
  created:
    - e2e/billing/specs/subscribe.spec.ts
  modified:
    - e2e/billing/webhook-waiter.ts

key-decisions:
  - "Each test is independent with its own fresh Clerk user for full isolation"
  - "Credit assertions use >= because free signup credits (2,000) are always present"
  - "Cleanup Stripe objects at end of each test to prevent sandbox pollution"

patterns-established:
  - "Subscribe spec pattern: checkout-bypass -> waitForSubscriptionPlan -> waitForCreditBalance -> billing page assertions -> pricing page badge check -> cleanup"

requirements-completed: [SUB-01, SUB-02, CRED-02]

# Metrics
duration: 1min
completed: 2026-02-28
---

# Phase 08 Plan 01: Subscribe Spec Summary

**E2E subscribe spec with Go (5,000 credits) and Pro (17,000 credits) tests using checkout-bypass pattern and webhook-waiter polling**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-28T06:40:16Z
- **Completed:** 2026-02-28T06:41:32Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added public `userId` getter to WebhookWaiter enabling clean access from spec files
- Created subscribe.spec.ts with two independent tests covering Go and Pro subscription flows
- Each test verifies full flow: Stripe checkout-bypass, webhook processing, billing page assertions (plan name, active status, credit balance), and pricing page Current Plan badge

## Task Commits

Each task was committed atomically:

1. **Task 1: Add public userId getter to WebhookWaiter** - `cfe549b` (feat)
2. **Task 2: Create subscribe.spec.ts with Go and Pro tests** - `8237108` (feat)

## Files Created/Modified
- `e2e/billing/specs/subscribe.spec.ts` - Subscribe E2E spec with Go and Pro subscription tests (85 lines)
- `e2e/billing/webhook-waiter.ts` - Added public `get userId()` getter returning private convexUserId

## Decisions Made
- Each test is independent with its own fresh Clerk user for full isolation
- Credit assertions use `>=` because free signup credits (2,000) are always present
- Both tests clean up Stripe objects via `cleanupStripeCustomer` to prevent sandbox pollution
- Used `process.env.STRIPE_GO_PRICE_ID!` and `process.env.STRIPE_PRO_PRICE_ID!` for price IDs

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. Environment variables STRIPE_GO_PRICE_ID and STRIPE_PRO_PRICE_ID must already be set (part of existing Stripe sandbox config).

## Next Phase Readiness
- Subscribe spec complete, provides the foundation pattern for Plan 08-02 (upgrade/downgrade tests)
- The checkout-bypass + webhook-waiter + page assertion pattern is established and reusable

## Self-Check: PASSED

- FOUND: e2e/billing/specs/subscribe.spec.ts
- FOUND: commit cfe549b (Task 1)
- FOUND: commit 8237108 (Task 2)
- FOUND: 08-01-SUMMARY.md

---
*Phase: 08-subscription-and-upgrade-specs*
*Completed: 2026-02-28*
