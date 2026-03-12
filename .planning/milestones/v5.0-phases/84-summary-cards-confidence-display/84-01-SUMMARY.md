---
phase: 84-summary-cards-confidence-display
plan: 01
subsystem: ui
tags: [typescript, vitest, thresholds, color-mapping, i18n, pure-functions]

# Dependency graph
requires:
  - phase: 83-test-foundation-i18n-keys
    provides: i18n keys (confidenceAbstractOnly, confidenceNoContent, confidence) seeded in all locale files; confidence context contract tests locked
provides:
  - CONFIDENCE_THRESHOLDS and CARD_THRESHOLDS constants (single source of truth)
  - ThresholdColor type and getConfidenceColor() / getCardColor() pure functions
  - BADGE_COLOR_CLASSES and BORDER_COLOR_CLASSES Tailwind class maps
  - getConfidenceTooltipKey() pure function mapping citation status to i18n tooltip key
affects: [84-confidence-badge, 84-summary-cards, 85-bar-visualization]

# Tech tracking
tech-stack:
  added: []
  patterns: [pure-function extraction — threshold and message-selection logic isolated from React before components are built]

key-files:
  created:
    - lib/extraction/card-thresholds.ts
    - lib/extraction/confidence-messages.ts
    - tests/card-thresholds.test.ts
    - tests/confidence-messages.test.ts
  modified: []

key-decisions:
  - "Threshold constants defined as const objects with named color keys (green/yellow) for readable boundary comparisons"
  - "BADGE_COLOR_CLASSES and BORDER_COLOR_CLASSES co-located with threshold logic so components import one module for both values and styles"
  - "getConfidenceTooltipKey priority: no-content > abstract-only (all) > abstract-only (mixed) > confidence; pure function avoids React coupling"

patterns-established:
  - "Threshold-first pattern: centralize all numeric boundaries in card-thresholds.ts before writing components — never hardcode in JSX"
  - "Pure function message selection: getConfidenceTooltipKey takes counts, returns i18n key string — no React, no hooks, fully unit-testable"

requirements-completed: [CARD-02, CONF-02, CONF-03]

# Metrics
duration: 2min
completed: 2026-03-10
---

# Phase 84 Plan 01: Threshold Color Mapping and Confidence Tooltip Key Selection Summary

**Centralized threshold color logic (green/yellow/red) and pure tooltip-key selection function as shared contracts for ConfidenceBadge (Plan 02) and SummaryCards (Plan 03), with 48 passing unit tests**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T09:02:25Z
- **Completed:** 2026-03-10T09:04:26Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created `lib/extraction/card-thresholds.ts` with CONFIDENCE_THRESHOLDS (green: 0.85, yellow: 0.60), CARD_THRESHOLDS (completion/quality), getConfidenceColor(), getCardColor(), and Tailwind class maps
- Created `lib/extraction/confidence-messages.ts` with getConfidenceTooltipKey() implementing the priority chain: no-content > abstract-only > mixed > confidence
- 48 unit tests (35 threshold + 13 message) all pass; cover all boundary values and priority ordering

## Task Commits

Each task was committed atomically:

1. **Task 1: Create card-thresholds.ts with color mapping functions and tests** - `794b0ef` (feat)
2. **Task 2: Create confidence-messages.ts with tooltip key selection and tests** - `213d2c4` (feat)

**Plan metadata:** _(to be committed with SUMMARY.md)_

_Note: TDD tasks — RED (failing import) confirmed before GREEN (implementation) for both tasks_

## Files Created/Modified
- `lib/extraction/card-thresholds.ts` - ThresholdColor type, CONFIDENCE_THRESHOLDS, CARD_THRESHOLDS, getConfidenceColor(), getCardColor(), BADGE_COLOR_CLASSES, BORDER_COLOR_CLASSES
- `lib/extraction/confidence-messages.ts` - ConfidenceTooltipKey type, getConfidenceTooltipKey() pure function
- `tests/card-thresholds.test.ts` - 35 unit tests covering all boundary values and Tailwind class exports
- `tests/confidence-messages.test.ts` - 13 unit tests covering all priority ordering and edge cases

## Decisions Made
- Threshold constants use named color keys (`green`/`yellow`) rather than array indices for self-documenting boundary comparisons
- BADGE_COLOR_CLASSES and BORDER_COLOR_CLASSES co-located in card-thresholds.ts so Plan 02/03 components import one module for both logic and styling
- getConfidenceTooltipKey() priority: no-content check runs before abstract-only check (both require `totalPapers > 0` guard); mixed case (abstractOnlyCount > 0) fires last before fallback

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript error in `tests/extraction-i18n-coverage.test.ts` (missing `addQuestion` key in common namespace) — unrelated to this plan's files; out of scope per deviation rules; not introduced by this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 02 (ConfidenceBadge): import `getConfidenceColor`, `getConfidenceTooltipKey`, `BADGE_COLOR_CLASSES` from new lib files
- Plan 03 (SummaryCards): import `getCardColor`, `BORDER_COLOR_CLASSES` from card-thresholds.ts
- All threshold contracts are locked and tested; no numeric literals in future components

---
*Phase: 84-summary-cards-confidence-display*
*Completed: 2026-03-10*

## Self-Check: PASSED

- FOUND: lib/extraction/card-thresholds.ts
- FOUND: lib/extraction/confidence-messages.ts
- FOUND: tests/card-thresholds.test.ts
- FOUND: tests/confidence-messages.test.ts
- FOUND: 84-01-SUMMARY.md
- FOUND commit: 794b0ef (Task 1)
- FOUND commit: 213d2c4 (Task 2)
