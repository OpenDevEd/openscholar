---
phase: 103-workbench-views-selector-page
plan: 03
subsystem: ui
tags: [pagination, search, debounce, export, tanstack-table]

requires:
  - phase: 103-01
    provides: i18n keys for workbench pagination, search, and export; Zustand store v2 with pageSize; export query with paperIds filter

provides:
  - WorkbenchShell enhanced with pagination (getPaginationRowModel), globalFilter, evidence drawer state mount
  - PaginationControls component with "Showing X-Y of Z papers" and Previous/Next buttons
  - Toolbar search input with layered debounce (useDebouncedValue 300ms + useDeferredValue)
  - Toolbar export dropdown with CSV/JSON/XLSX reading filtered row model for filtered export

affects: [103-04, 103-05]

tech-stack:
  added: []
  patterns: [useDeferredValue + useDebouncedValue layered debounce for search, getPaginationRowModel with autoResetPageIndex, useConvex().query() for on-demand export]

key-files:
  created:
    - components/extraction/pagination-controls.tsx
  modified:
    - components/extraction/workbench-shell.tsx
    - components/extraction/workbench-toolbar.tsx

key-decisions:
  - "Layered debounce: useDebouncedValue(300ms) followed by useDeferredValue yields to user interactions during filter storms (T-103-08 mitigation)"
  - "Evidence drawer state kept as local WorkbenchShellInner state with void references; Plan 04 wires into CardView/SplitView/EvidenceDrawer"
  - "PaginationControls created in Task 1 (Rule 3 deviation) because workbench-shell.tsx imports it"
  - "Export dropdown uses export.exportFailed i18n key for error toast, not export.incompleteWarning"

patterns-established:
  - "PaginationControls: aria-live polite region for screen reader announcements of page changes"
  - "44px (h-11) touch target on pagination buttons for mobile accessibility"
  - "Filtered export: hasActiveFilters check sends filtered paperIds to backend query"

requirements-completed: [WB-04, WB-09]

duration: 5min
completed: 2026-04-16
---

# Phase 103 Plan 03: Workbench Enhancements Summary

**Pagination with getPaginationRowModel and autoResetPageIndex, global search via layered useDebouncedValue + useDeferredValue debounce, PaginationControls component, toolbar search input with clear button, and export dropdown reading filtered row model for CSV/JSON/XLSX**

## Performance

- **Duration:** 5m 21s
- **Started:** 2026-04-16T13:30:54Z
- **Completed:** 2026-04-16T13:36:15Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- Enhanced WorkbenchShell with `getPaginationRowModel`, `globalFilter` state, `PaginationState`, `autoResetPageIndex: true`, and `globalFilterFn: "includesString"` in useReactTable config
- Exported `EvidenceDrawerProps` interface and added `openEvidence` callback + `drawerState` for single-mount evidence drawer pattern (D-08)
- Created `PaginationControls` component rendering "Showing X-Y of Z papers" text with Previous/Next buttons, `aria-live="polite"` for accessibility, and 44px touch targets
- Added search input to toolbar with layered debounce: `useDebouncedValue(searchInput, 300)` -> `useDeferredValue(debouncedSearch)` -> `table.setGlobalFilter(deferredSearch)` (D-15, D-16, T-103-08)
- Added export dropdown to toolbar with CSV/JSON/XLSX items, incomplete job warning, and filtered paper count note when active filters present (D-19, D-20)
- Export handler uses `useConvex().query()` pattern for on-demand fetch with optional `paperIds` filter from filtered row model

## Task Commits

Each task was committed atomically:

1. **Task 1: WorkbenchShell enhancements -- pagination, globalFilter, evidence drawer state** - `9bef499` (feat)
2. **Task 2: Toolbar search input with layered debounce and export dropdown** - `7f56109` (feat)

## Files Created/Modified

- `components/extraction/pagination-controls.tsx` - New component: "Showing X-Y of Z papers" with Previous/Next, aria-live, 44px touch targets
- `components/extraction/workbench-shell.tsx` - Enhanced with getPaginationRowModel, globalFilter, PaginationState, EvidenceDrawerProps, openEvidence, PaginationControls mount
- `components/extraction/workbench-toolbar.tsx` - Added search input (layered debounce), export dropdown (CSV/JSON/XLSX), jobId/jobStatus props

## Decisions Made

- Layered debounce pattern (useDebouncedValue 300ms + useDeferredValue) prevents rapid re-renders and yields to user interactions during filter storms, mitigating T-103-08 DoS threat
- Evidence drawer state (`drawerState`, `openEvidence`) prepared as local state in WorkbenchShellInner with void references; Plan 04 will wire them into actual CardView/SplitView/EvidenceDrawer components
- PaginationControls component created during Task 1 (Rule 3: blocking import) rather than waiting for Task 2
- Export error toast uses `export.exportFailed` key for failed exports, while `export.incompleteWarning` is used for the incomplete job warning banner in the dropdown

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] PaginationControls created in Task 1**
- **Found during:** Task 1
- **Issue:** `workbench-shell.tsx` imports `PaginationControls` which did not exist yet; TypeScript would fail
- **Fix:** Created `pagination-controls.tsx` in Task 1 instead of Task 2
- **Files modified:** `components/extraction/pagination-controls.tsx`
- **Commit:** `9bef499`

**2. [Rule 3 - Blocking] WorkbenchToolbar props updated in Task 1**
- **Found during:** Task 1
- **Issue:** `workbench-shell.tsx` passes `jobId` and `jobStatus` props to WorkbenchToolbar which did not accept them
- **Fix:** Added `jobId` and `jobStatus` to WorkbenchToolbarProps interface in Task 1 with void references
- **Files modified:** `components/extraction/workbench-toolbar.tsx`
- **Commit:** `9bef499`

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| Card view placeholder text | `workbench-shell.tsx` | 194 | Intentional: Plan 04 creates CardView component |
| Split view placeholder text | `workbench-shell.tsx` | 208 | Intentional: Plan 04 creates SplitView component |
| Evidence drawer commented out | `workbench-shell.tsx` | 218 | Intentional: Plan 04 creates EvidenceDrawer component |

These stubs do not prevent Plan 03's goals (pagination + search + export) from being achieved. Plan 04 (wave 2 parallel) replaces all three with actual components.

## Threat Surface Scan

No new threat surface introduced beyond what was already documented in the plan's threat model:
- T-103-07 (export with crafted paperIds): Mitigated server-side by `by_job` index scoping
- T-103-08 (globalFilter on 1000 rows): Mitigated by layered debounce (useDebouncedValue 300ms + useDeferredValue)

---
*Phase: 103-workbench-views-selector-page*
*Completed: 2026-04-16*
