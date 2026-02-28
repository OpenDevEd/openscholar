---
phase: 08-subscription-and-upgrade-specs
plan: 02
subsystem: testing
tags: [playwright, e2e, stripe, upgrade, proration, billing]

# Dependency graph
requires:
  - phase: 07-test-infrastructure-foundation
    provides: "Billing fixtures, page objects, stripe helpers, webhook waiter"
  - phase: 08-subscription-and-upgrade-specs
    provides: "specs directory structure (08-01)"
provides:
  - "Upgrade E2E spec covering Go-to-Pro in-app upgrade flow"
  - "Confirmation dialog verification pattern"
  - "Pro-rata credit assertion pattern (> Go-level, not exact)"
affects: [09-downgrade-and-cancellation-specs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Checkout-bypass then in-app upgrade for plan change testing"
    - "Credit balance assertion using > threshold (not exact amount)"

key-files:
  created:
    - e2e/billing/specs/upgrade.spec.ts
  modified: []

key-decisions:
  - "Used bracket notation webhookWaiter['convexUserId'] to access private field, avoiding dependency on 08-01 public getter"
  - "Credit assertion uses > 5000 (greater than Go-level) not exact Pro amount, since pro-rata credits vary with timing"
  - "Dialog verification checks plan names only, not dollar amounts (volatile proration values)"

patterns-established:
  - "Upgrade test pattern: bypass-subscribe to lower plan, then upgrade via UI dialog"
  - "Pro-rata credit assertion: verify credits exceed previous plan level, not exact target amount"

requirements-completed: [PLAN-01, CRED-02]

# Metrics
duration: 2min
completed: 2026-02-28
---

# Phase 08 Plan 02: Upgrade E2E Spec Summary

**Go-to-Pro upgrade E2E spec with checkout-bypass setup, confirmation dialog verification, and pro-rata credit assertion**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-28T06:40:19Z
- **Completed:** 2026-02-28T06:41:55Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Created self-contained upgrade spec that subscribes to Go via checkout-bypass, then upgrades to Pro in-app
- Verifies upgrade confirmation dialog visibility and plan name content (Go and Pro)
- Asserts Pro plan active on billing page, credits > 5000, and Current Plan badge on Pro pricing card
- Full Stripe cleanup after test

## Task Commits

Each task was committed atomically:

1. **Task 1: Create upgrade.spec.ts with Go-to-Pro test** - `ffe44bc` (feat)

## Files Created/Modified
- `e2e/billing/specs/upgrade.spec.ts` - Upgrade E2E spec with one comprehensive Go-to-Pro test (72 lines)

## Decisions Made
- Used bracket notation `webhookWaiter["convexUserId"]` to access private field rather than depending on a public getter from plan 08-01
- Credit assertion uses `> 5_000` threshold (Go-level credits) instead of exact Pro amount, since pro-rata credits vary based on subscription timing
- Dialog verification checks for plan name text (Go/Pro) but does not assert dollar amounts (volatile proration values)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Upgrade spec complete, ready for Phase 9 downgrade/cancellation specs
- Spec follows established patterns from billing test infrastructure (fixtures, page objects, webhook waiter)

## Self-Check: PASSED

- [x] `e2e/billing/specs/upgrade.spec.ts` exists (FOUND)
- [x] Commit `ffe44bc` exists (FOUND)

---
*Phase: 08-subscription-and-upgrade-specs*
*Completed: 2026-02-28*
