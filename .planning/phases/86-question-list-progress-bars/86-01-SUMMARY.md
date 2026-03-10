---
phase: 86-question-list-progress-bars
plan: "01"
subsystem: ui
tags: [typescript, testing, tdd, vitest, extraction]

# Dependency graph
requires:
  - phase: 85-bar-visualization
    provides: CITATION_STATUS_COLORS hex values used for color-drift prevention
provides:
  - statusFromCompletion: pure function mapping answered/total ratio to QuestionStatus
  - getAnswerPercentage: division-by-zero guarded percentage calculator
  - STATUS_DOT_COLORS: color constants matched to CITATION_STATUS_COLORS.grounded
  - STATUS_DOT_LABELS: i18n key map for statusDotComplete/Partial/Empty
  - QuestionStatus type
affects: [86-02, 86-03]

# Tech tracking
tech-stack:
  added: []
  patterns: [TDD RED/GREEN, pure utility module, color-drift prevention via explicit constant matching]

key-files:
  created:
    - lib/extraction/question-status.ts
    - tests/question-status.test.ts
  modified: []

key-decisions:
  - "STATUS_DOT_COLORS.complete hardcoded to #10b981 explicitly matching CITATION_STATUS_COLORS.grounded — no indirect import to prevent tree-shaking fragility"
  - "getAnswerPercentage uses Math.max(total, 1) guard — returns 0 for (0,0) rather than NaN"
  - "statusFromCompletion checks total===0 first — total=0 always returns empty regardless of answered value"

patterns-established:
  - "Color drift prevention: new status color constants explicitly document which bar-scaling.ts constant they match in a comment"

requirements-completed: [QLIST-01, QLIST-02]

# Metrics
duration: 1min
completed: 2026-03-10
---

# Phase 86 Plan 01: question-status utilities Summary

**Pure TypeScript status utilities (statusFromCompletion, getAnswerPercentage, STATUS_DOT_COLORS, STATUS_DOT_LABELS) with TDD coverage preventing NaN and color-drift bugs**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-10T10:14:08Z
- **Completed:** 2026-03-10T10:15:12Z
- **Tasks:** 2 (RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Centralized completion-state logic in one tested, importable module
- All 17 tests pass covering edge cases: total=0, answered=0, rounding (3/7=43, 1/3=33)
- Color drift prevention: STATUS_DOT_COLORS.complete === '#10b981' matches CITATION_STATUS_COLORS.grounded
- Full test suite remains green: 1017 tests across 99 files

## Task Commits

Each task was committed atomically:

1. **RED: Failing tests** - `a5b3086` (test)
2. **GREEN: Implementation** - `f06a8f8` (feat)

_Note: TDD tasks have separate test → feat commits. No refactor needed for these simple utilities._

## Files Created/Modified
- `lib/extraction/question-status.ts` - Pure status utilities and color/label constants
- `tests/question-status.test.ts` - 17 unit tests covering all functions and edge cases

## Decisions Made
- STATUS_DOT_COLORS.complete hardcoded to `#10b981` explicitly matching CITATION_STATUS_COLORS.grounded — no indirect import to prevent tree-shaking fragility
- getAnswerPercentage uses Math.max(total, 1) guard — returns 0 for (0,0) rather than NaN
- statusFromCompletion checks total===0 first — total=0 always returns empty regardless of answered value

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- question-status utilities fully tested and exported, ready for use in Plan 02 (status dot component) and Plan 03 (question list integration)
- STATUS_DOT_COLORS and STATUS_DOT_LABELS exportable for component rendering
- QuestionStatus type exported for TypeScript consumers

---
*Phase: 86-question-list-progress-bars*
*Completed: 2026-03-10*

## Self-Check: PASSED

- lib/extraction/question-status.ts: FOUND
- tests/question-status.test.ts: FOUND
- 86-01-SUMMARY.md: FOUND
- Commit a5b3086 (RED): FOUND
- Commit f06a8f8 (GREEN): FOUND
