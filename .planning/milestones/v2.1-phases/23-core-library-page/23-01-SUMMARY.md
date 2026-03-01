---
phase: 23-core-library-page
plan: 01
subsystem: database
tags: [convex, pagination, search-index, filter, tdd]

# Dependency graph
requires:
  - phase: 22-schema-rating-bridge
    provides: libraryItems table with indexes, saveToLibrary mutation
provides:
  - browseLibrary paginated query with 3 sort fields and optional minRating filter
  - searchLibrary text search query via search_library index with optional minRating filter
  - getLibraryCount query returning total items for authenticated user
  - removeFromLibrary ownership-verified deletion mutation
affects: [23-02 (library UI page), 24 (URL state), 25 (collections)]

# Tech tracking
tech-stack:
  added: []
  patterns: [dual-path query (search vs browse), convex-helpers filter for gte predicates on paginated queries]

key-files:
  created:
    - convex/library/queries.ts
    - convex/library/queries.test.ts
  modified:
    - convex/library/mutations.ts

key-decisions:
  - "Used convex-helpers filter() for rating >= N on both browse and search paths for consistency"
  - "getLibraryCount uses .collect().length (acceptable for libraries up to 1024 items per Convex limit)"

patterns-established:
  - "Dual-path query: search mode (relevance order via searchIndex) vs browse mode (custom sort via regular indexes)"
  - "convex-helpers filter wrapping paginated queries for predicates not supported by index filters"

requirements-completed: [LIB-04, LIB-05, LIB-06, LIB-07, LIB-10, LIB-11]

# Metrics
duration: 3min
completed: 2026-02-28
---

# Phase 23 Plan 01: Library Queries Summary

**Dual-path browse/search queries with convex-helpers filter for rating predicates, ownership-verified remove mutation, and 16 passing TDD tests**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-28T22:16:45Z
- **Completed:** 2026-02-28T22:20:24Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- browseLibrary query with 3 sort indexes (savedAt, rating, publicationYear), asc/desc ordering, and optional minRating >= N filter
- searchLibrary query using search_library index for text search with optional minRating filter via convex-helpers filter
- getLibraryCount query returning total library size for authenticated user
- removeFromLibrary mutation with requireAuth + ownership check, NOT_FOUND/FORBIDDEN error handling
- 16 comprehensive tests covering all query/mutation functions including user isolation

## Task Commits

Each task was committed atomically:

1. **Task 1: RED -- Write failing tests** - `3943f7d` (test)
2. **Task 2: GREEN -- Implement queries and mutation** - `f3a1927` (feat)

## Files Created/Modified
- `convex/library/queries.ts` - browseLibrary, searchLibrary, getLibraryCount query functions
- `convex/library/mutations.ts` - Added removeFromLibrary mutation (alongside existing saveToLibrary)
- `convex/library/queries.test.ts` - 16 TDD tests using convex-test with edge-runtime
- `convex/_generated/api.d.ts` - Auto-regenerated API types

## Decisions Made
- Used convex-helpers filter() for rating >= N predicate on both browse and search paths. The search index only supports `.eq()` on filter fields, so filter() wraps the paginated query to apply the >= predicate. Pages may be undersized but cursors continue correctly.
- getLibraryCount uses simple `.collect().length` approach, acceptable for MVP libraries up to 1024 items (Convex .collect() limit). Can optimize with denormalized counter later if needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed user seed helper missing updatedAt field**
- **Found during:** Task 1 (RED phase)
- **Issue:** Test helper `seedUser` was missing the required `updatedAt` field on the users table and included a non-existent `plan` field, causing all tests to fail with schema validation error
- **Fix:** Added `updatedAt: Date.now()` and removed invalid `plan` field from the seed helper
- **Files modified:** convex/library/queries.test.ts
- **Verification:** All tests now fail for the correct reason (missing functions), not schema validation
- **Committed in:** 3943f7d (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug in test setup)
**Impact on plan:** Minimal -- test seed data needed to match actual schema. No scope creep.

## Issues Encountered
None -- implementation matched plan specification exactly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 4 backend functions (3 queries + 1 mutation) are ready for the library UI in Plan 02
- API types regenerated, imports available via `api.library.queries.*` and `api.library.mutations.*`
- browseLibrary and searchLibrary both accept `paginationOpts` compatible with `useProtectedPaginatedQuery`
- Dual-path query pattern established: client switches between search/browse based on active search text

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 23-core-library-page*
*Completed: 2026-02-28*
