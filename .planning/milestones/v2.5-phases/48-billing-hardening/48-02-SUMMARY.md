---
phase: 48-billing-hardening
plan: 02
subsystem: payments
tags: [stripe, convex, billing, subscription, plan-change, schema-migration]

# Dependency graph
requires:
  - phase: 48-billing-hardening/01
    provides: Type-safe billing constants and Stripe API helpers
provides:
  - Pending plan change state stored in Convex subscriptions table (BILL-02)
  - setPendingPlanChange and clearPendingPlanChange internal mutations
  - getSubscriptionDetails reads pending state from Convex first
affects: [billing-hardening, credits, subscription-management]

# Tech tracking
tech-stack:
  added: []
  patterns: [convex-as-source-of-truth-for-plan-changes, dual-write-stripe-metadata-backward-compat]

key-files:
  created: []
  modified:
    - convex/schema.ts
    - convex/lib/validators.ts
    - convex/subscriptions/internal.ts
    - convex/subscriptions/actions.ts
    - convex/credits/actions.ts

key-decisions:
  - "Convex subscription record is source of truth for pending plan changes; Stripe metadata preserved for backward compatibility"
  - "getSubscriptionDetails reads Convex first, falls back to Stripe schedule for pre-BILL-02 pending changes"
  - "Upgrade metadata (upgradeFromPlan/upgradeToPlan) still written to Stripe for invoice webhook path compatibility"

patterns-established:
  - "Dual-write pattern: Write to Convex as source of truth, keep Stripe metadata for backward compat"
  - "Fallback read pattern: Read Convex first, fall back to external API for pre-migration data"

requirements-completed: [BILL-02]

# Metrics
duration: 7min
completed: 2026-03-03
---

# Phase 48 Plan 02: Pending Plan Change State Summary

**Pending plan change state (fromPlan, toPlan, timestamp) migrated from Stripe metadata to Convex subscriptions table with dual-write backward compatibility**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-03T08:05:19Z
- **Completed:** 2026-03-03T08:12:25Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added pendingFromPlan, pendingToPlan, pendingChangeTimestamp fields to subscriptions schema (backward-compatible optional fields)
- Created setPendingPlanChange and clearPendingPlanChange internal mutations for atomic state management
- changePlan now writes pending state to Convex on downgrade and clears on upgrade/pending_change_cleared
- getSubscriptionDetails reads from Convex first with Stripe schedule fallback for pre-migration data
- handleSubscriptionCanceled clears pending plan change fields on cancellation

## Task Commits

Each task was committed atomically:

1. **Task 1: Add pending plan change fields to schema and validators** - `eef40cf` (feat)
2. **Task 2: Write/read pending plan change state from Convex** - `7435d85` (feat)

## Files Created/Modified
- `convex/schema.ts` - Added pendingFromPlan, pendingToPlan, pendingChangeTimestamp to subscriptions table
- `convex/lib/validators.ts` - Added matching fields to subscriptionValidator
- `convex/subscriptions/internal.ts` - Added setPendingPlanChange, clearPendingPlanChange mutations; updated handleSubscriptionCanceled
- `convex/subscriptions/actions.ts` - changePlan uses Convex mutations for pending state; getSubscriptionDetails reads Convex first
- `convex/credits/actions.ts` - Added TODO comment for future migration of invoice webhook path

## Decisions Made
- Convex subscription record is source of truth for pending plan changes; Stripe metadata preserved for backward compatibility with external tools and dashboard
- getSubscriptionDetails reads Convex first, falls back to Stripe schedule for pre-BILL-02 pending changes (no migration needed for existing data)
- Upgrade metadata (upgradeFromPlan/upgradeToPlan/upgradeTimestamp) still written to Stripe metadata because processInvoiceForGrant reads it from the Stripe subscription in the invoice webhook path; TODO added for future migration

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 48 complete (all 2 plans executed)
- BILL-02 requirement satisfied: pending plan change state stored in Convex
- Ready for next phase (49) in v2.5 Tech Debt Purge roadmap

## Self-Check: PASSED

All files and commits verified.

---
*Phase: 48-billing-hardening*
*Completed: 2026-03-03*
