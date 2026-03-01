---
phase: 25-collections
plan: 02
subsystem: database
tags: [convex, junction-table, mutations, queries, filtering, nuqs, tdd]

# Dependency graph
requires:
  - phase: 25-collections-01
    provides: "Schema tables (collections, libraryItemCollections), CRUD mutations, cascade deletes"
provides:
  - "addToCollection and removeFromCollection mutations with ownership validation and idempotency"
  - "getCollectionsWithCounts query returning collections with item counts"
  - "getItemCollections query returning collection IDs for a library item"
  - "browseLibrary and searchLibrary extended with optional collectionId filter"
  - "col URL param in librarySearchParams for collection filter state"
affects: [25-collections-03, library-ui, library-filters]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Junction table pre-fetch Set for collection-filtered pagination"
    - "Empty collection early-return pattern for zero-result optimization"
    - "Collection ownership guard in browse/search queries (returns empty, not error)"

key-files:
  created: []
  modified:
    - convex/library/collections.ts
    - convex/library/queries.ts
    - lib/library/search-params.ts
    - convex/library/collections.test.ts

key-decisions:
  - "Non-existent or unowned collection filter returns empty results (not an error) per RESEARCH Pitfall 5"
  - "Collection filter uses Set-based pre-fetch + convex-helpers filter() for both browse and search paths"
  - "getCollectionsWithCounts sorts alphabetically by name (case-insensitive) for consistent UI ordering"

patterns-established:
  - "Junction table pre-fetch: query by_collection index, build Set<string>, filter in paginate callback"
  - "Empty collection early-return: if Set.size === 0, return empty pagination result immediately"

requirements-completed: [COL-04, COL-05, COL-07, FILT-03]

# Metrics
duration: 9min
completed: 2026-03-01
---

# Phase 25 Plan 02: Collection Assignment & Filtered Queries Summary

**TDD collection assignment mutations (add/remove), item count query, collection membership query, and collectionId filter on both browseLibrary and searchLibrary with col URL param**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-01T05:13:20Z
- **Completed:** 2026-03-01T05:22:15Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Items can be assigned to and removed from collections with ownership validation and duplicate idempotency
- getCollectionsWithCounts returns all user collections with accurate item counts in a single query
- Browse and search queries correctly filter by collection membership via junction table pre-fetch
- URL param `col` defined in librarySearchParams for downstream UI consumption
- 13 new tests added (33 total including Plan 01), all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: RED -- Failing tests for assignment, counts, and filtered queries** - `0ef05f6` (test)
2. **Task 2: GREEN -- Implement assignment mutations, count/membership queries, and filtered browse/search** - `6013c08` (feat)

## Files Created/Modified
- `convex/library/collections.ts` - Added addToCollection, removeFromCollection, getCollectionsWithCounts, getItemCollections
- `convex/library/queries.ts` - Extended browseLibrary and searchLibrary with optional collectionId filter
- `lib/library/search-params.ts` - Added col param to librarySearchParams
- `convex/library/collections.test.ts` - 13 new test cases for Plan 02 functionality

## Decisions Made
- Non-existent or unowned collection filter returns empty results rather than throwing an error (follows RESEARCH Pitfall 5 recommendation -- prevents broken UI when collection is deleted while col URL param is still set)
- Used Set<string> pre-fetch pattern for collection membership filtering, consistent with existing convex-helpers filter() approach for rating/date filters
- getCollectionsWithCounts sorts alphabetically by name using localeCompare for consistent ordering across locales

## Deviations from Plan

None - plan executed exactly as written.

Note: Plan 01 (schema tables, CRUD mutations, cascade deletes) was already committed prior to this execution. No prerequisite work was needed.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All collection backend functionality is complete (CRUD + assignment + filtering)
- Ready for Plan 03: UI components (collection picker, filter section, management dialog)
- URL param `col` is available for the UI layer to consume

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 25-collections*
*Completed: 2026-03-01*
