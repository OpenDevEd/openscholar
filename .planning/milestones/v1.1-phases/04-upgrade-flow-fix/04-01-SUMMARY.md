---
phase: 04-upgrade-flow-fix
plan: 01
subsystem: payments
tags: [stripe, proration, convex, subscriptions]

# Dependency graph
requires: []
provides:
  - "prorationDate field in getUpgradePreview response for preview-to-execution pinning"
  - "prorationDate optional arg in changePlan for Stripe proration date forwarding"
  - "Non-optional creditsGranted: number in changePlan response (all return paths)"
affects: [04-02, 05-webhook-credit-recovery]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Proration date pinning: capture timestamp at preview, thread through to execution"
    - "Explicit zero pattern: use creditsGranted: 0 instead of undefined for failure/skip paths"

key-files:
  created: []
  modified:
    - "convex/subscriptions/actions.ts"

key-decisions:
  - "prorationDate arg is v.optional() in changePlan for backward compatibility -- existing callers without it still work"
  - "creditsGranted initialized to 0 (not undefined) so catch block assignment is redundant but explicit per research recommendation"

patterns-established:
  - "Proration date pinning: getUpgradePreview returns prorationDate, changePlan accepts and forwards it to Stripe"
  - "Non-optional numeric return fields: use explicit 0 instead of undefined for numeric fields that must always be present"

requirements-completed: [UPGC-01, UPGC-04]

# Metrics
duration: 2min
completed: 2026-02-27
---

# Phase 4 Plan 1: Server-Side Upgrade Contract Fix Summary

**Proration date pinning between preview and execution, plus non-optional creditsGranted return in changePlan for unambiguous client-side branching**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-27T13:21:38Z
- **Completed:** 2026-02-27T13:24:01Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Pinned proration_date between getUpgradePreview and changePlan to eliminate Stripe charge amount drift
- Made creditsGranted a required numeric field (never undefined) in changePlan return type
- All four changePlan return paths (no_change, pending_change_cleared, upgraded_immediately, downgrade_scheduled) now include explicit creditsGranted value

## Task Commits

Each task was committed atomically:

1. **Task 1: Pin proration_date in getUpgradePreview and thread through changePlan** - `01ff259` (fix)
2. **Task 2: Make creditsGranted non-optional in changePlan return** - `94756a2` (fix)

## Files Created/Modified
- `convex/subscriptions/actions.ts` - getUpgradePreview now returns prorationDate; changePlan accepts optional prorationDate arg and forwards to Stripe; creditsGranted changed from optional to required in return type with 0 defaults on all non-upgrade paths

## Decisions Made
- prorationDate arg in changePlan is `v.optional(v.number())` for backward compatibility -- callers that don't pass it get Stripe's default behavior (current time)
- creditsGranted variable initialized to `0` with redundant `creditsGranted = 0` in catch block for explicit intent documentation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Server-side contract is fixed: prorationDate flows from preview to execution, creditsGranted is always a number
- Plan 04-02 can now implement client-side changes: pass prorationDate to changePlan, branch toast on creditsGranted value, update i18n keys
- Phase 5 (webhook credit recovery) can build on the explicit creditsGranted: 0 signal to detect grant failures

## Self-Check: PASSED

All files and commits verified.

---
*Phase: 04-upgrade-flow-fix*
*Completed: 2026-02-27*
