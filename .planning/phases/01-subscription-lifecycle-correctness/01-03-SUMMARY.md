---
phase: 01-subscription-lifecycle-correctness
plan: 03
subsystem: payments
tags: [stripe, subscriptions, past_due, grace-period, billing-ui, cron, convex]

# Dependency graph
requires:
  - phase: 01-subscription-lifecycle-correctness
    provides: webhook re-fetch pattern (Plan 01), syncSubscription handler (Plan 01)
provides:
  - pastDueSince field for grace period tracking on subscriptions table
  - handlePaymentFailed sets pastDueSince only on first past_due transition
  - syncSubscription clears pastDueSince when subscription recovers
  - checkSubscriptionStatus cron auto-downgrades after 7-day grace period
  - Payment failure banner on billing page with Stripe portal link
affects: [03-operational-hardening, ui-billing-upgrade-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Grace period tracking: pastDueSince set on first past_due transition, never overwritten on subsequent failures"
    - "Cron auto-downgrade: checkSubscriptionStatus checks pastDueSince + 7 days and downgrades to free plan"
    - "Payment failure UX: persistent red banner with Stripe portal link, all features remain accessible"

key-files:
  created: []
  modified:
    - convex/schema.ts
    - convex/lib/validators.ts
    - convex/subscriptions/internal.ts
    - convex/maintenance/internal.ts
    - app/settings/billing/page.tsx
    - messages/en-US.json
    - messages/en-GB.json
    - messages/zh.json
    - messages/fr.json
    - messages/ja.json
    - messages/hi.json

key-decisions:
  - "pastDueSince set only on first past_due transition to avoid resetting grace period on repeated payment failures"
  - "Grace period is 7 days per locked decision; after expiry, subscription auto-downgrades to free plan with canceled status"
  - "Payment failure banner uses red styling (bg-red-500/10) to distinguish from amber grace period banner"
  - "All features remain accessible during past_due grace period per locked decision"

patterns-established:
  - "Grace period tracking: use pastDueSince timestamp + GRACE_PERIOD_MS constant for expiry calculation"
  - "Recovery clearing: syncSubscription clears pastDueSince when status transitions away from past_due"

requirements-completed: [SUB-06]

# Metrics
duration: 4min
completed: 2026-02-27
---

# Phase 1 Plan 3: Payment Failure UX and Grace Period Summary

**pastDueSince tracking with 7-day grace period auto-downgrade cron and persistent red payment failure banner linking to Stripe portal**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-27T10:00:00Z
- **Completed:** 2026-02-27T10:04:38Z
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 11

## Accomplishments
- Added `pastDueSince` field to subscriptions schema and validator for grace period tracking
- `handlePaymentFailed` sets `pastDueSince` only on first `past_due` transition, preventing grace period reset on repeated failures
- `syncSubscription` clears `pastDueSince` when subscription recovers (status transitions away from `past_due`)
- `checkSubscriptionStatus` cron enhanced to auto-downgrade subscriptions after 7-day grace period expires
- Persistent red payment failure banner on billing page with "Update payment method" button linking to Stripe customer portal
- All features remain accessible during grace period (no access restrictions)
- Translation keys added for all 6 supported locales

## Task Commits

Each task was committed atomically:

1. **Task 1: Add pastDueSince field and enhance payment failure handling + grace period cron** - `f3cefc6` (feat)
2. **Task 2: Add payment failure banner to billing page** - `1bb781b` (feat)
3. **Task 3: Verify payment failure banner appearance** - checkpoint:human-verify (approved, no commit)

## Files Created/Modified
- `convex/schema.ts` - Added `pastDueSince: v.optional(v.number())` to subscriptions table
- `convex/lib/validators.ts` - Added `pastDueSince` to subscriptionValidator
- `convex/subscriptions/internal.ts` - handlePaymentFailed sets pastDueSince on first transition; syncSubscription clears it on recovery
- `convex/maintenance/internal.ts` - checkSubscriptionStatus enhanced with 7-day grace period auto-downgrade logic
- `app/settings/billing/page.tsx` - Red payment failure banner with "Update payment method" button for past_due status
- `messages/en-US.json` - Added paymentFailedNotice and updatePaymentMethod translation keys
- `messages/en-GB.json` - Added paymentFailedNotice and updatePaymentMethod translation keys
- `messages/zh.json` - Added paymentFailedNotice and updatePaymentMethod translation keys
- `messages/fr.json` - Added paymentFailedNotice and updatePaymentMethod translation keys
- `messages/ja.json` - Added paymentFailedNotice and updatePaymentMethod translation keys
- `messages/hi.json` - Added paymentFailedNotice and updatePaymentMethod translation keys

## Decisions Made
- `pastDueSince` is set only on the first `past_due` transition (not overwritten on subsequent payment failure events) to prevent resetting the grace period clock
- Grace period is 7 days (GRACE_PERIOD_MS constant) per locked business decision
- Auto-downgrade sets plan to "free" and status to "canceled" with `creditsPerMonth: 0` and clears `pastDueSince`
- Payment failure banner uses red styling (`bg-red-500/10`) to visually distinguish from the amber grace period banner used for other statuses
- All features remain fully accessible during `past_due` grace period per locked decision (no access gating)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Phase 1 requirements (SUB-01 through SUB-06) are now complete
- Subscription lifecycle correctness is fully addressed: webhook re-fetch, cancellation in-place, proration charging, schedule verification, and payment failure handling
- Phase 2 (Credit System Correctness) can proceed -- subscription state is now trustworthy for credit logic
- Phase 3 (Operational Hardening) can build on the divergence logging (Plan 01) and corrective cron infrastructure (Plan 03)

## Self-Check: PASSED

All files exist. All commits verified.

---
*Phase: 01-subscription-lifecycle-correctness*
*Completed: 2026-02-27*
