---
phase: 99-selection-basket-core
plan: 01
subsystem: ui
tags: [zustand, sessionStorage, react-hooks, openalex, normalization, tdd]

# Dependency graph
requires: []
provides:
  - normalizeOpenAlexId pure utility for OpenAlex work ID canonicalization
  - useExtractionBasketStore Zustand store with sessionStorage persistence and Map-backed dedupe
  - useAddToBasket public hook API for downstream phases (102, 103)
  - basketStorage custom PersistStorage adapter for Map serialization
  - migrateBasketState exported migration function for version upgrades
affects: [99-02 (drawer UI), 102 (AddToExtractionButton), 103 (selector tabs)]

# Tech tracking
tech-stack:
  added: []
  patterns: [custom PersistStorage for Map serialization, normalize-before-insert boundary, getState() for non-reactive membership checks]

key-files:
  created:
    - lib/openalex/normalize.ts
    - lib/store/extraction-basket.ts
    - lib/hooks/use-add-to-basket.ts
    - tests/normalize-openalex-id.test.ts
    - tests/extraction-basket-store.test.ts
  modified: []

key-decisions:
  - "Custom PersistStorage instead of createJSONStorage for Map serialization to sessionStorage"
  - "Count derived via selector s => s.papers.size instead of stored field (Zustand v5 no ES getter support)"
  - "isInBasket uses getState().has() for O(1) non-reactive check to avoid per-row subscriptions"
  - "Normalization happens in hook layer, not store layer -- store only accepts pre-normalized IDs"

patterns-established:
  - "Custom PersistStorage<T>: convert Map to [key, value][] on write, reconstruct on read"
  - "Normalize-before-insert boundary: hooks normalize raw input, stores accept canonical data"
  - "Exported migration function pattern: migrateBasketState exported separately for unit testability"
  - "sessionStorage global mock: vi.stubGlobal before store import for node test environment"

requirements-completed: [SEL-07, SEL-08, SEL-09, SEL-10]

# Metrics
duration: 6min
completed: 2026-04-15
---

# Phase 99 Plan 01: Selection Basket Core Summary

**normalizeOpenAlexId utility, sessionStorage-backed Zustand basket store with Map dedupe, and useAddToBasket public hook API -- 29 passing tests**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-15T16:57:21Z
- **Completed:** 2026-04-15T17:03:40Z
- **Tasks:** 3
- **Files created:** 5

## Accomplishments
- Pure normalizeOpenAlexId function handles bare IDs, full URLs (with query/fragment), and openalex: prefix -- returns canonical W\d+ or null
- Zustand store with custom PersistStorage that serializes/deserializes Map to [key, value][] arrays in sessionStorage, with hydration tracking and versioned migration
- Public useAddToBasket hook wraps normalize + store with stable useCallback references, ready for Phase 102/103 consumption
- Full TDD cycle for Tasks 1 and 2: RED (failing tests) -> GREEN (implementation) -> verification

## Task Commits

Each task was committed atomically:

1. **Task 1: normalizeOpenAlexId utility + unit tests** - `c8d631e` (feat) -- TDD: 15 tests
2. **Task 2: Zustand basket store + unit tests** - `31dc623` (feat) -- TDD: 14 tests
3. **Task 3: useAddToBasket public hook API** - `eae3f83` (feat)
4. **Type fix: PersistStorage.getItem return narrowing** - `66954d9` (fix)

## Files Created/Modified
- `lib/openalex/normalize.ts` - Pure function: normalizes OpenAlex work IDs to canonical W\d+ form
- `lib/store/extraction-basket.ts` - Zustand store with sessionStorage persistence, Map-backed dedupe, custom PersistStorage, hydration tracking
- `lib/hooks/use-add-to-basket.ts` - Public hook API wrapping normalize + store for downstream consumers
- `tests/normalize-openalex-id.test.ts` - 15 unit tests for all ID formats and edge cases
- `tests/extraction-basket-store.test.ts` - 14 unit tests for CRUD, dedupe, serialization, migration

## Decisions Made
- Custom PersistStorage instead of createJSONStorage because JSON.stringify(Map) produces "{}"
- Count derived via selector `s => s.papers.size` instead of ES getter (Zustand v5 incompatible with getters in create())
- isInBasket uses `getState().has()` for O(1) non-reactive check to avoid creating subscription per paper row
- Normalization in hook layer, not store layer -- clean separation of concerns

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Narrowed PersistStorage.getItem return type in test**
- **Found during:** Task 3 verification (full tsc --noEmit)
- **Issue:** Zustand's PersistStorage.getItem returns `StorageValue<T> | Promise<StorageValue<T> | null>` union; test accessed `.state` without narrowing
- **Fix:** Added `Awaited<ReturnType<>>` type assertion for the synchronous return value
- **Files modified:** tests/extraction-basket-store.test.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors in new files
- **Committed in:** `66954d9`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor type narrowing fix, no scope change.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three foundation modules ready for Plan 02 (drawer UI)
- Public API surface stable: `useAddToBasket` returns `{ addToBasket, removeFromBasket, isInBasket, basketCount }`
- `AddToBasketInput` type exported for downstream phases
- Store exports `BasketEntry`, `BasketSource`, `useExtractionBasketStore` for direct access where needed
- 29 tests provide regression safety for future changes

---
*Phase: 99-selection-basket-core*
*Completed: 2026-04-15*
