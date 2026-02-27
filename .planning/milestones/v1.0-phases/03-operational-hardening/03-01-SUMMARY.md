---
phase: 03-operational-hardening
plan: 01
subsystem: infra
tags: [stripe, cron, subscription-sync, monitoring, convex]

# Dependency graph
requires:
  - phase: 01-subscription-billing-correctness
    provides: syncSubscription mutation, normalizeStripeSubscriptionStatus, isSubscriptionScheduledToCancel
provides:
  - Corrective subscription sync internalAction (checkSubscriptionStatus) that auto-corrects divergences from Stripe
  - Failed Stripe event monitoring internalMutation (monitorFailedStripeEvents) with console.error alerting
  - listActiveSubscriptions internalQuery for cron consumption
  - expirePastDueSubscriptions internalMutation extracted from checkSubscriptionStatus
affects: [03-02-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [corrective-sync-cron, flag-only-monitoring, action-mutation-split]

key-files:
  created: []
  modified:
    - convex/maintenance/internal.ts
    - convex/subscriptions/internal.ts
    - convex/crons.ts

key-decisions:
  - "checkSubscriptionStatus converted from internalMutation to internalAction to enable Stripe API re-fetch for corrective sync"
  - "Past-due grace period logic extracted to separate expirePastDueSubscriptions mutation (OCC-safe DB writes vs action for Stripe API)"
  - "Stripe subscription typed as any to access current_period_end/start properties not in 2026-01-28.clover type definitions"

patterns-established:
  - "Action-mutation split: Stripe API calls in internalAction, DB writes delegated to mutations via ctx.runMutation"
  - "Flag-only monitoring: monitorFailedStripeEvents uses console.error for Convex dashboard visibility without auto-retry"

requirements-completed: [INFRA-01, INFRA-02]

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 3 Plan 1: Corrective Subscription Sync and Failed Event Monitoring Summary

**Hourly corrective sync cron re-fetching Stripe subscriptions to auto-correct divergences, plus failed event monitoring with console.error alerting**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T11:22:48Z
- **Completed:** 2026-02-27T11:26:29Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Converted checkSubscriptionStatus from passive log-warning mutation to active corrective-sync internalAction that re-fetches from Stripe API and auto-corrects divergences
- Added monitorFailedStripeEvents to flag stale failed Stripe events (>1 hour) via console.error for dashboard visibility
- Updated cron intervals from 24h to 1h for subscription checks; added new monitoring cron at 1h

## Task Commits

Each task was committed atomically:

1. **Task 1: Convert checkSubscriptionStatus to corrective sync internalAction + add listActiveSubscriptions query** - `e1d7c17` (feat)
2. **Task 2: Add monitorFailedStripeEvents cron + update cron intervals** - `9c08c9c` (feat)

## Files Created/Modified
- `convex/maintenance/internal.ts` - Added "use node" directive, Stripe imports, converted checkSubscriptionStatus to internalAction with Stripe re-fetch loop, extracted expirePastDueSubscriptions mutation, added monitorFailedStripeEvents mutation
- `convex/subscriptions/internal.ts` - Added listActiveSubscriptions internalQuery returning active subscriptions with stripeSubscriptionId
- `convex/crons.ts` - Changed checkSubscriptionStatus interval from 24h to 1h, registered monitorFailedStripeEvents at 1h interval

## Decisions Made
- Used `any` typing for Stripe subscription response to access `current_period_end`/`current_period_start` properties (consistent with pattern in actions.ts where `syncLocalSubscriptionFromStripe` receives `any`)
- checkSubscriptionStatus calls expirePastDueSubscriptions as its first step rather than a separate cron entry, keeping a single cron for subscription health
- Errors during individual subscription re-fetch are caught and logged rather than failing the entire cron run

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Typed Stripe response as `any` for property access**
- **Found during:** Task 1 (checkSubscriptionStatus conversion)
- **Issue:** `stripe.subscriptions.retrieve()` returns `Response<Subscription>` which lacks `current_period_end`/`current_period_start` in the 2026-01-28.clover Stripe API type definitions
- **Fix:** Cast `fresh` to `any` to match the pattern used in `actions.ts` where the subscription is already typed as `any`
- **Files modified:** convex/maintenance/internal.ts
- **Verification:** `npx convex typecheck` passes
- **Committed in:** e1d7c17 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary for TypeScript compatibility. Consistent with existing codebase pattern.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Corrective sync infrastructure is operational; ready for 03-02 (additional operational hardening)
- All subscription health crons now run hourly instead of daily

---
*Phase: 03-operational-hardening*
*Completed: 2026-02-27*

## Self-Check: PASSED

- All 3 modified files exist on disk
- Both task commits verified (e1d7c17, 9c08c9c)
- `npx convex typecheck` passes
