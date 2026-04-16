---
phase: 102-entry-points-counter-ux
plan: 01
subsystem: extraction-basket
tags: [i18n, cap-enforcement, counter-component, tdd]
dependency_graph:
  requires: [extraction-basket-store, extraction-limit-query]
  provides: [extraction-counter-component, cap-aware-add-to-basket, i18n-counter-keys]
  affects: [extraction-basket-drawer, extraction-new-page]
tech_stack:
  added: []
  patterns: [pure-function-extraction, zustand-synchronous-getstate, useprotectedquery]
key_files:
  created:
    - components/extraction/extraction-counter.tsx
    - tests/extraction-basket-cap.test.ts
  modified:
    - lib/hooks/use-add-to-basket.ts
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/ja.json
    - messages/zh.json
    - messages/hi.json
decisions:
  - Extracted computeCapAwareBatch as a pure function for testability outside React hook context
  - useProtectedQuery returns { data } wrapper, not raw value -- used limitData.data?.limit ?? 1000
key_metrics:
  duration_seconds: 378
  completed: "2026-04-16T11:11:32Z"
  tasks_completed: 3
  tasks_total: 3
  tests_added: 5
  tests_passing: 5
  files_created: 2
  files_modified: 7
---

# Phase 102 Plan 01: i18n + Cap-Aware Hook + ExtractionCounter Summary

Cap-aware addToBasket with first-N-fit truncation, ExtractionCounter component with 3-state progress bar (default/amber/destructive), and 8 i18n keys seeded across 6 locales.

## Task Completion

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Seed i18n keys in all 6 locale files | 5391624 | messages/{en-US,en-GB,fr,ja,zh,hi}.json |
| 2 | Extend useAddToBasket with cap-aware batch truncation (TDD) | 99a1b28 (RED), 42e3465 (GREEN) | lib/hooks/use-add-to-basket.ts, tests/extraction-basket-cap.test.ts |
| 3 | Create ExtractionCounter component | 1c3a7d3 | components/extraction/extraction-counter.tsx |

## Key Implementation Details

### i18n Seeding (Task 1)
- Added `extraction.counter.*` (3 keys: label, limitReached, limitWarning) and `extraction.addButton.*` (5 keys: add, remove, inBasket, basketFull, dropped) as siblings of existing `extraction.basket` block
- French translations provided with proper accents; ja/zh/hi use English placeholders per established pattern
- Existing keys verified unchanged

### Cap-Aware Hook (Task 2)
- Extracted `computeCapAwareBatch()` as a pure function for unit testability without React hook context
- Uses synchronous `useExtractionBasketStore.getState().papers.size` inside callbacks (not reactive selector) per RESEARCH.md Pitfall 2
- Invalid IDs (normalizeOpenAlexId returns null) silently filtered -- not counted as dropped
- Duplicates (already in basket) silently skipped -- not counted as dropped
- Only valid, non-duplicate inputs exceeding capacity are counted as "dropped"
- `addToBasket` return type changed from `void` to `AddToBasketResult { added, dropped }`
- Hook now exports `limit` alongside existing returns
- `useProtectedQuery(api.extraction.queries.getExtractionLimit, {})` with `.data?.limit ?? 1000` fallback

### ExtractionCounter Component (Task 3)
- Self-contained: reads count via Zustand selector, limit via Convex query
- Ratio computed as `count / limit` (never hardcoded against 1000)
- 3 visual states: default (bg-primary), warning at 80% (amber-500/amber-400 dark), full at 100% (destructive)
- Progress value clamped with `Math.min(ratio * 100, 100)`
- Targets indicator fill via `[&>[data-slot=progress-indicator]]` descendant selector
- All text via `useTranslations("extraction.counter")`

## Decisions Made

1. **Pure function extraction for cap logic** -- `computeCapAwareBatch` is a standalone function that reads store state synchronously. This avoids needing to render a React component to test cap enforcement, and keeps the hook itself thin.

2. **useProtectedQuery wrapping** -- The actual `useProtectedQuery` returns `{ data, phase, isDeferred, ... }`, not raw data. Used `limitData.data?.limit ?? 1000` pattern matching the real API.

## TDD Gate Compliance

- RED: `99a1b28` -- 5 failing tests (computeCapAwareBatch not exported)
- GREEN: `42e3465` -- 5 passing tests (function implemented, hook updated)
- REFACTOR: Not needed -- implementation is clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Convex provider initialization in test environment**
- **Found during:** Task 2 (TDD GREEN phase)
- **Issue:** Importing `use-add-to-basket.ts` transitively imports `use-auth-query.ts` which imports `convex-provider.tsx` that instantiates `ConvexReactClient` at module scope, failing in Node test environment
- **Fix:** Added `vi.mock("@/components/providers/convex-provider")` and `vi.mock("convex/react")` in the test file to prevent client initialization
- **Files modified:** tests/extraction-basket-cap.test.ts
- **Commit:** 42e3465

## Verification Results

1. `npx vitest run tests/extraction-basket-cap.test.ts` -- 5/5 pass
2. `npx tsc --noEmit` -- 0 new errors (1 pre-existing in unrelated test file)
3. `grep -l "limitReached" messages/*.json | wc -l` -- returns 6
4. `grep -c '"counter"\|"addButton"' messages/en-US.json` -- returns 2

## Self-Check: PASSED

All 4 created/modified key files exist. All 4 commits (5391624, 99a1b28, 42e3465, 1c3a7d3) verified in git log.
