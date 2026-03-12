---
phase: 85-bar-visualization
plan: "02"
subsystem: ui
tags: [recharts, react, vitest, tdd, bar-charts, tooltip, citation-status]

# Dependency graph
requires:
  - phase: 85-bar-visualization-00
    provides: recharts installed, test stubs in RED state (stacked-answer-bars.test.tsx, bar-tooltip.test.tsx)
  - phase: 85-bar-visualization-01
    provides: lib/extraction/bar-scaling.ts with CITATION_STATUS_COLORS, normalizeToMax, scaleAnswersForDisplay
provides:
  - components/extraction/stacked-answer-bars.tsx — StackedAnswerBars React component
  - renderTooltipContent — exported pure function for direct unit-test of tooltip logic
  - Recharts stacked horizontal bars per answer row with citation-status coloring
  - Integer-safe tooltip showing count and percentage (never raw decimal)
affects: [85-bar-visualization-03, phase-86-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Recharts BarChart with layout=vertical for horizontal stacked bars per answer"
    - "Export renderTooltipContent as pure function to enable direct unit testing without DOM event simulation"
    - "Empty-state guard: renders 'No answers' div instead of chart when all counts=0"
    - "safMax = Math.max(maxCount, 1) prevents XAxis domain=[0,0]"

key-files:
  created:
    - components/extraction/stacked-answer-bars.tsx
  modified: []

key-decisions:
  - "renderTooltipContent exported as pure function — avoids jsdom Tooltip event simulation and directly tests BAR-04 percentage/count formatting"
  - "Tooltip calculates total from citationStatusMix fields at render time — tooltip payload carries full mix breakdown for accurate percentage computation"
  - "isAnimationActive=false on all Bar components — prevents animation-related jsdom test issues"

patterns-established:
  - "Pure tooltip renderer export pattern: export renderTooltipContent for direct test invocation, pass as content prop to Recharts Tooltip"

requirements-completed: [BAR-02, BAR-04]

# Metrics
duration: 1min
completed: 2026-03-10
---

# Phase 85 Plan 02: StackedAnswerBars Component Summary

**Recharts stacked horizontal bars per answer with pure-function tooltip showing integer count and percentage — 8 tests green (BAR-02 + BAR-04)**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-10T09:45:30Z
- **Completed:** 2026-03-10T09:46:48Z
- **Tasks:** 2 TDD features (implemented together in one component file)
- **Files modified:** 1

## Accomplishments
- StackedAnswerBars renders one `data-testid="answer-bar-row"` per answer item using Recharts BarChart with layout="vertical"
- Four stacked Bar segments colored from CITATION_STATUS_COLORS (imported from bar-scaling.ts)
- Empty state ("No answers") when all answer counts are zero
- renderTooltipContent exported as pure function — tests call it directly without DOM event simulation
- Tooltip always shows integer count and integer percentage (count / total segments * 100, Math.round) — never raw decimal
- Full test suite: 997 tests, 97 files, all green

## Task Commits

Each task was committed atomically:

1. **Task 1 + 2: StackedAnswerBars component (TDD RED→GREEN for both features)** - `2d3684a` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `components/extraction/stacked-answer-bars.tsx` - StackedAnswerBars component with renderTooltipContent export (210 lines)

## Decisions Made
- Exported `renderTooltipContent` as a pure function rather than an inline component — allows bar-tooltip.test.tsx to call it directly with mock payload objects, matching the test stub contract established in Plan 00
- Tooltip computes percentage from the full citationStatusMix on the payload item — this is more accurate than using the `value` field alone (which is just one segment's count)
- Both TDD features (stacked-answer-bars and bar-tooltip) are inseparable in one component file, so implemented and committed together in one GREEN commit

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] lib/extraction/bar-scaling.ts was already present (Plan 01 had run)**
- **Found during:** Task 1 setup
- **Issue:** Expected bar-scaling.ts to be absent (parallel wave), but it already existed with correct exports
- **Fix:** No action needed — just imported from it normally
- **Files modified:** None
- **Verification:** Import resolved, tests passed
- **Committed in:** N/A (non-issue)

---

**Total deviations:** 0 auto-fixes needed — bar-scaling.ts was already present, no blocking issues encountered.
**Impact on plan:** None. Plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- components/extraction/stacked-answer-bars.tsx complete with all required exports (StackedAnswerBars, StackedAnswerBarsProps, renderTooltipContent)
- Ready for Plan 03 to wire StackedAnswerBars into the insights question panel
- All 8 bar-visualization component tests green

---
*Phase: 85-bar-visualization*
*Completed: 2026-03-10*
