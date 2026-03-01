---
phase: 29-library-export
plan: 01
subsystem: ui
tags: [convex, react, csv, json, export, i18n, library]

# Dependency graph
requires:
  - phase: 23-library-browse-search
    provides: "browseLibrary/searchLibrary queries, filter logic, library page"
  - phase: 25-collections
    provides: "Collection filter and junction table for collection-scoped exports"
provides:
  - "Non-paginated exportLibrary Convex query with all filter args"
  - "Client-side CSV/JSON export helpers reusing downloadAsFile/jsonToCSV"
  - "Export dropdown UI in library header with i18n for 6 locales"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-paginated .collect() query for bounded export (up to 1024 items)"
    - "Client-side file generation with downloadAsFile utility reuse"

key-files:
  created:
    - "lib/library/export.ts"
  modified:
    - "convex/library/queries.ts"
    - "components/library/library-page-client.tsx"
    - "messages/en-US.json"
    - "messages/en-GB.json"
    - "messages/fr.json"
    - "messages/hi.json"
    - "messages/ja.json"
    - "messages/zh.json"

key-decisions:
  - "Reuse existing downloadAsFile/jsonToCSV utilities -- no new dependencies"
  - "Non-paginated .collect() for export (1024 item limit acceptable per decision 23-01)"
  - "Strip _id, userId, searchableText from export; convert timestamps to ISO strings"

patterns-established:
  - "Library export format: date-stamped filenames, empty string for null optional fields"

requirements-completed: [EXP-01]

# Metrics
duration: 2min
completed: 2026-03-01
---

# Phase 29 Plan 01: Library Export Summary

**CSV and JSON export for library items with filter-aware non-paginated query and 6-locale i18n**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-01T06:57:53Z
- **Completed:** 2026-03-01T07:00:45Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Non-paginated `exportLibrary` Convex query supporting all existing filter args (sort, rating, date saved, year range, collection, search text)
- Client-side `exportLibraryAsCSV` and `exportLibraryAsJSON` helpers that strip internal fields and convert timestamps to ISO strings
- Export dropdown button in library header, hidden when library is empty or filters produce zero results
- All 4 new i18n keys added to all 6 locale files (en-US, en-GB, fr, hi, ja, zh)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add exportLibrary query and export helper module** - `090f613` (feat)
2. **Task 2: Wire export UI into library page with i18n** - `ac692c0` (feat)

## Files Created/Modified
- `convex/library/queries.ts` - Added exportLibrary non-paginated query with all filter args
- `lib/library/export.ts` - Created export formatting and download helpers (exportLibraryAsCSV, exportLibraryAsJSON)
- `components/library/library-page-client.tsx` - Added export dropdown button, query hook, and export handlers
- `messages/en-US.json` - Added 4 export i18n keys
- `messages/en-GB.json` - Added 4 export i18n keys
- `messages/fr.json` - Added 4 export i18n keys (French)
- `messages/hi.json` - Added 4 export i18n keys (Hindi)
- `messages/ja.json` - Added 4 export i18n keys (Japanese)
- `messages/zh.json` - Added 4 export i18n keys (Chinese)

## Decisions Made
- Reused existing `downloadAsFile` and `jsonToCSV` utilities from `lib/utils.ts` -- no new npm dependencies
- Used `.collect()` instead of `.paginate()` for export query, accepting 1024-item limit (consistent with decision [23-01])
- Strip internal fields (`_id`, `_creationTime`, `userId`, `searchableText`) from exported data -- user-facing fields only
- Convert `savedAt`/`updatedAt` from Unix timestamps to ISO date strings for universal parseability
- Empty string `""` for null/undefined optional fields (cleaner CSV output than "null")
- Date-stamped filenames (`library-export-2026-03-01.csv`) for human readability

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- EXP-01 requirement fully satisfied
- Phase 29 has only 1 plan; phase is complete
- Ready for Phase 30 or any subsequent gap closure work

## Self-Check: PASSED

- All 9 files exist on disk
- Both task commits found (090f613, ac692c0)
- exportLibrary query present in convex/library/queries.ts
- exportLibraryAsCSV and exportLibraryAsJSON exported from lib/library/export.ts
- All 4 i18n keys present in en-US.json (and all other locales)

---
*Phase: 29-library-export*
*Completed: 2026-03-01*
