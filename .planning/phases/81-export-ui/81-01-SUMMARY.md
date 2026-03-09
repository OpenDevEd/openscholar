---
phase: 81-export-ui
plan: 01
subsystem: ui
tags: [react, next-intl, dropdown-menu, screening, export, i18n]

# Dependency graph
requires:
  - phase: 79-export-query
    provides: getScreeningResultsForExport Convex query
  - phase: 80-export-functions
    provides: exportScreeningToCSV/JSON/XLSX pure functions
provides:
  - Export dropdown UI on screening job history cards
  - Translation keys for export UI in 6 locales
  - Translation key coverage test
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline IIFE for conditional rendering with local variables in JSX"
    - "stopPropagation wrapper for interactive elements inside clickable cards"

key-files:
  created:
    - tests/export-screening-ui.test.ts
  modified:
    - components/screening/screening-job-history.tsx
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/ja.json
    - messages/zh.json
    - messages/hi.json

key-decisions:
  - "Used IIFE pattern for inline conditional rendering with local computed vars"
  - "useConvex() direct query for on-demand export data fetch (no reactive subscription)"

patterns-established:
  - "Export dropdown pattern: ghost icon-xs button with DropdownMenu for format selection"

requirements-completed: [UI-01, UI-02, UI-03, UI-04, UI-05, UI-06]

# Metrics
duration: 2min
completed: 2026-03-09
---

# Phase 81 Plan 01: Export UI Summary

**Export dropdown on screening job cards with CSV/JSON/XLSX format selection, loading states, incomplete-job warnings, and full i18n across 6 locales**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-09T08:08:41Z
- **Completed:** 2026-03-09T08:11:20Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Export dropdown button renders on non-in-progress job cards (completed, cancelled, failed, creditsExhausted)
- CSV, JSON, XLSX format options in dropdown with on-demand data fetch via useConvex().query()
- Loading spinner replaces download icon during export generation
- Warning message for incomplete jobs (cancelled, failed, creditsExhausted)
- All 6 export translation keys added to all 6 locale files
- Translation key coverage test verifying completeness across locales

## Task Commits

Each task was committed atomically:

1. **Task 1: Add export dropdown to screening job cards and i18n keys** - `e816043` (feat)
2. **Task 2: Add translation key coverage test** - `80f4a98` (test)

## Files Created/Modified
- `components/screening/screening-job-history.tsx` - Added export dropdown with handleExport, useConvex, loading/warning states
- `messages/en-US.json` - 6 export translation keys (English US)
- `messages/en-GB.json` - 6 export translation keys (English GB)
- `messages/fr.json` - 6 export translation keys (French)
- `messages/ja.json` - 6 export translation keys (Japanese)
- `messages/zh.json` - 6 export translation keys (Chinese)
- `messages/hi.json` - 6 export translation keys (Hindi)
- `tests/export-screening-ui.test.ts` - Translation key coverage test (3 test cases)

## Decisions Made
- Used IIFE pattern `{!isInProgress && (() => { ... })()}` for inline conditional rendering with local computed variables (isIncompleteJob, isExportingThis)
- Used `useConvex().query()` for on-demand export data fetch rather than reactive `useQuery` subscription -- export is a one-shot action, not continuous data

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Screening export feature is complete end-to-end: query (Phase 79) -> functions (Phase 80) -> UI (Phase 81)
- Ready for Phase 82 (star threshold simplification) which is independent of export

---
*Phase: 81-export-ui*
*Completed: 2026-03-09*
