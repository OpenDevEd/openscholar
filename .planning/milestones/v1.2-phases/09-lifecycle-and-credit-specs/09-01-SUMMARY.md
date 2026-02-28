---
phase: 09-lifecycle-and-credit-specs
plan: 01
subsystem: testing
tags: [playwright, stripe, e2e, downgrade, cancel, subscription-lifecycle]

# Dependency graph
requires:
  - phase: 07-billing-e2e-infrastructure
    provides: "Billing fixtures, page objects, stripe-helpers, webhook-waiter"
  - phase: 08-subscription-and-upgrade-specs
    provides: "Subscribe and upgrade spec patterns"
provides:
  - "Downgrade E2E spec with Pro-to-Go downgrade and cancel-downgrade tests"
  - "Cancel subscription E2E spec with Expires on assertion"
affects: [09-lifecycle-and-credit-specs]

# Tech tracking
tech-stack:
  added: []
  patterns: [stripe-api-cancel-bypass, no-dialog-downgrade-flow, re-navigate-for-state-refresh]

key-files:
  created:
    - e2e/billing/specs/downgrade.spec.ts
    - e2e/billing/specs/cancel.spec.ts
  modified: []

key-decisions:
  - "Downgrade triggers no confirmation dialog -- re-navigate after clickSubscribe to see updated state"
  - "Cancel subscription uses Stripe API bypass (cancel_at_period_end) since Customer Portal is a hosted page that cannot be automated"
  - "Assert text patterns only (visibility, /expires on/i, /pro/i) -- no exact dates"

patterns-established:
  - "Stripe API bypass for cancel: stripeClient.subscriptions.update(id, { cancel_at_period_end: true })"
  - "Re-navigate pattern: after state-changing action, call page.goto() again to get fresh server-fetched data"

requirements-completed: [PLAN-02, PLAN-03, CNCL-01]

# Metrics
duration: 2min
completed: 2026-02-28
---

# Phase 09 Plan 01: Downgrade and Cancel Specs Summary

**Pro-to-Go downgrade spec with pending-change banner/scheduled badge assertions and cancel subscription spec with Stripe API bypass**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-28T07:13:43Z
- **Completed:** 2026-02-28T07:15:17Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Downgrade spec with two independent tests covering the full Pro-to-Go lifecycle: schedule downgrade and cancel scheduled downgrade
- Cancel subscription spec using Stripe API bypass to set cancel_at_period_end and assert billing page shows "Expires on"
- All tests use the billing fixture for fresh Clerk users with full isolation
- No exact date assertions -- all checks use visibility or text pattern matching

## Task Commits

Each task was committed atomically:

1. **Task 1: Create downgrade.spec.ts** - `2304553` (feat)
2. **Task 2: Create cancel.spec.ts** - `844669a` (feat)

## Files Created/Modified
- `e2e/billing/specs/downgrade.spec.ts` - Two tests: downgrade shows pending-change banner + scheduled badge; cancel downgrade restores Pro as active plan
- `e2e/billing/specs/cancel.spec.ts` - One test: cancel subscription via Stripe API shows "Expires on" instead of "Renews on"

## Decisions Made
- Downgrade flow has no confirmation dialog (unlike upgrades) -- after clicking Go plan button, re-navigate to see updated state
- Cancel subscription uses `stripeClient.subscriptions.update(id, { cancel_at_period_end: true })` to bypass Stripe Customer Portal (hosted page, not automatable)
- Assert text patterns only (`/expires on/i`, `/pro/i`, visibility checks) -- no exact dates or dollar amounts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Downgrade and cancel lifecycle specs complete
- Ready for 09-02 (credit specs or remaining lifecycle tests)

## Self-Check: PASSED

- FOUND: e2e/billing/specs/downgrade.spec.ts
- FOUND: e2e/billing/specs/cancel.spec.ts
- FOUND: 09-01-SUMMARY.md
- FOUND: 2304553 (Task 1 commit)
- FOUND: 844669a (Task 2 commit)

---
*Phase: 09-lifecycle-and-credit-specs*
*Completed: 2026-02-28*
