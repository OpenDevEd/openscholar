---
phase: 22-schema-rating-bridge
plan: 01
subsystem: database
tags: [convex, schema, mutation, openalex, library, upsert, tdd]

# Dependency graph
requires: []
provides:
  - "libraryItems Convex table with 5 regular indexes + 1 search index"
  - "trimPaperData pure function extracting 10 metadata fields from OpenAlex Work"
  - "saveToLibrary upsert mutation with requireAuth"
  - "TrimmedPaperData shared type interface"
affects: [22-02-schema-rating-bridge, 23-library-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Slim typed schema fields instead of v.any() blob for library items"
    - "Client-side trimming before mutation to reduce wire payload"
    - "Compound index upsert pattern for user+openalexId dedup"

key-files:
  created:
    - "lib/types/library.types.ts"
    - "lib/library/trim-paper-data.ts"
    - "convex/library/mutations.ts"
    - "tests/library/trim-paper-data.test.ts"
  modified:
    - "convex/schema.ts"

key-decisions:
  - "Slim typed fields instead of v.any() blob -- enforces 1-2 KB document size at schema level"
  - "All Phase 23 indexes defined upfront (zero cost until queried, avoids second schema migration)"
  - "searchableText concatenated field for Phase 23 full-text search index"
  - "Re-rate patches only rating/searchableText/updatedAt, preserves original metadata and savedAt"

patterns-established:
  - "Library item upsert: query by_user_openalexId -> patch or insert"
  - "trimPaperData client-side before mutation to minimize wire payload"

requirements-completed: [LIB-01, LIB-02]

# Metrics
duration: 2min
completed: 2026-02-28
---

# Phase 22 Plan 01: Schema & Rating Bridge - Backend Foundation Summary

**libraryItems Convex table with 15 fields, 6 indexes, trimPaperData utility extracting 10 OpenAlex Work fields to under 1.5 KB, and saveToLibrary upsert mutation with requireAuth**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-28T21:32:36Z
- **Completed:** 2026-02-28T21:34:53Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- TrimmedPaperData interface with 10 explicitly typed fields shared between client and Convex
- trimPaperData pure function extracting slim metadata from full OpenAlex Work objects (7 tests passing)
- libraryItems schema table with 5 regular indexes + 1 search index (all Phase 23 indexes included upfront)
- saveToLibrary upsert mutation with requireAuth, compound index dedup, and searchableText construction

## Task Commits

Each task was committed atomically:

1. **Task 1: Define TrimmedPaperData type, trimPaperData utility, and RED tests**
   - `abe3236` (test) - TrimmedPaperData type + 7 failing test cases
   - `8a189f5` (feat) - trimPaperData implementation, all tests pass
2. **Task 2: Add libraryItems schema table and saveToLibrary upsert mutation** - `78d5104` (feat)

## Files Created/Modified
- `lib/types/library.types.ts` - TrimmedPaperData interface with 10 fields (shared type)
- `lib/library/trim-paper-data.ts` - Pure function extracting 10 metadata fields from OpenAlex Work
- `tests/library/trim-paper-data.test.ts` - 7 test cases covering full extraction, minimal work, fallback, authors, size
- `convex/schema.ts` - Added libraryItems table with 15 fields, 5 regular indexes, 1 search index
- `convex/library/mutations.ts` - saveToLibrary upsert mutation with requireAuth and searchableText

## Decisions Made
- Used slim typed fields instead of `v.any()` blob -- enforces 1-2 KB document size at schema level and enables Convex type validation
- Defined all Phase 23 indexes upfront (by_user, by_user_openalexId, by_user_rating, by_user_savedAt, by_user_year, search_library) -- zero cost until queried, avoids second schema migration
- Added `searchableText` concatenated field (title + abstract + authors) for Phase 23 full-text search
- Re-rate behavior: only patches rating, searchableText, and updatedAt -- preserves original metadata fields and savedAt timestamp
- `trimPaperData` placed in `lib/library/` (client-side) rather than `convex/lib/` since it operates on browser-side Work objects before sending to mutation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema table and mutation ready for Plan 02 (client-side RatingSelector bridge)
- `trimPaperData` available for import in React components
- All indexes pre-defined for Phase 23 library UI (search, filtering, sorting)
- Convex typecheck passes cleanly

## Self-Check: PASSED

All 4 created files verified on disk. All 3 task commits verified in git history.

---
*Phase: 22-schema-rating-bridge*
*Completed: 2026-02-28*
