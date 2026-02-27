---
phase: 05-upgrade-resilience
plan: 02
subsystem: payments
tags: [stripe, webhook, proration, upgrade, credits, backup-path]

# Dependency graph
requires:
  - phase: 05-upgrade-resilience
    plan: 01
    provides: "Upgrade context metadata (upgradeFromPlan, upgradeToPlan, upgradeTimestamp) on Stripe subscriptions"
  - phase: 04-upgrade-flow-fix
    provides: "grantUpgradeProRataCredits idempotent mutation in credits/internal.ts"
provides:
  - "Webhook-driven backup path for upgrade pro-rata credit grants via invoice.paid handler"
  - "getSubscriptionByStripeId internal query for resolving userId from stripeSubscriptionId"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Webhook backup path: detect upgrade context in Stripe subscription metadata from invoice handler"
    - "Fresh Stripe API read for period boundaries instead of local DB (avoids stale data race)"

key-files:
  created: []
  modified:
    - convex/credits/actions.ts
    - convex/subscriptions/internal.ts

key-decisions:
  - "Period boundaries read from Stripe API subscription object, not local DB -- webhook may fire before syncSubscription completes"
  - "Non-upgrade subscription_update invoices fall through to existing ignore behavior -- no change to normal flow"

patterns-established:
  - "Upgrade proration detection: check ignore_non_recurring + subscription_update + metadata triplet before falling through"
  - "Internal query for cross-module subscription resolution: getSubscriptionByStripeId enables actions to resolve user context"

requirements-completed: [UPGR-01]

# Metrics
duration: 2min
completed: 2026-02-27
---

# Phase 05 Plan 02: Webhook Backup Path Summary

**Durable webhook-driven backup path for upgrade pro-rata credit grants via invoice.paid handler with Stripe subscription metadata detection**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-27T14:02:24Z
- **Completed:** 2026-02-27T14:04:02Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- processInvoiceForGrantLogic detects upgrade proration invoices (billing_reason=subscription_update + upgrade metadata) and calls grantUpgradeProRataCredits
- getSubscriptionByStripeId internal query enables webhook path to resolve userId from stripeSubscriptionId
- Dual-path convergence works: if action grants credits, webhook gets "already_granted" (noop); if action fails, webhook grants credits

## Task Commits

Each task was committed atomically:

1. **Task 1: Add getSubscriptionByStripeId internal query** - `dd62c8f` (feat)
2. **Task 2: Extend processInvoiceForGrantLogic with upgrade proration detection** - `896bdda` (feat)

## Files Created/Modified
- `convex/subscriptions/internal.ts` - Added getSubscriptionByStripeId internalQuery resolving userId/plan/status from stripeSubscriptionId via by_stripe_sub index
- `convex/credits/actions.ts` - Added upgrade proration detection block in processInvoiceForGrantLogic that reads subscription metadata, resolves user, and calls grantUpgradeProRataCredits

## Decisions Made
- Period boundaries read from fresh Stripe subscription object (not local DB) to avoid stale data when webhook fires before syncSubscription
- Non-upgrade subscription_update invoices preserve existing ignore behavior by falling through the metadata check
- No metadata clearing after processing -- grantUpgradeProRataCredits dedup (by grantType + fromPlan + toPlan + period) prevents re-granting

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Upgrade resilience is complete: both action-path and webhook-path can grant pro-rata credits
- The idempotent grantUpgradeProRataCredits mutation prevents double-grants when both paths succeed
- Stripe billing_reason for proration invoices should be verified in test mode before production deployment

## Self-Check: PASSED

All files found. All commits verified.

---
*Phase: 05-upgrade-resilience*
*Completed: 2026-02-27*
