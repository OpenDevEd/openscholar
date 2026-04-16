---
phase: 103-workbench-views-selector-page
plan: 04
subsystem: extraction-workbench-views
tags: [virtualization, split-view, evidence-drawer, parsing-source, tanstack-virtual]
dependency_graph:
  requires: [103-01]
  provides: [card-view, split-view, split-view-row, evidence-drawer]
  affects: [workbench-shell, extraction-results-client]
tech_stack:
  added: ["@tanstack/react-virtual@3.13.23"]
  patterns: [virtual-list-dynamic-heights, fixed-split-layout, sheet-drawer-single-mount]
key_files:
  created:
    - components/extraction/card-view.tsx
    - components/extraction/split-view.tsx
    - components/extraction/split-view-row.tsx
    - components/extraction/evidence-drawer.tsx
  modified: []
decisions:
  - "Cast WorkbenchPaper._id to Id<extractionPapers> at component boundary (WorkbenchPaper uses string, PaperResultCard requires branded Id)"
  - "Defined EvidenceDrawerData interface locally in evidence-drawer.tsx since Plan 03 (parallel wave) has not yet exported EvidenceDrawerProps from workbench-shell.tsx"
metrics:
  duration: "4m 44s"
  completed: "2026-04-16T13:07:33Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 2
---

# Phase 103 Plan 04: Workbench View Components Summary

Virtualized CardView with @tanstack/react-virtual for 1000-card performance, 40/60 SplitView with paginated left panel, and Sheet-based EvidenceDrawer with verbatim slice and parsingSource badge across all surfaces.

## Completed Tasks

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Install @tanstack/react-virtual + CardView component | cb116df | components/extraction/card-view.tsx, package.json, pnpm-lock.yaml |
| 2 | SplitView, SplitViewRow, and EvidenceDrawer components | e44f3fb | components/extraction/split-view.tsx, components/extraction/split-view-row.tsx, components/extraction/evidence-drawer.tsx |

## Requirements Coverage

| Req | Description | Status |
|-----|-------------|--------|
| WB-05 | Card view virtualized for 1000 cards | Done - useVirtualizer with 280px estimate, overscan 5, measureElement |
| WB-06 | Split view with paginated list + detail | Done - 40/60 fixed split, page size 10, scroll-to-top on selection |
| WB-07 | Evidence drawer with verbatim slice | Done - Sheet side=right, EvidenceQuote, metadata sections |
| GAP-01 | parsingSource badge in all views | Done - badge in SplitViewRow and EvidenceDrawer |

## Implementation Details

### CardView (WB-05)
- Single-column virtualized list via `@tanstack/react-virtual@3.13.23`
- `estimateSize: () => 280` with `measureElement` for dynamic height measurement
- `overscan: 5` rows above and below viewport
- Every virtual item has `data-index={virtualRow.index}` (Pitfall 1 prevention)
- `scrollToIndex(0)` on `rows.length` change (Pitfall 2 prevention)
- No grid layout (D-03)

### SplitView (WB-06)
- Fixed 40%/60% split, not resizable (D-06)
- Left panel paginated at page size 10 (D-05)
- Selected paper tracked via `useState<string | null>(null)` (D-04)
- Right panel scrolls to top on paper change
- Empty state with icon when no paper selected

### SplitViewRow
- Compact row: StatusBadge + parsingSource Badge + truncated title
- Keyboard accessible: Enter/Space triggers selection, aria-selected
- Selected state: bg-accent + border-l-2 border-l-primary

### EvidenceDrawer (WB-07)
- Sheet side="right" following basket drawer pattern (D-08)
- Sections: question text, EvidenceQuote verbatim slice, parsingSource badge, model used, critic verdict
- 20px padding exception (px-5 py-4) per UI-SPEC
- 24px section spacing (space-y-6) per UI-SPEC
- sr-only SheetDescription for accessibility

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] WorkbenchPaper._id type mismatch with PaperResultCard**
- **Found during:** Task 1
- **Issue:** `WorkbenchPaper._id` is typed as `string` but `PaperResultCard` requires `Id<"extractionPapers">` (branded type). Passing `paper` directly from TanStack Table rows causes TS2322.
- **Fix:** Cast `paper._id as Id<"extractionPapers">` at the component boundary in CardView and SplitView. The data originates from Convex queries and IS a valid Id at runtime.
- **Files modified:** components/extraction/card-view.tsx, components/extraction/split-view.tsx
- **Commit:** cb116df, e44f3fb

**2. [Rule 3 - Blocking] EvidenceDrawerProps interface not available from parallel Plan 03**
- **Found during:** Task 2
- **Issue:** Plan references `import type { EvidenceDrawerProps } from "@/components/extraction/workbench-shell"` but this interface is defined in Plan 03 which runs in the same parallel wave and hasn't been merged yet.
- **Fix:** Defined `EvidenceDrawerData` interface locally in evidence-drawer.tsx with the same shape. Plan 05 (integration) will reconcile when wiring the components together.
- **Files modified:** components/extraction/evidence-drawer.tsx
- **Commit:** e44f3fb

## Verification Results

1. `tsc --noEmit` exits 0
2. `pnpm ls @tanstack/react-virtual` shows 3.13.23
3. CardView uses useVirtualizer with data-index and measureElement
4. SplitView renders 40/60 fixed split with left panel pagination
5. EvidenceDrawer shows verbatim text and parsingSource badge

## Self-Check: PASSED

- All 4 created files exist on disk
- Both commit hashes (cb116df, e44f3fb) verified in git log
- SUMMARY.md created at expected path
