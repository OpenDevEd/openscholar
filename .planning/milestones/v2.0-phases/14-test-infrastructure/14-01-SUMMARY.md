---
phase: 14-test-infrastructure
plan: 01
subsystem: testing
tags: [vitest, convex-test, testing-library, jest-dom, jsdom, edge-runtime, react]

# Dependency graph
requires: []
provides:
  - "Multi-environment vitest config (node, edge-runtime, jsdom)"
  - "Global test setup with jest-dom matchers and conditional RTL cleanup"
  - "Convex module discovery for convex-test isolation"
  - "7 new test devDependencies installed"
affects: [15-convex-core-tests, 16-ai-prompt-tests, 17-react-hook-tests, 18-search-tests, 19-billing-tests, 20-integration-tests, 21-ci-coverage]

# Tech tracking
tech-stack:
  added: [convex-test, "@edge-runtime/vm", "@testing-library/react", "@testing-library/user-event", "@testing-library/jest-dom", jsdom, "@vitejs/plugin-react"]
  patterns: [environmentMatchGlobs routing, conditional DOM guard, import.meta.glob module discovery]

key-files:
  created: [tests/setup.ts, convex/test.setup.ts]
  modified: [vitest.config.ts, package.json, package-lock.json]

key-decisions:
  - "Used environmentMatchGlobs (deprecated in Vitest 3 but functional) for multi-env routing -- simpler than test.projects for this use case"
  - "Conditional dynamic import for RTL cleanup to avoid crashing node-environment tests"
  - "Lazy import.meta.glob (no eager option) for convex-test module discovery per docs recommendation"

patterns-established:
  - "Environment routing: convex/**/*.test.ts -> edge-runtime, tests/hooks/**/*.test.{ts,tsx} -> jsdom, tests/components/**/*.test.tsx -> jsdom, all others -> node"
  - "Conditional DOM guard: check globalThis.document before importing DOM-dependent modules in setup files"
  - "Convex test pattern: import { modules } from '../convex/test.setup' for convex-test isolation"

requirements-completed: [INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05]

# Metrics
duration: 2min
completed: 2026-02-28
---

# Phase 14 Plan 01: Test Infrastructure Summary

**Multi-environment Vitest config with edge-runtime/jsdom/node routing, jest-dom matchers, and Convex module discovery -- zero regression across 40 existing test files (162 tests)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-28T11:54:58Z
- **Completed:** 2026-02-28T11:56:55Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Installed 7 new test devDependencies (convex-test, @edge-runtime/vm, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom, jsdom, @vitejs/plugin-react)
- Updated vitest.config.ts with environmentMatchGlobs routing to 3 environments (node, edge-runtime, jsdom)
- Created tests/setup.ts with jest-dom matchers and conditional RTL cleanup guard
- Created convex/test.setup.ts with import.meta.glob module discovery for convex-test
- All 40 existing test files (162 tests) pass with zero modifications

## Task Commits

Each task was committed atomically:

1. **Task 1: Install devDependencies and create setup files** - `94ad4a5` (chore)
2. **Task 2: Update vitest.config.ts and validate zero regression** - `743e8c7` (feat)

## Files Created/Modified
- `vitest.config.ts` - Multi-environment config with environmentMatchGlobs, react plugin, setupFiles, convex-test inline deps
- `tests/setup.ts` - Global test setup extending Vitest expect with jest-dom matchers, conditional RTL cleanup
- `convex/test.setup.ts` - Convex module discovery via import.meta.glob for convex-test isolation
- `package.json` - 7 new devDependencies added
- `package-lock.json` - Lock file updated (57 packages added)

## Decisions Made
- Used environmentMatchGlobs for environment routing (deprecated in Vitest 3 but fully functional) -- simpler than migrating to test.projects for this initial setup
- Conditional dynamic import guard (`typeof globalThis.document !== "undefined"`) in tests/setup.ts prevents RTL cleanup from crashing node-environment tests
- Lazy (non-eager) import.meta.glob in convex/test.setup.ts per convex-test documentation recommendation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Test infrastructure foundation complete for all subsequent v2.0 TDD phases (15-21)
- Convex function tests can use edge-runtime environment with convex-test module discovery
- React hook/component tests can use jsdom environment with RTL and jest-dom matchers
- Existing node-environment tests continue working unchanged

## Self-Check: PASSED

- All created files exist (vitest.config.ts, tests/setup.ts, convex/test.setup.ts, 14-01-SUMMARY.md)
- All task commits verified (94ad4a5, 743e8c7)

---
*Phase: 14-test-infrastructure*
*Completed: 2026-02-28*
