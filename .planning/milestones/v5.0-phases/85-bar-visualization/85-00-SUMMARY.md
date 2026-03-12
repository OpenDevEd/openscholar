---
phase: 85-bar-visualization
plan: "00"
subsystem: testing
tags: [recharts, vitest, tdd, bar-charts, wave-0]

# Dependency graph
requires:
  - phase: 83-test-foundation-i18n-keys
    provides: vitest jsdom test infrastructure with tsx support
  - phase: 84-summary-cards-confidence-display
    provides: confidence badge and card components pattern context
provides:
  - recharts@^2.15.4 installed as production dependency
  - Four Wave 0 test stubs in RED state for TDD Plans 01 and 02
  - tests/bar-scaling.test.ts (normalizeToMax, scaleAnswersForDisplay contract)
  - tests/bar-validation.test.ts (validateBarData edge case contract)
  - tests/stacked-answer-bars.test.tsx (StackedAnswerBars rendering contract)
  - tests/bar-tooltip.test.tsx (renderTooltipContent contract)
affects: [85-bar-visualization-01, 85-bar-visualization-02]

# Tech tracking
tech-stack:
  added: [recharts@^2.15.4]
  patterns:
    - "Recharts mocked via vi.mock in jsdom tests to avoid canvas/SVG issues"
    - "Wave 0 test stubs: import from non-existent source for TDD RED state"

key-files:
  created:
    - tests/bar-scaling.test.ts
    - tests/bar-validation.test.ts
    - tests/stacked-answer-bars.test.tsx
    - tests/bar-tooltip.test.tsx
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "recharts@^2.15.4 installed (satisfying ^2.14.0 constraint from plan)"
  - "Recharts vi.mock pattern matches Phase 84 approach — BarChart/Bar/XAxis/YAxis/Tooltip/ResponsiveContainer all stubbed to avoid jsdom SVG issues"
  - "Wave 0 stubs import from lib/extraction/bar-scaling, lib/extraction/bar-validation, components/extraction/stacked-answer-bars — source files don't exist yet (correct RED state)"

patterns-established:
  - "Wave 0 test stubs: syntactically valid, fail at import resolution — enables Plans 01/02 to use `npm test -- tests/bar-*.test.ts` for TDD verification"

requirements-completed: [BAR-01, BAR-02, BAR-03, BAR-04]

# Metrics
duration: 1min
completed: 2026-03-10
---

# Phase 85 Plan 00: Bar Visualization Wave 0 Setup Summary

**recharts@^2.15.4 installed and four TDD test stubs created in RED state — import-failing Wave 0 foundation for Plans 01 and 02**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-10T09:41:04Z
- **Completed:** 2026-03-10T09:42:50Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Installed recharts as a production dependency (browser bundle, not devDependency)
- Created four test stub files covering all bar-visualization requirements (BAR-01 through BAR-04)
- All stubs fail at import resolution ("Cannot find module") confirming correct RED state for TDD
- Recharts mock pattern established for jsdom environments — consistent with Phase 84 approach

## Task Commits

Each task was committed atomically:

1. **Task 1: Install recharts dependency** - `a9e33d5` (chore)
2. **Task 2: Create four Wave 0 test stubs** - `0c0f832` (test)

**Plan metadata:** (pending — docs commit follows)

## Files Created/Modified
- `package.json` - Added recharts@^2.15.4 to production dependencies
- `package-lock.json` - Updated lock file
- `tests/bar-scaling.test.ts` - Failing stubs for normalizeToMax and scaleAnswersForDisplay (BAR-01)
- `tests/bar-validation.test.ts` - Failing stubs for validateBarData edge cases (BAR-03)
- `tests/stacked-answer-bars.test.tsx` - Failing stubs for StackedAnswerBars component (BAR-02)
- `tests/bar-tooltip.test.tsx` - Failing stubs for renderTooltipContent (BAR-04)

## Decisions Made
- recharts@^2.15.4 resolves the ^2.14.0 requirement; installed in `dependencies` (not devDependencies) since it is used in browser components
- Recharts mocked with vi.mock in all .tsx stubs to prevent jsdom canvas/SVG errors — same approach as Phase 84 confidence-badge tests

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave 0 RED state confirmed for all four test files
- Plan 01 can now run `npm test -- tests/bar-scaling.test.ts tests/bar-validation.test.ts` for TDD cycles on normalizeToMax, scaleAnswersForDisplay, validateBarData
- Plan 02 can now run `npm test -- tests/stacked-answer-bars.test.tsx tests/bar-tooltip.test.tsx` for TDD cycles on StackedAnswerBars and renderTooltipContent

---
*Phase: 85-bar-visualization*
*Completed: 2026-03-10*

## Self-Check: PASSED

- FOUND: tests/bar-scaling.test.ts
- FOUND: tests/bar-validation.test.ts
- FOUND: tests/stacked-answer-bars.test.tsx
- FOUND: tests/bar-tooltip.test.tsx
- FOUND: .planning/phases/85-bar-visualization/85-00-SUMMARY.md
- FOUND commit: a9e33d5 (chore: install recharts)
- FOUND commit: 0c0f832 (test: Wave 0 stubs)
