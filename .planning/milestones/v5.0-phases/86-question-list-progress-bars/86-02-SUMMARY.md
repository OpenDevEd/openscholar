---
phase: 86-question-list-progress-bars
plan: "02"
subsystem: ui
tags: [react, typescript, testing, tdd, vitest, radix-ui, next-intl, extraction]

# Dependency graph
requires:
  - phase: 86-question-list-progress-bars/86-01
    provides: statusFromCompletion, getAnswerPercentage, STATUS_DOT_COLORS, STATUS_DOT_LABELS, QuestionStatus type
  - phase: 85-bar-visualization
    provides: Radix Progress component pattern, CITATION_STATUS_COLORS for color matching
provides:
  - QuestionListItem: named export component with status dot, progress bar, percentage text
  - InsightsOverview: refactored question map using QuestionListItem
  - tests: 8 unit tests for QuestionListItem + 2 new integration tests in InsightsOverview
affects: [86-03]

# Tech tracking
tech-stack:
  added: []
  patterns: [TDD RED/GREEN, component mocking in integration tests, Radix Progress with ARIA passthrough]

key-files:
  created:
    - components/extraction/question-list-item.tsx
    - tests/question-list-item.test.tsx
  modified:
    - components/extraction/insights-overview.tsx
    - tests/extraction-insights-overview.test.tsx

key-decisions:
  - "QuestionListItem mock in InsightsOverview integration test renders data-testid='status-dot' and 'progress-bar' — allows structural test without re-running component internals"
  - "Badge import and pct() function removed from InsightsOverview — no longer needed after QuestionListItem delegation"
  - "tc/useTranslations('common') removed from InsightsOverview — was only used in the old Badge block"

patterns-established:
  - "Component extraction pattern: vi.mock the new component in the parent's integration test to isolate parent wiring from child rendering"
  - "Progress ARIA passthrough: Progress component forwards aria-valuenow/aria-valuemin/aria-valuemax to the underlying Radix ProgressPrimitive.Root via spread props"

requirements-completed: [QLIST-01, QLIST-02, QLIST-03]

# Metrics
duration: 2min
completed: 2026-03-10
---

# Phase 86 Plan 02: QuestionListItem component and InsightsOverview integration Summary

**QuestionListItem React component with colored status dot, Radix Progress bar, and NaN-safe percentage text wired into InsightsOverview question list — QLIST-01/02/03 fully visible without expansion**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T10:17:23Z
- **Completed:** 2026-03-10T10:19:14Z
- **Tasks:** 3 (RED + GREEN + integration wiring; checkpoint 3 auto-approved)
- **Files modified:** 4

## Accomplishments
- QuestionListItem component delivers QLIST-01 (colored status dot), QLIST-02 (progress bar + percentage), QLIST-03 (scannable list without expand)
- All 8 unit tests pass covering: all 3 status dot colors, progress bar ARIA attributes, 0/0 edge case (0% not NaN), percentage display, click handler, selected styling
- InsightsOverview refactored: Badge/pct/tc removed; QuestionListItem handles all per-question rendering
- Full suite green: 1027 tests across 100 files, 0 regressions

## Task Commits

Each task was committed atomically:

1. **RED: Failing tests** - `f54c82a` (test)
2. **GREEN: QuestionListItem implementation** - `c0112dc` (feat)
3. **Wire into InsightsOverview + integration tests** - `7e86a6b` (feat)

_Note: TDD tasks have separate test → feat commits._

## Files Created/Modified
- `components/extraction/question-list-item.tsx` - QuestionListItem named export: status dot, Radix Progress bar, percentage text, isSelected/onClick props
- `tests/question-list-item.test.tsx` - 8 unit tests for all color states, ARIA attributes, NaN guard, click, selected class
- `components/extraction/insights-overview.tsx` - Replaced inline button block with QuestionListItem; removed Badge, pct(), tc
- `tests/extraction-insights-overview.test.tsx` - Added QuestionListItem mock + 2 new integration tests for status-dot/progress-bar presence and NaN-free percentage

## Decisions Made
- QuestionListItem mock in InsightsOverview integration test renders `data-testid="status-dot"` and `data-testid="progress-bar"` — allows structural test without re-running component internals in jsdom
- Badge import and `pct()` function removed from InsightsOverview — no longer needed after QuestionListItem delegation
- `tc`/`useTranslations("common")` removed from InsightsOverview — was only used in the old Badge block

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- QuestionListItem is fully tested and wired; visual checkpoint auto-approved (auto_advance mode)
- Human visual verification of status dots and progress bars in browser still recommended before Phase 87
- Phase 86-03 (semantic grouping) can proceed; QuestionListItem is the per-item rendering component

---
*Phase: 86-question-list-progress-bars*
*Completed: 2026-03-10*

## Self-Check: PASSED

- components/extraction/question-list-item.tsx: FOUND
- tests/question-list-item.test.tsx: FOUND
- 86-02-SUMMARY.md: FOUND
- Commit f54c82a (RED): FOUND
- Commit c0112dc (GREEN): FOUND
- Commit 7e86a6b (integration wiring): FOUND
