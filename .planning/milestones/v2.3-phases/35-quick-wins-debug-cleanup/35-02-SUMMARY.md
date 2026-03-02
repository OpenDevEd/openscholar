---
phase: 35-quick-wins-debug-cleanup
plan: 02
subsystem: payments
tags: [stripe, env-validation, security, lazy-init]

# Dependency graph
requires: []
provides:
  - Lazy getStripe() singleton pattern replacing unsafe "dummy" key fallback
  - Shared requireAppUrl() utility with dev/CI fallback for NEXT_PUBLIC_APP_URL validation
  - Hardened Stripe initialization across all three action files
affects: [subscriptions, credits, maintenance, http-routing]

# Tech tracking
tech-stack:
  added: []
  patterns: [lazy-singleton-stripe-init, function-entry-env-validation]

key-files:
  created:
    - convex/lib/env.ts
  modified:
    - convex/subscriptions/actions.ts
    - convex/credits/actions.ts
    - convex/maintenance/internal.ts
    - convex/http.ts
    - convex/_generated/api.d.ts

key-decisions:
  - "Used lazy singleton pattern for Stripe client to defer initialization to first use, avoiding module-load failures"
  - "Preserved dev/CI localhost fallback via CONVEX_CLOUD_URL and NODE_ENV checks in requireAppUrl()"

patterns-established:
  - "Lazy getStripe(): Never instantiate Stripe at module scope; use getStripe() singleton that throws on missing key"
  - "requireAppUrl(): Validate NEXT_PUBLIC_APP_URL at function entry with dev-mode fallback, not module scope"

requirements-completed: [SEC-02, SEC-03]

# Metrics
duration: 4min
completed: 2026-03-02
---

# Phase 35 Plan 02: Stripe Env Hardening Summary

**Lazy getStripe() singleton replacing "dummy" key fallback in 3 files, plus shared requireAppUrl() validation utility with dev/CI localhost fallback**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-02T06:53:45Z
- **Completed:** 2026-03-02T06:58:00Z
- **Tasks:** 1
- **Files modified:** 6

## Accomplishments
- Eliminated all "dummy" Stripe secret key fallbacks across subscriptions/actions, credits/actions, and maintenance/internal (SEC-02)
- Created shared `convex/lib/env.ts` with `requireAppUrl()` that validates NEXT_PUBLIC_APP_URL at function entry, throws in production when missing, and falls back to localhost in dev/CI (SEC-03)
- Replaced module-scope DOMAIN/FRONTEND_URL constants in subscriptions/actions, credits/actions, and http.ts with handler-scoped `requireAppUrl()` calls
- All changes pass `npx convex typecheck` with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared env utility and apply Stripe lazy init + URL validation** - `eb3ad28` (feat)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified
- `convex/lib/env.ts` - Shared requireAppUrl() utility with dev/CI fallback
- `convex/subscriptions/actions.ts` - Lazy getStripe() singleton, requireAppUrl() in createCheckoutSession and createPortalSession
- `convex/credits/actions.ts` - Lazy getStripe() singleton, requireAppUrl() in createTopupCheckoutSession
- `convex/maintenance/internal.ts` - Lazy getStripe() singleton
- `convex/http.ts` - requireAppUrl() in Zotero OAuth callback handler
- `convex/_generated/api.d.ts` - Auto-generated type registration for new env.ts module

## Decisions Made
- Used lazy singleton pattern for Stripe client to defer initialization to first use, avoiding module-load failures when STRIPE_SECRET_KEY is unset for non-Stripe functions
- Preserved dev/CI localhost fallback via CONVEX_CLOUD_URL localhost check and NODE_ENV=development check in requireAppUrl(), ensuring local development and CI environments are not broken

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Stripe env hardening complete, all three Stripe action files use lazy init
- URL validation utility available for any future files that reference NEXT_PUBLIC_APP_URL
- Ready for 35-03 plan execution

## Self-Check: PASSED

All 6 created/modified files verified on disk. Commit eb3ad28 verified in git log.

---
*Phase: 35-quick-wins-debug-cleanup*
*Completed: 2026-03-02*
