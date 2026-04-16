# Phase 103: Workbench Views + Selector Page - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 103-workbench-views-selector-page
**Areas discussed:** Card View Virtualization, Split View Layout, Evidence Drawer, Selector Page Tabs, Client-Side Search, Pagination, Export Wiring, Results Page Refactoring
**Mode:** --auto (all decisions auto-selected with recommended defaults)

---

## Card View Virtualization

| Option | Description | Selected |
|--------|-------------|----------|
| Single-column virtualized list | @tanstack/react-virtual with dynamic row heights, reusing PaperResultCard | ✓ |
| Grid layout (2-3 columns) | Multi-column grid with synchronized row heights | |
| No virtualization (paginated only) | Rely on pagination alone, skip @tanstack/react-virtual | |

**User's choice:** [auto] Single-column virtualized list via @tanstack/react-virtual, reusing PaperResultCard
**Notes:** Grid layout rejected due to complex row-height synchronization across columns. Single column with variable-height cards is the proven pattern for @tanstack/react-virtual. Pagination-only rejected because WB-05 explicitly requires virtualization for Mobile Safari crash prevention at 1000 rows.

---

## Split View Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed 40/60 split | Paper list left, detail right, not resizable | ✓ |
| Resizable split | Drag handle between panels | |
| Collapsible panels | Click to collapse/expand either panel | |

**User's choice:** [auto] Fixed 40/60 split, paginated list left with selected-paper detail right
**Notes:** Resizable split adds a resize library dependency and complexity. Fixed split matches the read-heavy academic workflow. Falls back to table view on mobile.

---

## Evidence Drawer

| Option | Description | Selected |
|--------|-------------|----------|
| shadcn Sheet (right side) | Single mounted Sheet with verbatim slice + parsingSource badge + context | ✓ |
| Inline expandable panel | Expand evidence inline below the row/card | |
| Modal dialog | Centered modal overlay | |

**User's choice:** [auto] shadcn Sheet (right side) with verbatim slice + parsingSource badge + context
**Notes:** Sheet pattern already established by basket drawer. Single mount in WorkbenchShell avoids per-row DOM bloat. Inline expansion rejected because it shifts virtual list positions. Modal rejected because evidence is a secondary reference, not a blocking action.

---

## Selector Page Tabs

| Option | Description | Selected |
|--------|-------------|----------|
| shadcn Tabs with 4+1 tabs | Library, Collections, Search, Manual + disabled Zotero placeholder | ✓ |
| Step-by-step wizard | Sequential source selection steps | |
| Single list with source filter | Unified list filtered by source type | |

**User's choice:** [auto] shadcn Tabs component with 4 tabs reusing existing data queries per source
**Notes:** Wizard explicitly rejected in REQUIREMENTS.md out-of-scope ("breaks persistent-basket pattern"). Single filtered list doesn't work because sources have different query shapes and interaction patterns.

---

## Client-Side Search

| Option | Description | Selected |
|--------|-------------|----------|
| TanStack globalFilter + useDeferredValue | Debounced search across title, DOI, answers | ✓ |
| Server-side search query | Convex search index | |
| Client-side Fuse.js | Fuzzy search library | |

**User's choice:** [auto] TanStack Table globalFilter with useDeferredValue debounce
**Notes:** WB-04 explicitly requires client-side search with useDeferredValue. Server-side search adds unnecessary round trips when all data is already loaded. Fuse.js adds a dependency for marginal fuzzy benefit.

---

## Pagination

| Option | Description | Selected |
|--------|-------------|----------|
| TanStack getPaginationRowModel, 25 rows/page | Shared across views, reset on filter change | ✓ |
| Infinite scroll | Load more on scroll | |
| Server-side pagination | Convex cursor-based pagination | |

**User's choice:** [auto] TanStack Table getPaginationRowModel, 25 rows/page, shared across all views
**Notes:** Infinite scroll explicitly rejected in REQUIREMENTS.md out-of-scope. Server-side pagination unnecessary since Phase 98 benchmark confirmed 1000-paper payload fits under 5 MB — all data loads in one query.

---

## Export Wiring

| Option | Description | Selected |
|--------|-------------|----------|
| Filter via table.getFilteredRowModel() | Export matches current filter state | ✓ |
| Export all regardless of filters | Ignore filter state for exports | |
| Client-side filter + generate | Filter in browser, pass to existing export functions | |

**User's choice:** [auto] Export uses table.getFilteredRowModel() to build subset, passed to existing export functions
**Notes:** WB-08 explicitly requires "currently-filtered result subset" export. Requires small backend addition (optional paperIds param on getExtractionResultsForExport).

---

## Results Page Refactoring

| Option | Description | Selected |
|--------|-------------|----------|
| Replace body with WorkbenchShell | Keep loading/error/empty states, swap results section | ✓ |
| Build new page from scratch | Create entirely new results page component | |
| Wrap existing in WorkbenchShell | Keep existing card list as default, add shell around it | |

**User's choice:** [auto] Replace ExtractionResultsClient body with WorkbenchShell, keep loading/error/empty states
**Notes:** The existing page has well-structured loading/error/empty states. Only the results rendering section (lines 132-184) needs replacement. Building from scratch would duplicate the guard logic unnecessarily.

---

## Claude's Discretion

- Exact Tailwind styling for split view panels and divider
- Evidence drawer width
- Empty state illustrations/copy for each selector tab
- Manual IDs textarea font choice
- Animation transitions for evidence drawer
- Search input placeholder text
- Collections tab grouping/display
- Page size selector UI
- Test file organization

## Deferred Ideas

None — discussion stayed within phase scope.
