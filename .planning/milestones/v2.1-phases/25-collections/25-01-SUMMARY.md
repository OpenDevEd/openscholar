---
phase: 25-collections
plan: 01
subsystem: database
tags: [convex, junction-table, collections, crud, tdd, cascade-delete]

# Dependency graph
requires:
  - phase: 22-schema
    provides: "libraryItems table definition with indexes"
  - phase: 23-library-queries
    provides: "removeFromLibrary and removeFromLibraryByOpenalexId mutations"
provides:
  - "collections table with by_user index"
  - "libraryItemCollections junction table with by_collection, by_item, by_collection_item, by_user indexes"
  - "createCollection, renameCollection, deleteCollection mutations"
  - "listCollections query (alphabetical)"
  - "cascade-delete junction rows on collection deletion"
  - "cascade-delete junction rows on library item removal"
affects: [25-02, 25-03, library-filters, collection-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [junction-table-many-to-many, cascade-delete-junction-rows, ownership-auth-guard]

key-files:
  created:
    - convex/library/collections.ts
    - convex/library/collections.test.ts
  modified:
    - convex/schema.ts
    - convex/library/mutations.ts

key-decisions:
  - "Junction table (libraryItemCollections) for many-to-many, not array fields on libraryItems"
  - "Alphabetical sort for listCollections via localeCompare (case-insensitive)"
  - "Cascade-delete junction rows in both removeFromLibrary and removeFromLibraryByOpenalexId"

patterns-established:
  - "Collection CRUD pattern: requireAuth, ownership check, createError for NOT_FOUND/FORBIDDEN/VALIDATION_ERROR"
  - "Junction table cascade: query by_item/by_collection index, iterate and delete before parent deletion"

requirements-completed: [COL-01, COL-02, COL-03, COL-06]

# Metrics
duration: 3min
completed: 2026-03-01
---

# Phase 25 Plan 01: Collection Schema & CRUD Summary

**Collections and junction table schema with TDD-driven CRUD mutations (create, rename, delete) and bidirectional cascade-delete for junction rows**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-01T05:12:51Z
- **Completed:** 2026-03-01T05:16:29Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Two new schema tables (collections, libraryItemCollections) with proper indexes for all query patterns
- Collection CRUD mutations with auth, ownership, and validation enforcement
- listCollections query returning alphabetically sorted results per user
- Bidirectional cascade-delete: deleting a collection removes its junction rows, and removing a library item also removes its junction rows
- 15 TDD tests covering all CRUD operations, cascade behavior, auth guards, and user isolation

## Task Commits

Each task was committed atomically:

1. **Task 1: RED -- Failing tests for collection CRUD and cascade** - `202db77` (test)
2. **Task 2: GREEN -- Implement collection CRUD, listCollections, and cascade delete** - `7790190` (feat)

## Files Created/Modified
- `convex/schema.ts` - Added collections and libraryItemCollections table definitions with indexes
- `convex/library/collections.ts` - New module: createCollection, renameCollection, deleteCollection mutations, listCollections query
- `convex/library/mutations.ts` - Extended removeFromLibrary and removeFromLibraryByOpenalexId with junction row cascade-delete
- `convex/library/collections.test.ts` - 15 TDD tests covering CRUD, cascade, auth, ownership, validation

## Decisions Made
- Junction table (libraryItemCollections) for many-to-many relationships, not array fields -- follows COL-06 requirement and avoids document update contention
- Alphabetical sort for listCollections using localeCompare (case-insensitive) -- simplest UX, consistent with research recommendation
- Cascade-delete pattern applied to both removal mutations to prevent orphaned junction rows

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript errors in test file**
- **Found during:** Task 2 (GREEN implementation)
- **Issue:** `ctx.db.get()` returns a union type of all document types; accessing `.name`, `.title`, `.updatedAt` on the result caused TS errors
- **Fix:** Added `as any` cast on `ctx.db.get()` returns where specific document properties are accessed in test assertions
- **Files modified:** convex/library/collections.test.ts
- **Verification:** `npx tsc --noEmit` passes for collections.test.ts (only pre-existing errors remain in unrelated test files)
- **Committed in:** 7790190 (part of GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Minor TS typing fix in test file. No scope creep.

## Issues Encountered
- Implementation files (collections.ts and mutations.ts changes) were already present as working state from a prior research/planning session but uncommitted. Verified correctness against plan spec and committed as part of GREEN phase.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Schema tables and CRUD foundation ready for Plan 02 (addToCollection, removeFromCollection, getItemCollections)
- Junction table indexes support all planned query patterns
- No blockers

## Self-Check: PASSED

- All created files exist (collections.ts, collections.test.ts, 25-01-SUMMARY.md)
- All commits verified (202db77, 7790190)

---
*Phase: 25-collections*
*Completed: 2026-03-01*
