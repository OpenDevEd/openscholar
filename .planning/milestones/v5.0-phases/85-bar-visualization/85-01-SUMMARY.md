---
phase: 85-bar-visualization
plan: "01"
subsystem: testing
tags: [vitest, tdd, bar-charts, pure-functions, normalization]

# Dependency graph
requires:
  - phase: 85-bar-visualization-00
    provides: Wave 0 TDD test stubs in RED state (bar-scaling.test.ts, bar-validation.test.ts)
  - phase: 84-summary-cards-confidence-display
    provides: BADGE_COLOR_CLASSES hex color values for CITATION_STATUS_COLORS alignment
provides:
  - lib/extraction/bar-scaling.ts: normalizeToMax, scaleAnswersForDisplay, CITATION_STATUS_COLORS
  - lib/extraction/bar-validation.ts: validateBarData, SafeBarData type
  - 14 passing unit tests covering all BAR-01 and BAR-03 edge cases
affects: [85-bar-visualization-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Math.max(...values, 1) guard pattern for safe division — prevents NaN on all-zero inputs"
    - "Non-finite values mapped to 0 before any arithmetic (NaN/Infinity guard)"
    - "CITATION_STATUS_COLORS co-located in bar-scaling.ts for single-import access from components"

key-files:
  created:
    - lib/extraction/bar-scaling.ts
    - lib/extraction/bar-validation.ts
  modified: []

key-decisions:
  - "normalizeToMax uses Math.max(...safe, 1) not Math.max(...values) so NaN inputs are sanitized before the guard applies"
  - "scaleAnswersForDisplay preserves raw count on every output item to support tooltip display (Pitfall 2 from research)"
  - "validateBarData filters NaN/negative before summing total, avoiding silent count inflation"
  - "CITATION_STATUS_COLORS hex values match BADGE_COLOR_CLASSES in card-thresholds.ts to prevent color drift (Pitfall 4 from research)"

patterns-established:
  - "Pure utility pattern: no React imports, no side effects, deterministic input → output"
  - "Safe division guard: Math.max(...safeCounts, 1) makes division safe for all-zero cases without special-casing"

requirements-completed: [BAR-01, BAR-03]

# Metrics
duration: 1min
completed: 2026-03-10
---

# Phase 85 Plan 01: Bar Scaling and Validation Summary

**normalizeToMax, scaleAnswersForDisplay, and validateBarData pure TypeScript utilities with full TDD coverage — 14/14 tests green, NaN-safe on all edge cases**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-10T09:44:59Z
- **Completed:** 2026-03-10T09:46:11Z
- **Tasks:** 1 (covers BAR-01 + BAR-03 features via TDD)
- **Files modified:** 2

## Accomplishments
- Created bar-scaling.ts with normalizeToMax, scaleAnswersForDisplay, and CITATION_STATUS_COLORS — all pure TypeScript with no React dependency
- Created bar-validation.ts with validateBarData function and SafeBarData type — handles null/undefined/empty/NaN/negative/all-zero paths
- Drove both test files from RED (import failure) to GREEN (all 14 tests passing) in a single implementation pass
- Full test suite: 988 tests pass, 0 regressions; the 2 still-failing stubs are Plan 02 Wave 0 stubs (expected RED state)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement bar-scaling and bar-validation utilities** - `0e3d4de` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `lib/extraction/bar-scaling.ts` - normalizeToMax (max-relative normalization), scaleAnswersForDisplay (adds scaledWidth + percentage), CITATION_STATUS_COLORS
- `lib/extraction/bar-validation.ts` - validateBarData (guards null/NaN/negative/all-zero), SafeBarData type

## Decisions Made
- normalizeToMax sanitizes values to safe[] first, then applies Math.max(...safe, 1) — this way NaN inputs are zeroed before the guard applies, not after
- scaleAnswersForDisplay uses separate max and total divisors: scaledWidth is relative to max (bar width), percentage is relative to total (label text)
- validateBarData filters before summing: NaN/negative items are excluded from the valid set, total is computed from valid items only

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- lib/extraction/bar-scaling.ts and lib/extraction/bar-validation.ts are fully implemented and tested
- Plan 02 can import from these modules in StackedAnswerBars component (BAR-02) and renderTooltipContent (BAR-04)
- tests/stacked-answer-bars.test.tsx and tests/bar-tooltip.test.tsx remain in RED state awaiting Plan 02

---
*Phase: 85-bar-visualization*
*Completed: 2026-03-10*

## Self-Check: PASSED

- FOUND: lib/extraction/bar-scaling.ts
- FOUND: lib/extraction/bar-validation.ts
- FOUND: .planning/phases/85-bar-visualization/85-01-SUMMARY.md
- FOUND commit: 0e3d4de (feat: bar-scaling + bar-validation)
