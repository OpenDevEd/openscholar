---
phase: 101-workbench-primitives
plan: 02
subsystem: ui
tags: [tanstack-react-table, shadcn-table, flexRender, i18n, next-intl, data-table]

# Dependency graph
requires:
  - phase: none
    provides: shadcn Table primitives (pre-existing)
provides:
  - "@tanstack/react-table installed at ^8.21.3"
  - "WorkbenchDataTable generic renderer bridging TanStack Table to shadcn Table"
  - "extraction.workbench.* i18n keys in all 6 locale files"
affects: [101-03, 103-workbench-views]

# Tech tracking
tech-stack:
  added: ["@tanstack/react-table@^8.21.3"]
  patterns: ["flexRender bridge from TanStack headless to shadcn Table primitives", "sort indicator icons with hover-reveal pattern", "sticky table header with bg-card z-10"]

key-files:
  created:
    - components/extraction/workbench-data-table.tsx
  modified:
    - package.json
    - package-lock.json
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/ja.json
    - messages/zh.json
    - messages/hi.json

key-decisions:
  - "Font-semibold on TableHead overrides shadcn default font-medium per UI-SPEC two-weight system"
  - "Empty state distinguishes filters-active (noResults) from no-data (noData) via columnFilters.length check"

patterns-established:
  - "TanStack-to-shadcn bridge: flexRender maps headerGroups and rowModel to Table/TableHeader/TableBody/TableRow/TableHead/TableCell"
  - "Sort indicators: ArrowUp (asc, text-primary), ArrowDown (desc, text-primary), ArrowUpDown (unsorted, opacity-0 group-hover:opacity-100)"

requirements-completed: [WB-01, WB-10]

# Metrics
duration: 5min
completed: 2026-04-16
---

# Phase 101 Plan 02: TanStack Table + DataTable Renderer + i18n Summary

**TanStack React Table installed, generic WorkbenchDataTable renderer bridging headless API to shadcn Table primitives with sort indicators and sticky header, workbench i18n keys seeded across all 6 locales**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-16T09:48:59Z
- **Completed:** 2026-04-16T09:54:04Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Installed @tanstack/react-table@^8.21.3 as the sole net-new runtime dependency for the workbench
- Created WorkbenchDataTable generic component that renders TanStack Table header groups and rows into shadcn Table primitives via flexRender, with sticky header, sort direction indicators, font-semibold headers, 48px row height, and localized empty states
- Seeded extraction.workbench.* i18n keys (16 keys each) in all 6 locale files (en-US, en-GB with English, fr with French translations, ja/zh/hi with English placeholders per project convention)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install TanStack React Table and seed i18n keys** - `2f0d00f` (feat)
2. **Task 2: WorkbenchDataTable renderer component** - `efcdd6d` (feat)

## Files Created/Modified
- `package.json` - Added @tanstack/react-table@^8.21.3 dependency
- `package-lock.json` - Updated lockfile with TanStack Table and table-core packages
- `components/extraction/workbench-data-table.tsx` - Generic DataTable renderer bridging TanStack Table to shadcn Table primitives via flexRender
- `messages/en-US.json` - Added extraction.workbench.* keys (English)
- `messages/en-GB.json` - Added extraction.workbench.* keys (English)
- `messages/fr.json` - Added extraction.workbench.* keys (French)
- `messages/ja.json` - Added extraction.workbench.* keys (English placeholder)
- `messages/zh.json` - Added extraction.workbench.* keys (English placeholder)
- `messages/hi.json` - Added extraction.workbench.* keys (English placeholder)

## Decisions Made
- Overrode shadcn TableHead default `font-medium` with `font-semibold` per UI-SPEC two-weight typography system (regular body + semibold headers)
- Empty state uses columnFilters.length to distinguish "no results matching filters" (noResults message with suggestion to adjust) from "no data at all" (noData message)
- Sort indicators use inline-flex wrapper for alignment: ArrowUp/ArrowDown shown when sorted, ArrowUpDown hidden by default and revealed on group-hover with opacity transition

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TanStack React Table is installed and importable
- WorkbenchDataTable accepts any `TanStackTable<T>` instance via generics -- ready for Phase 101-03 (WorkbenchShell + columns) and Phase 103 (table view integration)
- All workbench i18n keys available for toolbar and filter components in 101-03

## Self-Check: PASSED

- [x] components/extraction/workbench-data-table.tsx exists
- [x] All 6 locale files contain extraction.workbench.* keys
- [x] Commit 2f0d00f exists (Task 1)
- [x] Commit efcdd6d exists (Task 2)
- [x] 101-02-SUMMARY.md exists

---
*Phase: 101-workbench-primitives*
*Completed: 2026-04-16*
