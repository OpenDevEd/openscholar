---
phase: 13-ci-env-hardening-cred02-regression
plan: 01
subsystem: infra, testing
tags: ci, github-actions, playwright, stripe, credits, regression

# Dependency graph
requires:
  - phase: 12-billing-e2e-ci-wiring
    provides: billing E2E CI job structure and npm scripts
provides:
  - Explicit CLERK_PUBLISHABLE_KEY in all three billing CI job env blocks
  - Dedicated CRED-02 regression test with exact credit balance assertions
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Exact toBe() assertions for regression tests (vs >= for functional tests)"

key-files:
  created:
    - e2e/billing/specs/credit-grants.spec.ts
  modified:
    - .github/workflows/ci.yml
    - .github/workflows/billing-nightly.yml

key-decisions:
  - "Use toBe() exact match in credit-grants.spec.ts, not toBeGreaterThanOrEqual() -- regression tests must catch any drift"
  - "Credit-only focus in CRED-02 tests -- no plan name, status badge, or pricing page assertions (those are SUB-01/SUB-02)"

patterns-established:
  - "Regression tests use exact assertions; functional tests use >= thresholds"

requirements-completed: [INFRA-02, CRED-02]

# Metrics
duration: 1min
completed: 2026-02-28
---

# Phase 13 Plan 01: CI Env Hardening & CRED-02 Regression Test Summary

**Explicit CLERK_PUBLISHABLE_KEY in all billing CI jobs + dedicated credit-grants.spec.ts with exact toBe(5,000) and toBe(17,000) regression assertions**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-28T09:17:51Z
- **Completed:** 2026-02-28T09:19:07Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added explicit `CLERK_PUBLISHABLE_KEY` to billing-live, billing-live-extended, and billing-live-extended-nightly CI env blocks
- Created dedicated CRED-02 regression test with exact credit balance assertions for Go (5,000) and Pro (17,000) plans
- Eliminated CI env fragility by removing dependency on normalizer fallback in playwright.config.ts and global.setup.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Add explicit CLERK_PUBLISHABLE_KEY to billing CI env blocks** - `ae7abef` (feat)
2. **Task 2: Create dedicated CRED-02 monthly credit grants regression test** - `98268a8` (feat)

## Files Created/Modified
- `e2e/billing/specs/credit-grants.spec.ts` - CRED-02 regression test with Go and Pro exact credit assertions
- `.github/workflows/ci.yml` - Added CLERK_PUBLISHABLE_KEY to billing-live and billing-live-extended env blocks
- `.github/workflows/billing-nightly.yml` - Added CLERK_PUBLISHABLE_KEY to billing-live-extended-nightly env block

## Decisions Made
- Used `toBe()` exact match instead of `toBeGreaterThanOrEqual()` for credit regression assertions -- any drift must be caught immediately
- Focused CRED-02 tests exclusively on credit balance -- no plan name, status badge, or pricing page assertions (those are SUB-01/SUB-02 concerns in subscribe.spec.ts)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 13 is the last planned phase -- milestone complete
- All CI env hardening and CRED-02 regression coverage in place

## Self-Check: PASSED

---
*Phase: 13-ci-env-hardening-cred02-regression*
*Completed: 2026-02-28*
