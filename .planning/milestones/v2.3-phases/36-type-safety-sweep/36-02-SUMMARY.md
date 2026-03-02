---
phase: 36-type-safety-sweep
plan: 02
subsystem: api
tags: [typescript, convex, type-safety, internal-api, components-api]

# Dependency graph
requires:
  - phase: 36-type-safety-sweep plan 01
    provides: typed ctx parameters in extraction module
provides:
  - Zero `internal as any` casts across all Convex files
  - Zero `components as any` casts across all Convex files
  - Typed ctx parameters in http.ts and credits/actions.ts helper functions
  - All internal function references validated at compile time
  - All component API calls validated at compile time
affects: [37-dead-code-pruning, 38-billing-hardening, 40-extraction-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Import `internal` and `components` directly from _generated/api instead of casting to any"
    - "Use GenericActionCtx<any> for helpers called from Stripe registerRoutes (generic context)"
    - "Add explicit return types when typed internal refs create circular references"

key-files:
  created: []
  modified:
    - convex/http.ts
    - convex/crons.ts
    - convex/credits/actions.ts
    - convex/credits/internal.ts
    - convex/credits/queries.ts
    - convex/subscriptions/actions.ts
    - convex/subscriptions/internal.ts

key-decisions:
  - "Used GenericActionCtx<any> instead of ActionCtx for http.ts helpers because registerRoutes provides GenericActionCtx<GenericDataModel>"
  - "Added explicit return type annotations on processInvoiceForGrantLogic and getUpgradePreview handler to resolve circular reference issues from typed internal refs"
  - "Typed pointer.userId as Id<'users'> instead of string in backfillBillingAndCredits to match typed function signatures"
  - "Cast upgradeFromPlan/upgradeToPlan from metadata as plan union type since Stripe metadata returns strings"
  - "Added empty args {} to crons.interval for reconcileRecentPaidInvoicesFromStripe since typed ref requires args"

patterns-established:
  - "Direct internal/components usage: never cast generated API exports to any"
  - "Circular reference resolution: add explicit return types when internal refs create cycles"

requirements-completed: [TYPE-04, TYPE-05]

# Metrics
duration: 6min
completed: 2026-03-02
---

# Phase 36 Plan 02: Remove as-any API Casts Summary

**Eliminated all `internal as any` and `components as any` casts across 7 Convex files, enabling compile-time validation of ~57 internal function references and component API calls**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-02T07:25:49Z
- **Completed:** 2026-03-02T07:32:15Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Removed 5 `internal as any` casts and replaced ~53 `internalApi.` references with direct typed `internal.`
- Removed 4 `components as any` casts and replaced 4 `componentApi.` references with direct typed `components.`
- Fixed 5 `ctx: any` parameters (3 in http.ts, 2 in credits/actions.ts) with proper typed context
- All 676 tests pass with zero behavior changes; tsc clean (only 3 pre-existing test errors)

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove internal-as-any casts and fix ctx:any in 5 files** - `7809892` (refactor)
2. **Task 2: Remove components-as-any casts in 4 files** - `12f4c5a` (refactor)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified
- `convex/http.ts` - Removed internalApi alias, fixed 3 ctx:any to GenericActionCtx<any>, replaced 13 internalApi refs
- `convex/crons.ts` - Removed internalApi alias, replaced 1 ref, added empty args for typed function
- `convex/credits/actions.ts` - Removed internalApi alias, fixed 2 ctx:any to ActionCtx, added explicit return type, replaced 14 refs
- `convex/credits/internal.ts` - Removed both internalApi and componentApi aliases, replaced 10+1 refs
- `convex/credits/queries.ts` - Removed componentApi alias, replaced 1 ref
- `convex/subscriptions/actions.ts` - Removed both internalApi and componentApi aliases, added explicit return type, replaced 15+1 refs
- `convex/subscriptions/internal.ts` - Removed componentApi alias, replaced 1 ref

## Decisions Made
- Used `GenericActionCtx<any>` for http.ts helper functions instead of the project-specific `ActionCtx` because the Stripe `registerRoutes` callback provides `GenericActionCtx<GenericDataModel>` which is not assignable to the narrower typed `ActionCtx`
- Added explicit return type annotations on `processInvoiceForGrantLogic` and `getUpgradePreview` handler to break circular reference chains caused by switching from untyped `internalApi` to typed `internal`
- Cast `upgradeFromPlan`/`upgradeToPlan` from Stripe metadata as plan union type since metadata values are always strings
- Added empty args `{}` to `crons.interval` call for `reconcileRecentPaidInvoicesFromStripe` -- the typed function reference requires args even when all are optional

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript circular reference errors from typed internal refs**
- **Found during:** Task 1
- **Issue:** Replacing `internalApi` (any) with `internal` (typed) caused TypeScript circular reference detection in `processInvoiceForGrantLogic`, `getUpgradePreview`, and related functions because they reference themselves indirectly via `internal.credits.actions.*`
- **Fix:** Added explicit return type annotations on affected functions to break the circular inference chain
- **Files modified:** convex/credits/actions.ts, convex/subscriptions/actions.ts
- **Verification:** tsc --noEmit produces only 3 pre-existing test errors
- **Committed in:** 7809892 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed GenericActionCtx type mismatch in http.ts**
- **Found during:** Task 1
- **Issue:** Stripe `registerRoutes` passes `GenericActionCtx<GenericDataModel>` not the project-specific `ActionCtx`, causing 12 type errors when helper functions were typed with `ActionCtx`
- **Fix:** Used `GenericActionCtx<any>` from `convex/server` instead of `ActionCtx` for http.ts helpers
- **Files modified:** convex/http.ts
- **Verification:** tsc --noEmit clean
- **Committed in:** 7809892 (Task 1 commit)

**3. [Rule 1 - Bug] Fixed crons.interval missing required args**
- **Found during:** Task 1
- **Issue:** `crons.interval` with typed function ref expects args object even when all params are optional
- **Fix:** Added empty `{}` as fourth argument
- **Files modified:** convex/crons.ts
- **Verification:** tsc --noEmit clean
- **Committed in:** 7809892 (Task 1 commit)

**4. [Rule 1 - Bug] Fixed string-to-Id type mismatch in backfillBillingAndCredits**
- **Found during:** Task 1
- **Issue:** `pointers` variable had `userId: string` type annotation, but typed `upsertBillingCustomerLink` expects `Id<"users">`
- **Fix:** Changed type annotation to `userId: Id<"users">` and imported `Id` type
- **Files modified:** convex/credits/actions.ts
- **Verification:** tsc --noEmit clean
- **Committed in:** 7809892 (Task 1 commit)

---

**Total deviations:** 4 auto-fixed (4 bugs -- all caused by switching from any-typed to properly-typed API references)
**Impact on plan:** All auto-fixes were necessary consequences of the planned type narrowing. No scope creep.

## Issues Encountered
None -- all issues were expected consequences of replacing `any`-typed references with properly typed ones.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All `as any` API casts eliminated from Convex files
- TypeScript now validates all internal function references and component API calls at compile time
- Ready for Phase 37 (dead code pruning) and Phase 38 (billing hardening)

---
*Phase: 36-type-safety-sweep*
*Completed: 2026-03-02*

## Self-Check: PASSED

- All 7 modified files verified on disk
- Commit 7809892 (Task 1) verified in git log
- Commit 12f4c5a (Task 2) verified in git log
