---
phase: 48-billing-hardening
plan: 01
subsystem: payments
tags: [stripe, typescript, type-safety, webhooks, billing]

# Dependency graph
requires:
  - phase: 47-test-safety-net
    provides: Stripe webhook handler tests and plan-config tests (TEST-01, TEST-03)
provides:
  - Type-safe Stripe webhook event handlers with zero as-any casts
  - Safe getPlanFromPriceId without substring fallback (returns "free" + console.warn for unknown IDs)
affects: [48-billing-hardening, subscriptions, credits]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FunctionReference<'mutation'|'action', 'internal'> for typed Convex function refs in utility files"
    - "Type narrowing for Stripe union types (string | Object) via typeof checks"

key-files:
  created: []
  modified:
    - convex/http.ts
    - convex/lib/stripeWebhookHandlers.ts
    - convex/subscriptions/actions.ts
    - convex/lib/constants.ts
    - tests/plan-config.test.ts

key-decisions:
  - "Kept GenericActionCtx<any> in stripeWebhookHandlers.ts -- DataModel generic unavailable in utility files"
  - "Kept schedule as unknown as ScheduleLike casts -- intentional narrowing to project-defined type"
  - "Left user: any and error: any casts in actions.ts -- out of scope for TYPE-01 (Stripe object casts only)"

patterns-established:
  - "Stripe webhook event.data.object cast to specific Stripe SDK type (Invoice, Subscription, etc.)"
  - "FunctionReference typing for cross-module Convex function references"

requirements-completed: [TYPE-01, BILL-01]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Phase 48 Plan 01: Billing Type Safety Summary

**Typed Stripe SDK objects in webhook handlers (zero as-any casts) and removed dangerous substring-based plan resolution from getPlanFromPriceId**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T07:58:25Z
- **Completed:** 2026-03-03T08:02:11Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Replaced all `as any` casts in Stripe webhook handlers (http.ts, stripeWebhookHandlers.ts, actions.ts) with proper Stripe SDK types (Stripe.Invoice, Stripe.Subscription, Stripe.Checkout.Session, FunctionReference)
- Removed dangerous substring-based plan resolution (`includes("enterprise")`, `includes("pro")`) from getPlanFromPriceId -- unknown IDs now safely return "free" with console.warn
- Updated test suite to verify post-BILL-01 behavior with console.warn spy assertions
- All 45 tests pass across both test files

## Task Commits

Each task was committed atomically:

1. **Task 1: Type-safe Stripe webhook handlers and utilities (TYPE-01)** - `2be3138` (feat)
2. **Task 2: Remove getPlanFromPriceId substring fallback (BILL-01)** - `5d025bf` (fix)

## Files Created/Modified
- `convex/http.ts` - Replaced 5 `as any` casts with Stripe.Invoice and Stripe.Subscription types in webhook event handlers
- `convex/lib/stripeWebhookHandlers.ts` - Added FunctionReference import; typed markStripeEventFailed, markStripeEventProcessed, processInvoiceForGrant, markStripeEventRetrying parameters; typed invoice as Stripe.Invoice
- `convex/subscriptions/actions.ts` - Typed getStripeCustomerId, getAttachedSchedule, syncLocalSubscriptionFromStripe with Stripe.Subscription; removed as-any casts in getSubscriptionDetails and getUpgradePreview
- `convex/lib/constants.ts` - Removed substring fallback lines; added console.warn for unknown price IDs
- `tests/plan-config.test.ts` - Updated substring fallback tests to expect "free"; added console.warn spy assertions; renamed describe block to reflect BILL-01

## Decisions Made
- Kept `GenericActionCtx<any>` in stripeWebhookHandlers.ts since the DataModel generic is unavailable in utility files -- this is an acceptable use of any for cross-module Convex context types
- Kept `schedule as unknown as ScheduleLike` casts in actions.ts -- these are intentional narrowing to a project-defined type, not untyped any
- Left `user: any` and `error: any` casts in actions.ts untouched -- these are not Stripe object casts and are out of scope for TYPE-01
- Left `(error as any).decline_code` in StripeCardError handler -- accessing a Stripe-specific property not on the base type

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TYPE-01 and BILL-01 requirements satisfied
- All Stripe webhook handlers now use typed SDK objects for compile-time safety
- Safe fallback behavior for unknown price IDs prevents silent plan misassignment
- Ready for 48-02 (remaining billing hardening tasks)

## Self-Check: PASSED

All files found. All commits verified (2be3138, 5d025bf).

---
*Phase: 48-billing-hardening*
*Completed: 2026-03-03*
