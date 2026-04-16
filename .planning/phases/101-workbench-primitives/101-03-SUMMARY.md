---
phase: 101-workbench-primitives
plan: 03
subsystem: ui
tags: [workbench-shell, toolbar, view-switcher, column-visibility, filter-section, tanstack-react-table, zustand, animation]

requires:
  - phase: 101-workbench-primitives
    plan: 01
    provides: useExtractionResultsViewStore, createWorkbenchColumns, WorkbenchPaper, ExtractionQuestion
  - phase: 101-workbench-primitives
    plan: 02
    provides: WorkbenchDataTable renderer
provides:
  - WorkbenchShell (single useReactTable owner, toolbar + animated view slot)
  - WorkbenchToolbar (FilterSection-wrapped filter groups, view switcher, column visibility)
  - ViewSwitcher (segmented control reusing CompactIconToggleGroup)
  - ColumnVisibilityToggle (popover with toggle-all and per-column checkboxes)
affects: [103-workbench-views]

tech-stack:
  added: []
  patterns: [Updater<VisibilityState> bridge to plain-value Zustand setter, hydration guard with skeleton, AnimatePresence view transitions with reduced-motion support, isColumnFilterActive utility for FilterSection isActive derivation]

key-files:
  created:
    - components/extraction/workbench-shell.tsx
    - components/extraction/workbench-toolbar.tsx
    - components/extraction/view-switcher.tsx
    - components/extraction/column-visibility-toggle.tsx
  modified: []

decisions:
  - Updater bridge pattern: TanStack onColumnVisibilityChange passes Updater<VisibilityState> (value or function); wrapped with useCallback to resolve before calling Zustand's plain-value setColumnVisibility
  - Extracted WorkbenchShellInner to avoid hooks-after-early-return; outer component handles hydration guard, inner renders full UI
  - FilterSection reused directly from components/shared/filter-section.tsx without modification per WB-10

metrics:
  duration: 218s
  completed: 2026-04-16T10:02:47Z
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 0
---

# Phase 101 Plan 03: Workbench Shell, Toolbar, and View Components Summary

WorkbenchShell owns the single useReactTable instance and composes toolbar + animated view transitions with Zustand-persisted column visibility and active view.

## What Was Built

### Task 1: ViewSwitcher and ColumnVisibilityToggle
- **ViewSwitcher** reuses `CompactIconToggleGroup` with three options (table/card/split), each with lucide icons and i18n labels
- **ColumnVisibilityToggle** renders a Popover with a toggle-all checkbox, separator, and scrollable per-column checkboxes (max-h-[300px], w-[220px])
- Both components are controlled (value/onChange props) with no internal state

### Task 2: WorkbenchToolbar with FilterSection Wrappers
- Horizontal toolbar with `bg-card/80 backdrop-blur-sm` styling
- Four filter groups each wrapped in `FilterSection` for consistent cross-page chrome (WB-10): status (Select), confidence (Select), year (Input), venue (Input)
- `isColumnFilterActive` utility derives `FilterSection.isActive` from TanStack column filter state
- ViewSwitcher and ColumnVisibilityToggle composed with vertical separators

### Task 3: WorkbenchShell -- Single useReactTable Owner
- Owns the single `useReactTable` instance with `getCoreRowModel`, `getSortedRowModel`, `getFilteredRowModel`
- Reads `columnVisibility` and `activeView` from Zustand store; sorting and columnFilters in local state
- Columns memoized with `useMemo` keyed on `questions` (per D-04)
- Hydration guard renders skeleton until `_hasHydrated` is true
- `AnimatePresence mode="wait"` with `subtleSpring` transitions and `useReducedMotion` support
- Table view renders `WorkbenchDataTable`; card and split views render placeholder text for Phase 103
- No `createContext`/`useContext` -- table passed via props only (per D-01)
- `Updater<VisibilityState>` bridge resolves TanStack's function-or-value updater before calling Zustand's plain-value `setColumnVisibility`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updater<VisibilityState> type mismatch**
- **Found during:** Task 3
- **Issue:** TanStack Table's `onColumnVisibilityChange` passes `Updater<VisibilityState>` (value or function), but the Zustand store's `setColumnVisibility` only accepts a plain `Record<string, boolean>` value
- **Fix:** Created `handleColumnVisibilityChange` callback that resolves functional updaters before forwarding to the store
- **Files modified:** components/extraction/workbench-shell.tsx
- **Commit:** 99a70d6

**2. [Rule 1 - Bug] Hooks-after-early-return violation**
- **Found during:** Task 3
- **Issue:** React hooks cannot be called conditionally (after the hydration guard early return)
- **Fix:** Extracted `WorkbenchShellInner` component that contains all hooks; outer `WorkbenchShell` handles hydration guard only
- **Files modified:** components/extraction/workbench-shell.tsx
- **Commit:** 99a70d6

## Verification

- `npx tsc --noEmit`: zero errors (only pre-existing test file regex flag warning)
- All 4 component files exist and export named components
- WorkbenchShell uses `useReactTable` (not any other table library)
- WorkbenchShell does NOT use `createContext` (per D-01)
- WorkbenchToolbar uses `FilterSection` from `components/shared/filter-section.tsx` (per WB-10)
- ViewSwitcher uses `CompactIconToggleGroup` (per UI-SPEC)
- 17 regression tests pass (8 store tests + 9 column tests)

## Self-Check: PASSED

All 4 created files verified on disk. All 3 task commits verified in git log (f42c8cd, 685081b, 99a70d6).
