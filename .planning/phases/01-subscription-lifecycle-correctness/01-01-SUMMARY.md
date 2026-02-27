---
phase: 01-subscription-lifecycle-correctness
plan: 01
subsystem: payments
tags: [stripe, webhooks, subscriptions, convex, billing]

# Dependency graph
requires: []
provides:
  - Webhook handlers that re-fetch from Stripe API on every customer.subscription.* event
  - In-place cancellation handler preserving stripeSubscriptionId for audit trail
  - Divergence logging for Phase 3 monitoring groundwork
affects: [01-subscription-lifecycle-correctness, 03-operational-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Webhook re-fetch pattern: always call stripe.subscriptions.retrieve() before syncing, never trust event payload"
    - "In-place cancellation: update existing record instead of creating orphan free-plan records"
    - "Internal action delegation: http.ts delegates to Node.js internalAction for Stripe API calls"

key-files:
  created: []
  modified:
    - convex/http.ts
    - convex/subscriptions/actions.ts
    - convex/subscriptions/internal.ts
    - convex/subscriptions/lib/selectCanonicalSubscription.ts

key-decisions:
  - "Used internalAction in actions.ts instead of direct Stripe client in http.ts because http.ts runs in Convex JS runtime (not Node.js) and cannot use the stripe npm package"
  - "Reused existing syncLocalSubscriptionFromStripe helper in handleSubscriptionWebhook for consistency with the rest of the codebase"

patterns-established:
  - "Webhook re-fetch: all customer.subscription.* handlers re-fetch from Stripe API before syncing to local DB"
  - "Audit trail preservation: canceled subscription records retain stripeSubscriptionId"

requirements-completed: [SUB-02, SUB-03, SUB-04]

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 1 Plan 1: Webhook Re-fetch and Cancellation In-place Fix Summary

**Webhook handlers re-fetch from Stripe API on every subscription event; cancellation updates in-place preserving stripeSubscriptionId for audit trail**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T09:46:34Z
- **Completed:** 2026-02-27T09:50:05Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Webhook handlers for customer.subscription.created and customer.subscription.updated now re-fetch subscription state from Stripe API before syncing, preventing out-of-order event payload corruption
- Cancellation handler updates the subscription record in-place with plan: "free" and status: "canceled" instead of creating orphan free-plan records
- stripeSubscriptionId preserved on canceled records for audit trail (was previously cleared to undefined)
- Divergence logging added when event payload disagrees with re-fetched Stripe state (groundwork for Phase 3 monitoring)

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor webhook handlers to re-fetch from Stripe API** - `b8889e5` (feat)
2. **Task 2: Fix cancellation handler and update selectCanonicalSubscription** - `2294097` (fix)

**Plan metadata:** `0583209` (docs: complete plan)

## Files Created/Modified
- `convex/http.ts` - Replaced inline sync logic in subscription webhook handlers with calls to handleSubscriptionWebhook internalAction; removed unused imports
- `convex/subscriptions/actions.ts` - Added handleSubscriptionWebhook internalAction that re-fetches from Stripe API with divergence logging; added internalAction import
- `convex/subscriptions/internal.ts` - Fixed handleSubscriptionCanceled to update in-place with plan: "free", creditsPerMonth: 0; removed orphan record insertion and stripeSubscriptionId clearing
- `convex/subscriptions/lib/selectCanonicalSubscription.ts` - Updated documentation for post-SUB-03 data shape where canceled records retain stripeSubscriptionId

## Decisions Made
- Used internalAction in actions.ts instead of direct Stripe client in http.ts because http.ts runs in Convex JS runtime (not Node.js) and cannot use the stripe npm package. The plan assumed http.ts could use Stripe directly, but this was adapted using Deviation Rule 3 (blocking issue).
- Reused existing syncLocalSubscriptionFromStripe helper inside handleSubscriptionWebhook rather than duplicating the sync logic, ensuring consistency with how other parts of the codebase (changePlan, etc.) sync subscription state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adapted Stripe re-fetch to use internalAction instead of direct client in http.ts**
- **Found during:** Task 1 (Refactor webhook handlers)
- **Issue:** Plan specified creating a Stripe client and handleSubscriptionWebhook helper directly in http.ts, but http.ts runs in Convex's JS runtime (not Node.js) and cannot use the stripe npm package
- **Fix:** Created handleSubscriptionWebhook as an internalAction in actions.ts (which has "use node" directive and existing Stripe client), then called it from http.ts via ctx.runAction()
- **Files modified:** convex/subscriptions/actions.ts, convex/http.ts
- **Verification:** TypeScript compiles without errors; pattern matches existing ctx.runAction() usage in http.ts
- **Committed in:** b8889e5 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Architectural adaptation required by Convex runtime constraints. Same functional outcome (Stripe re-fetch on every event), different execution path (internalAction vs. inline). No scope creep.

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SUB-02, SUB-03, and SUB-04 are now fixed
- selectCanonicalSubscription correctly handles post-fix data shape
- Ready for Plan 02 (proration and upgrade improvements) and Plan 03 (schema additions)
- Phase 3 monitoring can build on the divergence logging added here

## Self-Check: PASSED

All files exist. All commits verified.

---
*Phase: 01-subscription-lifecycle-correctness*
*Completed: 2026-02-27*
