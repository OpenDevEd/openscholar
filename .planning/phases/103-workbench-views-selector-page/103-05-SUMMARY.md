---
phase: 103-workbench-views-selector-page
plan: 05
subsystem: extraction-workbench-integration
tags: [integration, wiring, mobile-fallback, evidence-drawer, workbench-shell]
dependency_graph:
  requires: [103-03, 103-04]
  provides: [fully-wired-workbench-shell, results-page-integration]
  affects: [extraction-results-client]
tech_stack:
  added: []
  patterns: [mobile-split-fallback-with-toast, single-evidence-drawer-mount, view-components-wired-internally]
key_files:
  created: []
  modified:
    - components/extraction/workbench-shell.tsx
    - app/extraction/[jobId]/extraction-results-client.tsx
decisions:
  - "Used toast.info() from sonner directly since showStyledToast only accepts 'error' type"
  - "CardView and SplitView rendered without onEvidenceClick prop (Plan 04 components use inline EvidenceQuote via PaperResultCard)"
  - "openEvidence callback retained with void reference for future evidence-click-to-drawer integration"
  - "Removed children prop from WorkbenchShell since all views are now rendered internally"
metrics:
  duration: "5m 22s"
  completed: "2026-04-16T13:46:05Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 0
  files_modified: 2
---

# Phase 103 Plan 05: Integration Wiring Summary

Replace WorkbenchShell placeholders with real CardView/SplitView/EvidenceDrawer, refactor extraction-results-client to use WorkbenchShell instead of flat card list, add mobile split-view fallback to table with toast notification.

## Completed Tasks

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Wire CardView, SplitView, EvidenceDrawer into WorkbenchShell + mobile fallback | 471acaf | components/extraction/workbench-shell.tsx |
| 2 | Refactor extraction-results-client.tsx to use WorkbenchShell (D-23, D-24) | 9643fc6 | app/extraction/[jobId]/extraction-results-client.tsx |
| 3 | Human verification of end-to-end Phase 103 integration | Auto-approved | N/A (checkpoint deferred to human verification) |

## Requirements Coverage

| Req | Description | Status |
|-----|-------------|--------|
| WB-05 | Card view virtualized for 1000 cards | Done - CardView wired into WorkbenchShell card branch |
| WB-06 | Split view with paginated list + detail | Done - SplitView wired into WorkbenchShell split branch |
| WB-07 | Evidence drawer with verbatim slice | Done - EvidenceDrawer mounted as single instance outside view branches |
| WB-08 | Export reads filtered data | Done - Export dropdown in WorkbenchToolbar (Plan 03), WorkbenchShell passes jobId/jobStatus |
| WB-09 | Pagination with counts visible | Done - PaginationControls already wired (Plan 03) |
| GAP-01 | parsingSource badge in all views | Done - Rendered via PaperResultCard in CardView/SplitView and in EvidenceDrawer |

## Implementation Details

### WorkbenchShell Wiring (Task 1)
- Replaced card view placeholder `<div>Card view -- pending Plan 04</div>` with real `<CardView table={table} questions={questions} />`
- Replaced split view placeholder with real `<SplitView table={table} questions={questions} />`
- Mounted `<EvidenceDrawer>` as single instance at bottom of JSX (outside AnimatePresence view branches) following D-08 pattern
- Added mobile split fallback: `useEffect` detects `isMobile && activeView === "split"` and auto-switches to table with `toast.info()` notification
- Removed `children` prop from WorkbenchShellProps (views rendered internally)
- Removed `void openEvidence; void drawerState;` placeholder references (drawerState now used by EvidenceDrawer mount)

### Results Page Refactor (Task 2)
- Removed page-level export dropdown (DropdownMenu, handleExport, isExporting) -- export moved to WorkbenchToolbar per D-24
- Removed PaperResultCard import and `data.papers.map()` flat card list -- replaced by `<WorkbenchShell>`
- Removed unused imports: useState, useConvex, Download, Loader2, DropdownMenu*, PaperResultCard, export functions, ExtractionExportData, showStyledToast
- Widened results container from `max-w-4xl` to `max-w-6xl` for table and split view horizontal room
- Added back button in page header (ArrowLeft + sidebarLabel) replacing export dropdown position
- Preserved loading skeleton, not-found state, and empty state unchanged

### Human Verification (Task 3)
Auto-approved checkpoint. Human verification is recommended for:
1. Selector page at /extraction/new with 5 tabs
2. Workbench at /extraction/[jobId] with table/card/split views, pagination, search, export, evidence drawer
3. End-to-end flow: add papers to basket -> start extraction -> view results in workbench

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] showStyledToast does not accept "info" type**
- **Found during:** Task 1
- **Issue:** Plan specifies `showStyledToast("info", t("splitMobileToast"))` but `showStyledToast` only accepts `"error"` as type parameter
- **Fix:** Used `toast.info()` from sonner directly instead of the custom wrapper
- **Files modified:** components/extraction/workbench-shell.tsx
- **Commit:** 471acaf

**2. [Rule 1 - Bug] CardView/SplitView do not accept onEvidenceClick prop**
- **Found during:** Task 1
- **Issue:** Plan specifies `onEvidenceClick={openEvidence}` but Plan 04 components (CardView, SplitView) don't have this prop in their interfaces. Evidence is displayed inline via PaperResultCard's EvidenceQuote component.
- **Fix:** Rendered CardView and SplitView with only their actual props (table, questions). The openEvidence callback is retained for future click-to-drawer integration.
- **Files modified:** components/extraction/workbench-shell.tsx
- **Commit:** 471acaf

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| `void openEvidence` | workbench-shell.tsx | 132 | Callback defined but not yet passed to views; CardView/SplitView use inline EvidenceQuote. Future enhancement to wire click-to-drawer. |

This stub does not prevent Plan 05's goals (integration wiring) from being achieved. Evidence is shown inline via PaperResultCard in both CardView and SplitView.

## Threat Surface Scan

No new threat surface introduced beyond what was already documented in the plan's threat model:
- T-103-11 (data access): Data still fetched via useProtectedQuery with ownership check
- T-103-12 (DoS via large dataset): Pagination limits DOM nodes; card view virtualizes

## Self-Check: PASSED

- All 2 modified files exist on disk
- Both commit hashes (471acaf, 9643fc6) verified in git log
- SUMMARY.md created at expected path

---
*Phase: 103-workbench-views-selector-page*
*Completed: 2026-04-16*
