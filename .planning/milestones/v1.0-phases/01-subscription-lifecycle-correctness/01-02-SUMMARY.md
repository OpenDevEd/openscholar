---
phase: 01-subscription-lifecycle-correctness
plan: 02
subsystem: payments
tags: [stripe, proration, subscription, invoicing, schedule-release]

# Dependency graph
requires:
  - phase: none
    provides: existing changePlan action and schedule planning helpers
provides:
  - immediate proration invoicing on upgrade via always_invoice
  - card decline blocking via error_if_incomplete and StripeCardError handling
  - post-release schedule verification preventing orphaned schedules
  - getUpgradePreview action for proration amount preview
affects: [01-subscription-lifecycle-correctness, ui-billing-upgrade-flow]

# Tech tracking
tech-stack:
  added: []
  patterns: [always_invoice proration, error_if_incomplete payment behavior, post-release schedule verification, invoices.createPreview for upgrade preview]

key-files:
  created: []
  modified:
    - convex/subscriptions/actions.ts
    - convex/lib/errors.ts

key-decisions:
  - "Used always_invoice + error_if_incomplete together to guarantee immediate charge and block on card decline"
  - "Post-release schedule verification uses stripe.subscriptions.retrieve to check schedule === null rather than relying on release return value"
  - "Added BILLING_CHARGE_FAILED error code to errors.ts for card decline handling"
  - "getUpgradePreview uses invoices.createPreview (not deprecated retrieveUpcoming) matching Stripe API version 2026-01-28.clover"

patterns-established:
  - "Schedule release verification: after releasing a schedule, always re-fetch subscription and assert schedule === null before proceeding"
  - "Proration preview: use invoices.createPreview with matching proration_behavior to show accurate amounts"

requirements-completed: [SUB-01, SUB-05]

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 1 Plan 2: Upgrade Proration & Schedule Verification Summary

**Immediate proration invoicing with always_invoice, card decline blocking via error_if_incomplete, post-release schedule verification, and getUpgradePreview action using invoices.createPreview**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T09:46:34Z
- **Completed:** 2026-02-27T09:49:47Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Upgrades now charge proration immediately via `always_invoice` instead of deferring to next billing cycle
- Card declines during upgrade are caught and return a user-friendly `BILLING_CHARGE_FAILED` error
- Schedule release is verified in both `upgraded_immediately` and `pending_change_cleared` paths, blocking the operation if the schedule remains attached
- New `getUpgradePreview` action provides exact proration preview before user confirms upgrade

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix changePlan to charge proration immediately and verify schedule release** - `dece208` (fix)
2. **Task 2: Add getUpgradePreview action for proration preview** - `b8889e5` (feat, shared commit with parallel 01-01 execution)

## Files Created/Modified
- `convex/subscriptions/actions.ts` - Fixed changePlan with always_invoice, error_if_incomplete, schedule verification; added getUpgradePreview action
- `convex/lib/errors.ts` - Added BILLING_CHARGE_FAILED error code

## Decisions Made
- Used `always_invoice` + `error_if_incomplete` together: `always_invoice` generates and charges the proration invoice immediately, while `error_if_incomplete` causes Stripe to return HTTP 402 if the charge fails, preventing the subscription update
- Post-release schedule verification re-fetches the subscription from Stripe API and checks `schedule === null` rather than trusting the release API response -- defensive approach against Stripe eventual consistency
- Added `BILLING_CHARGE_FAILED` to the ErrorCode union in errors.ts since it did not exist (Rule 3 - blocking issue)
- `getUpgradePreview` uses `invoices.createPreview` (not deprecated `retrieveUpcoming`) since the project is on Stripe API version `2026-01-28.clover` which is past the `2025-03-31.basil` deprecation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added BILLING_CHARGE_FAILED error code to errors.ts**
- **Found during:** Task 1 (changePlan fix)
- **Issue:** The plan referenced `BILLING_CHARGE_FAILED` error code but it did not exist in the ErrorCode type union
- **Fix:** Added `"BILLING_CHARGE_FAILED"` to the ErrorCode union in `convex/lib/errors.ts`
- **Files modified:** convex/lib/errors.ts
- **Verification:** TypeScript compilation passes
- **Committed in:** dece208 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary addition for the new error handling to compile. No scope creep.

## Issues Encountered
- Task 2 commit was absorbed into a parallel 01-01 plan execution commit (b8889e5) due to concurrent file modifications. The code is correctly present and committed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Upgrade proration and schedule verification complete
- UI integration for getUpgradePreview can be built in a future plan
- Plan 01-03 (cancellation orphan prevention) can proceed independently

## Self-Check: PASSED

All files exist, all commits verified, all key code patterns confirmed present.

---
*Phase: 01-subscription-lifecycle-correctness*
*Completed: 2026-02-27*
