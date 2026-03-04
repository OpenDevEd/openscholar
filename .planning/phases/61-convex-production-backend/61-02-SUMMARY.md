---
phase: 61-convex-production-backend
plan: 02
subsystem: payments
tags: [typescript, stripe, type-safety, convex, billing]

requires:
  - phase: 60-convex-validators-typed-records
    provides: Typed validators and Doc<"users"> pattern for user queries
provides:
  - Zero any annotations in billing backend files (subscriptions, credits, webhook handlers)
  - ProcessInvoiceForGrantArgs and ReconcileRecentPaidInvoicesArgs typed interfaces
  - Concrete ActionCtx type in webhook handler utilities
affects: [63-convex-stripe-actions, 64-convex-webhook-handlers]

tech-stack:
  added: []
  patterns: [inferred-user-type-from-convex-query, typed-helper-function-interfaces, concrete-action-context]

key-files:
  created: []
  modified:
    - convex/subscriptions/actions.ts
    - convex/credits/actions.ts
    - convex/lib/stripeWebhookHandlers.ts

key-decisions:
  - "Removed : any from user variables instead of explicit Doc<users> -- Convex infers return type from query validators"
  - "Used error: unknown with existing type guards -- instanceof checks work correctly with unknown type"
  - "Imported ActionCtx from _generated/server instead of GenericActionCtx<DataModel> from convex/server"

patterns-established:
  - "Inferred user type: Let Convex infer Doc<users> from ctx.runQuery with typed returns validators"
  - "Helper function arg interfaces: Mirror action validator shapes in TypeScript interfaces"

requirements-completed: [CONV-03]

duration: 3min
completed: 2026-03-04
---

# Phase 61 Plan 02: Billing Backend Type Safety Summary

**Eliminated all 14 any annotations across 3 billing files using inferred types, unknown catches, typed interfaces, and concrete ActionCtx**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-04T11:15:26Z
- **Completed:** 2026-03-04T11:19:02Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Removed all 8 any annotations in subscriptions/actions.ts (5 user vars, 2 error catches, 1 as-any cast)
- Removed all 3 any annotations in credits/actions.ts (1 user var, 2 helper function args with new interfaces)
- Replaced all 3 GenericActionCtx<any> in stripeWebhookHandlers.ts with concrete ActionCtx type
- All 780 tests pass, zero new TypeScript errors in target files

## Task Commits

Each task was committed atomically:

1. **Task 1: Type subscriptions/actions.ts user variables and error catches** - `239c2ae` (feat)
2. **Task 2: Type credits/actions.ts user variable and helper function args** - `af752e7` (feat)
3. **Task 3: Replace GenericActionCtx<any> with ActionCtx in stripeWebhookHandlers.ts** - `0c10559` (feat)

## Files Created/Modified
- `convex/subscriptions/actions.ts` - Removed 5 user : any, 2 error : any -> unknown, 1 as any -> direct property access
- `convex/credits/actions.ts` - Removed 1 user : any, added ProcessInvoiceForGrantArgs and ReconcileRecentPaidInvoicesArgs interfaces
- `convex/lib/stripeWebhookHandlers.ts` - Replaced GenericActionCtx<any> import/usage with ActionCtx from _generated/server

## Decisions Made
- Removed `: any` from user variables and let Convex infer the return type from the query's `returns` validator, rather than explicitly annotating with `Doc<"users">`. This is simpler and stays in sync automatically.
- Used `error: unknown` with existing `instanceof` type guards. The `mapSubscriptionDetailsErrorCode` function already accepted `unknown`, and `instanceof` checks work correctly to narrow `unknown` types.
- Accessed `error.decline_code` directly after `instanceof Stripe.errors.StripeCardError` check, since `decline_code` is a `readonly string` property on `StripeCardError` in the installed Stripe SDK.
- Imported `ActionCtx` from `../_generated/server` (which is `GenericActionCtx<DataModel>`) rather than constructing it from `GenericActionCtx` + `DataModel` imports.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All billing backend files (subscriptions, credits, webhook handlers) are fully typed
- Ready for remaining production backend type safety work in subsequent phases
- Pre-existing TS errors in other files (audit module, crons) are out of scope for this plan

## Self-Check: PASSED

- 61-02-SUMMARY.md: FOUND
- Commit 239c2ae: FOUND
- Commit af752e7: FOUND
- Commit 0c10559: FOUND
- any annotations in target files: 0

---
*Phase: 61-convex-production-backend*
*Completed: 2026-03-04*
