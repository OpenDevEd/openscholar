---
phase: 85-bar-visualization
plan: "03"
subsystem: ui
tags: [recharts, next/dynamic, lazy-loading, bundle-split, react, vitest, tdd]

# Dependency graph
requires:
  - phase: 85-bar-visualization-01
    provides: lib/extraction/bar-scaling.ts (CITATION_STATUS_COLORS, normalizeToMax), lib/extraction/bar-validation.ts (validateBarData)
  - phase: 85-bar-visualization-02
    provides: components/extraction/stacked-answer-bars.tsx (StackedAnswerBars, StackedAnswerBarsProps)
provides:
  - components/extraction/bar-visualization.tsx: BarVisualization named export (lazy wrapper using next/dynamic, ssr=false)
  - components/extraction/bar-chart-content.tsx: default export wrapping StackedAnswerBars behind validateBarData guard
  - components/extraction/insights-question-panel.tsx: updated to use BarVisualization for rawAnswerDistribution and entityDistribution
  - Recharts bundle deferred until insights tab is accessed (INFRA-02 complete)
affects: [phase-86-integration, manual-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "next/dynamic with ssr=false for Recharts bundle split — prevents ~65KB gzipped from loading on page load"
    - "Lazy wrapper (bar-visualization.tsx) never imports recharts directly — only bar-chart-content.tsx does (critical for bundle split)"
    - "Loading skeleton (animate-pulse divs) shown while Recharts chunk loads — no blank space flash"
    - "validateBarData guard in bar-chart-content.tsx renders empty state instead of chart when no data"

key-files:
  created:
    - components/extraction/bar-visualization.tsx
    - components/extraction/bar-chart-content.tsx
    - tests/extraction-insights-question-panel.test.tsx
  modified:
    - components/extraction/insights-question-panel.tsx

key-decisions:
  - "bar-visualization.tsx uses named export BarVisualization (not default) — consistent with existing component pattern in codebase"
  - "bar-chart-content.tsx is default export — required by next/dynamic which expects a default export"
  - "rawAnswerDistribution mapped to BarVisualization as full answer set — one BarVisualization replaces all per-answer Bar components"
  - "entityDistribution mapped to BarVisualization using groundedRate to construct citationStatusMix (grounded + best_effort split)"
  - "confidenceDistribution and citationStatusMix sections keep old Bar component — simple single-color bars don't need Recharts"
  - "Test file is .tsx (jsdom) not .ts — React rendering requires DOM environment, plan's .ts reference was imprecise"

patterns-established:
  - "Lazy-loading pattern: wrapper (bar-visualization.tsx) uses next/dynamic → content (bar-chart-content.tsx) has Recharts — prevents import bleeding"
  - "Mock pattern: vi.mock('../components/extraction/bar-visualization') in component tests to avoid dynamic import resolution in jsdom"

requirements-completed: [INFRA-02]

# Metrics
duration: 3min
completed: 2026-03-10
---

# Phase 85 Plan 03: Lazy-Loading Wiring Summary

**next/dynamic lazy wrapper + InsightsQuestionPanel wiring defers Recharts ~65KB until insights tab access — INFRA-02 complete, 1000/1000 tests green**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-10T09:49:11Z
- **Completed:** 2026-03-10T09:53:00Z
- **Tasks:** 3 (2 automated + 1 human-verify checkpoint — approved)
- **Files modified:** 4

## Accomplishments
- Created bar-visualization.tsx as the lazy wrapper — next/dynamic with ssr=false, loading skeleton, named export BarVisualization
- Created bar-chart-content.tsx as the Recharts implementation — default export (required by dynamic), validateBarData guard for empty state
- Wired BarVisualization into InsightsQuestionPanel replacing old Bar component for rawAnswerDistribution and entityDistribution
- confidenceDistribution and citationStatusMix keep the simple div-based Bar (no Recharts needed)
- Full test suite: 1000 tests pass, 0 regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create lazy-loading infrastructure** - `c81abc6` (feat)
2. **Task 2: Wire BarVisualization into InsightsQuestionPanel** - `7a0b1c1` (feat)

**Plan pre-checkpoint metadata:** `7ef939a` (docs: checkpoint reached)
**Plan completion metadata:** (docs commit follows)

## Files Created/Modified
- `components/extraction/bar-visualization.tsx` - Named export BarVisualization, next/dynamic lazy wrapper with loading skeleton (ssr=false)
- `components/extraction/bar-chart-content.tsx` - Default export, validates data then renders StackedAnswerBars (Recharts inside)
- `components/extraction/insights-question-panel.tsx` - Replaced Bar in rawAnswerDistribution and entityDistribution with BarVisualization
- `tests/extraction-insights-question-panel.test.tsx` - 4 jsdom tests verifying BarVisualization wiring with vi.mock

## Decisions Made
- `bar-visualization.tsx` is a named export wrapper — matches the codebase's component pattern (non-default exports)
- `bar-chart-content.tsx` is a default export — required because `next/dynamic(() => import(...))` resolves the default export
- Test file created as `.tsx` not `.ts` — React component rendering requires jsdom environment; the plan's `.ts` reference was imprecise (test adds jsx/rendering needs)
- rawAnswerDistribution: entire list passed as one BarVisualization (answer array) — cleaner than one BarVisualization per answer
- entityDistribution: entire list passed as one BarVisualization using groundedRate to construct citationStatusMix

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test file uses .tsx extension instead of plan's .ts**
- **Found during:** Task 2 (TDD test creation)
- **Issue:** Plan specified `tests/extraction-insights.test.ts` but React rendering (render, screen) requires jsdom environment. Files with `.ts` extension in `tests/` root run in node environment per vitest.config.ts. The existing `extraction-insights.test.ts` also only has pure function tests.
- **Fix:** Created `tests/extraction-insights-question-panel.test.tsx` (`.tsx` gets jsdom via environmentMatchGlobs rule `"tests/*.test.tsx": "jsdom"`)
- **Files modified:** tests/extraction-insights-question-panel.test.tsx (new file)
- **Verification:** All 4 tests pass in jsdom environment
- **Committed in:** 7a0b1c1 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (test file extension correction)
**Impact on plan:** Correctness fix — tests would fail to render in node environment. No scope change.

## Issues Encountered
None — both automated tasks executed cleanly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Task 3 (human-verify): APPROVED — Chrome DevTools confirmed recharts chunk deferred from initial load and appears on insights tab click
- Phase 85 (bar-visualization) is complete: all plans 00-03 delivered, INFRA-02 verified
- Phase 86 integration can proceed

---
*Phase: 85-bar-visualization*
*Completed: 2026-03-10*

## Self-Check: PASSED

- FOUND: components/extraction/bar-visualization.tsx
- FOUND: components/extraction/bar-chart-content.tsx
- FOUND: components/extraction/insights-question-panel.tsx (modified)
- FOUND: tests/extraction-insights-question-panel.test.tsx
- FOUND commit: c81abc6 (feat: lazy-loading infrastructure)
- FOUND commit: 7a0b1c1 (feat: wire BarVisualization into InsightsQuestionPanel)
