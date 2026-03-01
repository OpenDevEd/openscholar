---
phase: 34-display-polish-and-validation
plan: "01"
subsystem: ui
tags: [convex, nuqs, i18n, pagination, sort]

# Dependency graph
requires:
  - phase: 33-library-page-ui-overhaul
    provides: Library page with SidebarLayout, browseLibrary query, search params
provides:
  - by_user_title Convex index on libraryItems table
  - "title" sort option in browseLibrary and exportLibrary queries
  - Page number (p) URL param for pagination data layer
  - i18n keys for title sort and pagination display in 6 locales
affects: [34-02-PLAN, library-page-client, library-filter-sidebar]

# Tech tracking
tech-stack:
  added: []
  patterns: [Convex index per sort field, nuqs parseAsInteger for page param]

key-files:
  created: []
  modified:
    - convex/schema.ts
    - convex/library/queries.ts
    - lib/library/search-params.ts
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/hi.json
    - messages/ja.json
    - messages/zh.json

key-decisions:
  - "Placed by_user_title index before searchIndex in schema for consistent ordering"
  - "Page param uses key 'p' with default value 1 for compact URLs"

patterns-established:
  - "Sort option addition pattern: schema index + query indexMap + search params + i18n"

requirements-completed: [DISP-01, DISP-02, DISP-03]

# Metrics
duration: 2min
completed: 2026-03-01
---

# Phase 34 Plan 01: Title Sort Option + Pagination Data Layer Summary

**Added "title" as fourth sort option with Convex by_user_title index, pagination page param via nuqs, and i18n keys across 6 locales**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-01T12:24:50Z
- **Completed:** 2026-03-01T12:27:28Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Added `by_user_title` index on libraryItems table for title-based sorting
- Extended browseLibrary and exportLibrary queries to accept "title" as sortBy value
- Added "title" to `librarySortValues` and page number param `p` to URL search params
- Added `sortTitle`, `showingRange`, `previousPage`, `nextPage` i18n keys in all 6 locale files

## Task Commits

Each task was committed atomically:

1. **Task 1: Add by_user_title index, extend queries, update search params** - `e8f23b5` (feat)
2. **Task 2: Add i18n keys for title sort and pagination in all 6 locales** - `9d9b7ee` (feat)

## Files Created/Modified
- `convex/schema.ts` - Added by_user_title index on libraryItems table
- `convex/library/queries.ts` - Added "title" to sortBy validators and indexMaps in browseLibrary and exportLibrary
- `lib/library/search-params.ts` - Added "title" to librarySortValues, added `p` page param
- `messages/en-US.json` - Added sortTitle, showingRange, previousPage, nextPage keys
- `messages/en-GB.json` - Added sortTitle, showingRange, previousPage, nextPage keys
- `messages/fr.json` - Added French translations for sort and pagination keys
- `messages/hi.json` - Added Hindi translations for sort and pagination keys
- `messages/ja.json` - Added Japanese translations for sort and pagination keys
- `messages/zh.json` - Added Chinese translations for sort and pagination keys

## Decisions Made
- Placed `by_user_title` index before the `searchIndex` call in schema, maintaining the existing pattern of database indexes followed by search indexes
- Used `p` as the page param key for compact URLs, consistent with the short-key convention (`q`, `yf`, `yt`, `col`)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Title sort option is fully wired in the data layer (schema, queries, search params, i18n)
- Page param `p` is ready for pagination UI integration
- Plan 34-02 can now build the UI integration using these data layer primitives

## Self-Check: PASSED

All 9 modified files exist. Both task commits (e8f23b5, 9d9b7ee) verified in git log. SUMMARY.md present.

---
*Phase: 34-display-polish-and-validation*
*Completed: 2026-03-01*
