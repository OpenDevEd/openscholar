---
phase: 11-tech-debt-cleanup
plan: 01
subsystem: testing, infra
tags: [playwright, ci, github-actions, typescript, testid]

# Dependency graph
requires:
  - phase: 08-billing-e2e-subscribe-upgrade
    provides: "WebhookWaiter class with userId getter"
  - phase: 10-fix-credits-spec-auth-wiring
    provides: "CRED-05 credit cap banner test requiring credits enabled"
provides:
  - "Clean bracket-notation-free test specs"
  - "Single data-testid for upgrade-total-charge (no duplicate locator risk)"
  - "CI env guard preventing silent CRED-05 failures"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CI env guards for feature flags that affect test correctness"

key-files:
  created: []
  modified:
    - e2e/billing/specs/upgrade.spec.ts
    - components/billing/upgrade-confirmation-dialog.tsx
    - .github/workflows/ci.yml
    - .github/workflows/billing-nightly.yml

key-decisions:
  - "Credits guard checks only for explicit 'false' value -- unset passes (matches runtime feature flag behavior)"

patterns-established:
  - "CI env guard pattern: fail-fast shell conditional in validation step for feature flags"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-02-28
---

# Phase 11 Plan 01: Tech Debt Cleanup Summary

**Fixed bracket notation in upgrade.spec.ts, deduplicated testid in upgrade dialog, added NEXT_PUBLIC_CREDITS_ENABLED CI guards to billing jobs**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-28T08:11:20Z
- **Completed:** 2026-02-28T08:13:05Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Replaced private field bracket notation with public getter in upgrade.spec.ts, aligning with all other spec files
- Refactored upgrade-confirmation-dialog.tsx to render data-testid="upgrade-total-charge" exactly once (was duplicated across ternary branches)
- Added NEXT_PUBLIC_CREDITS_ENABLED env guard to billing-live, billing-live-extended, and billing-nightly CI jobs

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace bracket notation with public getter in upgrade.spec.ts** - `7f8a0a2` (fix)
2. **Task 2: Deduplicate data-testid in upgrade-confirmation-dialog.tsx** - `6c8b964` (fix)
3. **Task 3: Add NEXT_PUBLIC_CREDITS_ENABLED env guard to CI billing jobs** - `2540a4b` (chore)

## Files Created/Modified
- `e2e/billing/specs/upgrade.spec.ts` - Changed webhookWaiter["convexUserId"] to webhookWaiter.userId
- `components/billing/upgrade-confirmation-dialog.tsx` - Refactored ternary to single testid element
- `.github/workflows/ci.yml` - Added credits env guard to billing-live and billing-live-extended jobs
- `.github/workflows/billing-nightly.yml` - Added credits env guard to billing-nightly job

## Decisions Made
- Credits guard checks only for explicit "false" value -- when unset, the guard passes. This matches the runtime behavior where `process.env.NEXT_PUBLIC_CREDITS_ENABLED !== "false"` treats unset as enabled.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All v1.2 milestone tech debt items resolved
- No further phases planned

## Self-Check: PASSED

All 4 modified files verified present. All 3 task commits verified in git log.

---
*Phase: 11-tech-debt-cleanup*
*Completed: 2026-02-28*
