---
phase: 12-billing-e2e-ci-wiring
plan: 01
subsystem: testing, infra
tags: [playwright, ci, e2e, billing, github-actions]

# Dependency graph
requires:
  - phase: 07-subscribe-e2e through 09-lifecycle-and-credit-specs
    provides: 9 billing E2E spec files in e2e/billing/
provides:
  - test:billing:e2e npm script for running billing Playwright specs
  - CI wiring for billing E2E in billing-live, billing-live-extended, billing-live-extended-nightly jobs
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Job-unique artifact names via ${{ github.job }} suffix"
    - "Playwright browser install step before E2E run in CI"

key-files:
  created: []
  modified:
    - package.json
    - .github/workflows/ci.yml
    - .github/workflows/billing-nightly.yml

key-decisions:
  - "No --config flag in npm script -- playwright.config.ts is the default location"
  - "Artifact names use ${{ github.job }} to avoid collision across billing jobs in same workflow run"

patterns-established:
  - "Billing E2E steps appended after Vitest live-billing steps in each CI job"

requirements-completed: []

# Metrics
duration: 1min
completed: 2026-02-28
---

# Phase 12 Plan 01: Billing E2E CI Wiring Summary

**Added test:billing:e2e npm script and wired Playwright billing E2E tests into all three billing CI jobs with Clerk/Playwright env vars, browser install, test run, and artifact upload steps**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-28T08:41:16Z
- **Completed:** 2026-02-28T08:42:44Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `test:billing:e2e` npm script (`playwright test --project=billing`) to package.json
- Wired 7 Clerk/Playwright environment variables into billing-live, billing-live-extended, and billing-live-extended-nightly CI jobs
- Added Install Playwright browser, Run billing E2E tests, and Upload billing E2E report steps to all three billing CI jobs
- Artifact names use `${{ github.job }}` suffix for uniqueness across jobs in the same workflow run

## Task Commits

Each task was committed atomically:

1. **Task 1: Add test:billing:e2e npm script** - `6dffdcd` (feat)
2. **Task 2: Wire billing E2E env vars and steps into all three billing CI jobs** - `56a9959` (feat)

## Files Created/Modified
- `package.json` - Added test:billing:e2e script
- `.github/workflows/ci.yml` - Added env vars and E2E steps to billing-live and billing-live-extended jobs
- `.github/workflows/billing-nightly.yml` - Added env vars and E2E steps to billing-live-extended-nightly job

## Decisions Made
- No `--config` flag in npm script -- `playwright.config.ts` is the default config location
- Artifact names use `${{ github.job }}` to avoid name collisions between billing jobs uploading to the same workflow run

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Clerk and E2E secrets must already be configured in GitHub repository secrets (they were set up in prior phases for the e2e-auth job).

## Next Phase Readiness
- Billing E2E specs are now fully wired into CI pipelines
- On next push to main, billing-live and billing-live-extended will run Playwright billing E2E tests after the Vitest live-billing suite
- Nightly billing job will also include the E2E tests

---
*Phase: 12-billing-e2e-ci-wiring*
*Completed: 2026-02-28*

## Self-Check: PASSED
