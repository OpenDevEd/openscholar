---
phase: 83-test-foundation-i18n-keys
plan: 01
subsystem: testing
tags: [i18n, vitest, react-testing-library, extraction, localization]

# Dependency graph
requires: []
provides:
  - "11 new extraction insights i18n keys across all 6 locale JSON files (en-US, en-GB, fr, hi, ja, zh)"
  - "tests/extraction-i18n-coverage.test.ts — automated i18n completeness gate"
  - "tests/extraction-insights-overview.test.tsx — structural component test for InsightsOverview"
affects: [84-confidence-context, 85-bar-scaling, 86-question-list-status, 87-answer-grouping]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "i18n completeness test: import locale JSON files statically, validate all keys non-empty and non-key-name across all locales"
    - "Component structural test: mock next-intl (identity fn) + mock useProtectedQuery, assert DOM content without snapshots"
    - "tsx test files at tests root: vitest.config.ts environmentMatchGlobs includes tests/*.test.tsx as jsdom"

key-files:
  created:
    - tests/extraction-i18n-coverage.test.ts
    - tests/extraction-insights-overview.test.tsx
  modified:
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/hi.json
    - messages/ja.json
    - messages/zh.json
    - vitest.config.ts

key-decisions:
  - "Appended new keys after planGateProNote (end of extraction namespace) in all 6 locale files to keep insertion non-disruptive"
  - "Updated vitest.config.ts to include tests/*.test.tsx in jsdom environment — plan specified test path outside existing glob coverage"
  - "Component test mocks both useTranslations calls (extraction + common namespaces) with a single identity fn mock"
  - "Used unknown cast for mockJobId to avoid Convex Id type constraint in test context"

patterns-established:
  - "i18n gate pattern: static JSON imports + iterate all locales + assert key presence and value quality"
  - "Structural component test: no snapshots, assert DOM text content and callback invocation only"

requirements-completed: [INFRA-01]

# Metrics
duration: 10min
completed: 2026-03-10
---

# Phase 83 Plan 01: Test Foundation & i18n Keys Summary

**Seeded 11 extraction insights i18n keys into all 6 locale JSON files and created automated i18n completeness + structural InsightsOverview component tests**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-10T08:39:00Z
- **Completed:** 2026-03-10T08:41:30Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- Added 11 new extraction insights keys (confidenceAbstractOnly, confidenceNoContent, confidenceCapExplained, barScalingWarning, progressBarLabel, statusDotComplete, statusDotPartial, statusDotEmpty, answerGrouping, answerGroupingExpand, answerGroupingVariants) to all 6 locale files with proper native translations
- Created tests/extraction-i18n-coverage.test.ts with 3 test cases validating key presence, non-empty values, and no untranslated key-name values across all locales
- Created tests/extraction-insights-overview.test.tsx with 4 structural tests covering null rendering, metric cards, question list, and click callback — no snapshots

## Task Commits

Each task was committed atomically:

1. **Task 1: Add new extraction insights keys to all 6 locale JSON files** - `6b23d6c` (feat)
2. **Task 2: Create extraction-i18n-coverage.test.ts** - `89a8a41` (feat)
3. **Task 3: Create extraction-insights-overview.test.tsx** - `e34c758` (feat)

## Files Created/Modified
- `messages/en-US.json` - Added 11 new extraction insights keys (English source of truth)
- `messages/en-GB.json` - Added 11 new extraction insights keys (English)
- `messages/fr.json` - Added 11 keys with French translations
- `messages/hi.json` - Added 11 keys with Hindi translations
- `messages/ja.json` - Added 11 keys with Japanese translations
- `messages/zh.json` - Added 11 keys with Chinese Simplified translations
- `tests/extraction-i18n-coverage.test.ts` - i18n completeness gate (3 tests)
- `tests/extraction-insights-overview.test.tsx` - Structural component test (4 tests)
- `vitest.config.ts` - Added tests/*.test.tsx to include glob and jsdom environmentMatchGlobs

## Decisions Made
- Appended new keys after `planGateProNote` (end of extraction namespace) in all 6 locale files — clean, non-disruptive insertion point
- Updated vitest.config.ts to include `tests/**/*.test.tsx` since the plan-specified test path was outside the existing `tests/**/*.test.ts` include glob
- Single identity function mock `(key: string) => key` handles both `useTranslations("extraction")` and `useTranslations("common")` namespace calls
- Used `as unknown as Id<"extractionJobs">` cast for mock job ID to avoid needing convex runtime in test context

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated vitest.config.ts to include .tsx test files**
- **Found during:** Task 3 (Create extraction-insights-overview.test.tsx)
- **Issue:** Vitest config `include` only covered `tests/**/*.test.ts` — the `.tsx` test file would not be discovered or run
- **Fix:** Added `tests/**/*.test.tsx` to `include` array and added `["tests/*.test.tsx", "jsdom"]` to `environmentMatchGlobs`
- **Files modified:** vitest.config.ts
- **Verification:** All 896 tests pass with `npm test`; tsx file runs in jsdom environment correctly
- **Committed in:** e34c758 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking config issue)
**Impact on plan:** Required to make test file discoverable and runnable. No scope creep.

## Issues Encountered
None — after fixing the vitest config glob, all tests passed on first run.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 11 extraction insights i18n keys seeded and validated — Phases 84-87 UI components can consume them without missing-key warnings
- InsightsOverview structural test established — Phase 84+ component changes can be made safely without snapshot fragility
- Full test suite passes (896 tests) — no regressions

---
*Phase: 83-test-foundation-i18n-keys*
*Completed: 2026-03-10*
