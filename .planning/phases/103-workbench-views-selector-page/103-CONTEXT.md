# Phase 103: Workbench Views + Selector Page - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

The two user-facing surfaces that make v7.0 feel real: (A) a four-view extraction results workbench (table/card/split + evidence drawer) at `/extraction/[jobId]`, and (B) a unified cross-source paper selector page at `/extraction/new` with tabs for Library, Collections, Search Results, and Manual IDs. Wired end-to-end with the WorkbenchShell from Phase 101, the basket store from Phase 99, the backend actions from Phase 100, and the entry-point components from Phase 102. The Zotero tab is a Phase 104 deliverable — this phase builds the tab shell that Phase 104 plugs into.

Requirements: SEL-01 (selector page with 4 tabs + sticky counter), SEL-02 (library bulk-select), SEL-03 (collection extract-all), SEL-04 (search results bulk-select), WB-04 (client-side search via useDeferredValue), WB-05 (card view virtualized), WB-06 (split view), WB-07 (evidence drawer with verbatim slice), WB-08 (export filtered subset), WB-09 (pagination with counts), GAP-01 (parsingSource badge everywhere), GAP-02 (useProtectedQuery fix).

</domain>

<decisions>
## Implementation Decisions

### Card View Virtualization (WB-05)
- **D-01:** Install `@tanstack/react-virtual@^3.13.23` scoped to the card-view bundle only (not used in table or split views). The card view renders a single-column virtualized list using `useVirtualizer` with dynamic row height estimation. Each virtual row renders a `PaperResultCard` (existing component from `components/extraction/paper-result-card.tsx`). The virtualizer container is a fixed-height div that fills the remaining viewport below the toolbar.
- **D-02:** Use `estimateSize` callback returning ~280px (estimated card height) with `measureElement` for actual measured heights after first render. This prevents layout jumps as cards of varying heights (different question counts, evidence quotes) settle. The overscan count is 5 rows above and below the viewport.
- **D-03:** The card view does NOT use a grid layout — single column only. At 1000 papers, a grid introduces complex row-height synchronization across columns that @tanstack/react-virtual handles poorly. A single column with variable-height cards is the proven pattern.

### Split View Layout (WB-06)
- **D-04:** The split view uses a fixed 40%/60% horizontal split. Left panel: a paginated paper list showing title, status badge, and parsingSource badge per row. Right panel: the selected paper's full detail (reusing `PaperResultCard` with all question answers, evidence quotes, and badges). Selection is driven by a local `useState<string | null>(null)` holding the selected paper `_id`.
- **D-05:** The left panel uses TanStack Table's `getPaginationRowModel` with a page size of 10 (denser than the full table view since rows are compact). Clicking a row in the left panel sets the selected paper ID and scrolls the right panel to top. The right panel shows an empty-state prompt ("Select a paper to view details") when no paper is selected.
- **D-06:** The split is NOT resizable (no drag handle). A fixed split avoids the complexity of a resize library and matches the read-heavy workflow where users scan left and read right. On mobile (< 768px), the split view falls back to the table view with a toast suggesting the user switch — split is a desktop-only layout.

### Evidence Drawer (WB-07)
- **D-07:** Create an `EvidenceDrawer` component using shadcn `Sheet` (side="right", same pattern as the basket drawer). The drawer opens when a user clicks any citation/evidence-quote element in any view (table cell, card, or split detail). The drawer content shows: (1) the verbatim `source.text.slice(evidence_start_char, evidence_end_char)` via the existing `EvidenceQuote` component, (2) a `parsingSource` badge (GAP-01), (3) the question text, (4) the model used, (5) the critic verdict badge.
- **D-08:** The drawer receives props: `paperId`, `startChar`, `endChar`, `questionText`, `parsingSource`, `modelUsed`, `criticVerdict`. It is mounted once in the WorkbenchShell and controlled via a local state object `{ open: boolean, props: EvidenceDrawerProps | null }`. Clicking an evidence element sets the state and opens the drawer. This avoids per-row Sheet mount overhead.
- **D-09:** The existing `EvidenceQuote` component uses bare `useQuery` (not `useProtectedQuery`) — this is the GAP-02 fix. Change `useQuery` to `useProtectedQuery` in `evidence-quote.tsx` to prevent flash during Clerk auth transitions. Also fix `JobMetricsPanel` if it uses bare `useQuery`.

### Selector Page Tab Architecture (SEL-01)
- **D-10:** Create `/app/extraction/new/page.tsx` (server component) and `/app/extraction/new/selector-page-client.tsx` (client component). The page uses shadcn `Tabs` component with 4 tabs: Library, Collections, Search Results, Manual IDs. A 5th tab placeholder ("Zotero — coming soon" disabled state) is included for Phase 104 to activate. The `<ExtractionCounter>` from Phase 102 is mounted as a sticky element above the tabs.
- **D-11:** Each tab renders a source-specific list component that reads data from existing Convex queries:
  - **Library tab:** Reuses the `libraryItems` query (paginated, with search/filter) from `convex/library/queries.ts`. Each row has a checkbox + `<AddToExtractionButton>` for individual or bulk selection.
  - **Collections tab:** Lists collections from `convex/library/queries.ts:getCollections`, with an "Extract entire collection" button per row that adds all items via `libraryItemCollections` junction query.
  - **Search Results tab:** Shows a search-ID picker (from recent searches in `searchHistory`), then lists papers from `convex/search/queries.ts:getSearchResults`. Each row has checkbox + add-to-basket.
  - **Manual IDs tab:** A textarea for pasting OpenAlex IDs (one per line) + a "Resolve & Add" button that calls `resolveManualIds` action from Phase 100.
- **D-12:** Below the tabs, a sticky footer bar renders: the `<ExtractionCounter>` progress bar, a "Review Basket" button (opens the basket drawer), and a "Start Extraction" CTA that navigates to a confirmation step (ExtractionDialog with questions + tier selector, pre-populated with basket contents). The CTA is disabled when the basket is empty.

### Job Creation Flow
- **D-13:** The "Start Extraction" CTA on the selector page opens the existing `ExtractionDialog` component but with a key difference: the `papers` prop is populated from `useExtractionBasketStore` entries (resolving the v6.0 UI-01 gap where ExtractionDialog's papers prop was unconnected). The user configures questions and tier in the dialog, then submits. On successful `createExtractionJob`, the basket clears (Phase 99 design) and the user is navigated to `/extraction/[newJobId]`.
- **D-14:** The ExtractionDialog is adapted to accept papers from the basket store shape (`BasketEntry[]`) and map them to the mutation's expected format. The dialog's existing question builder and tier selector remain unchanged.

### Client-Side Search (WB-04)
- **D-15:** Add a search input to the WorkbenchToolbar that drives TanStack Table's `globalFilter` state. The search input value is wrapped in React 19's `useDeferredValue` to avoid filter re-render storms at 1000 rows. The global filter function searches across paper title, DOI, and all answer text columns. The search input uses the existing debounced input pattern from `lib/hooks/use-debounced-value.ts` as a secondary debounce layer (300ms) on top of `useDeferredValue`.
- **D-16:** The global filter is additive with column-specific filters — both apply simultaneously via TanStack Table's built-in filter pipeline. The search input shows a clear button when non-empty and resets pagination to page 1 on change.

### Pagination (WB-09)
- **D-17:** Enable `getPaginationRowModel` on the existing `useReactTable` instance in WorkbenchShell. Default page size: 25 for table view, 25 for card view (virtualized — pagination controls how many rows the virtualizer receives, not what's visible), 10 for the split view left panel. Page size is stored in the `extraction-results-view` Zustand store alongside `activeView`.
- **D-18:** Pagination controls render below the active view: "Showing X-Y of Z papers" text + Previous/Next buttons. Pagination state resets to page 1 when any filter changes (column filter, global search, or sort). The control uses the existing shadcn `Button` primitives.

### Export Filtered Subset (WB-08)
- **D-19:** The export dropdown in the workbench toolbar exports the currently-filtered subset by reading `table.getFilteredRowModel().rows` to get the filtered paper IDs, then calling `getExtractionResultsForExport` with an optional `paperIds` filter parameter (requires a small backend addition to `convex/extraction/queries.ts`). This ensures the export matches exactly what the user sees in the filtered view.
- **D-20:** If no filters are active, the export falls back to the current behavior (export all results). The existing `exportExtractionToCSV`, `exportExtractionToJSON`, and `exportExtractionToXLSX` functions from `lib/extraction/export.ts` are reused without modification — only the data they receive changes.

### parsingSource Badge (GAP-01)
- **D-21:** The `parsingSource` column already exists in `workbench-columns.tsx` static columns. The table view renders it as a cell. The card view already renders it via `PaperResultCard` (which has the badge at line 73-76). The split view's left panel shows a compact badge next to the status badge. The evidence drawer shows it prominently (D-07). This closes GAP-01 across all 4 surfaces.

### useProtectedQuery Fix (GAP-02)
- **D-22:** Replace `useQuery` with `useProtectedQuery` in:
  - `components/extraction/evidence-quote.tsx` (line 24) — currently uses bare `useQuery(api.extraction.queries.getPaperBodyText, ...)`
  - `components/extraction/job-metrics-panel.tsx` — check and fix if it uses bare `useQuery`
  This prevents the flash-of-unauthenticated-content during Clerk visibility-change auth transitions. Import `useProtectedQuery` from `lib/auth/use-auth-query`.

### Results Page Refactoring
- **D-23:** Refactor `app/extraction/[jobId]/extraction-results-client.tsx` to replace the flat card list with the WorkbenchShell. Keep the existing loading skeleton, not-found state, and empty state. Replace the results section (lines 132-184) with: `<WorkbenchShell data={data.papers} questions={data.job.questions}>` containing the card view, split view, and evidence drawer as children. The table view is already rendered by WorkbenchShell via `WorkbenchDataTable`.
- **D-24:** Move the export dropdown from the page header into the WorkbenchToolbar (it logically belongs with filters and view controls). The toolbar already has a slot for actions on the right side.

### Claude's Discretion
- Exact Tailwind styling for the split view panels and divider
- Evidence drawer width (default Sheet width or custom)
- Empty state illustrations/copy for each selector tab
- Whether the Manual IDs tab textarea uses a monospace font
- Animation transitions for evidence drawer open/close
- Exact search input placeholder text
- How the Collections tab groups/displays nested items
- Page size selector UI (dropdown or just fixed sizes per view)
- Test file organization for new components

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Workbench Primitives (Phase 101 output)
- `components/extraction/workbench-shell.tsx` — WorkbenchShell with single `useReactTable` instance, table/card/split view branches with AnimatePresence transitions
- `components/extraction/workbench-data-table.tsx` — DataTable renderer bridging TanStack Table to shadcn Table
- `components/extraction/workbench-toolbar.tsx` — Toolbar with filter controls, view switcher slot, column visibility toggle
- `components/extraction/view-switcher.tsx` — Segmented control for table/card/split view switching
- `components/extraction/column-visibility-toggle.tsx` — Popover with column checkboxes
- `lib/extraction/workbench-columns.tsx` — Column definitions factory (`createWorkbenchColumns`), `WorkbenchPaper` and `ExtractionQuestion` types, memoized cell renderers
- `lib/store/extraction-results-view.ts` — Zustand store: `columnVisibility`, `activeView`, `setActiveView`, `_hasHydrated`

### Basket & Entry Points (Phase 99 + 102 output)
- `lib/store/extraction-basket.ts` — `useExtractionBasketStore`, `BasketEntry`, `BasketSource` types, `papers` Map, `add()`, `remove()`, `has()`, `clear()` methods
- `lib/hooks/use-add-to-basket.ts` — `useAddToBasket` hook: `addToBasket`, `removeFromBasket`, `isInBasket`, `basketCount`
- `components/extraction/extraction-basket-drawer.tsx` — Basket drawer (Sheet right-side) with per-source sections
- `components/extraction/extraction-counter.tsx` — "X / 1000" counter with progress bar (yellow at 80%, red at 100%)
- `components/extraction/add-to-extraction-button.tsx` — Standalone icon button for adding papers to basket

### Extraction Results & Export
- `app/extraction/[jobId]/extraction-results-client.tsx` — Current results page (to be refactored); uses `useProtectedQuery` for main query
- `app/extraction/[jobId]/page.tsx` — Server component loading the results client
- `components/extraction/paper-result-card.tsx` — Self-contained card with inline answers, evidence quotes, parsingSource badge, status/confidence/critic badges
- `components/extraction/evidence-quote.tsx` — Renders verbatim `bodyText.slice(startChar, endChar)` via `useQuery(getPaperBodyText)` — needs GAP-02 fix to `useProtectedQuery`
- `components/extraction/job-metrics-panel.tsx` — SLO metrics panel — check for GAP-02 fix
- `lib/extraction/export.ts` — `exportExtractionToCSV`, `exportExtractionToJSON`, `exportExtractionToXLSX` + pure `generate*` functions

### Extraction Queries
- `convex/extraction/queries.ts` — `getExtractionResults` (reactive query returning job + papers with results), `getExtractionResultsForExport` (one-shot export query), `getPaperBodyText` (body text for evidence rendering)

### Backend Actions (Phase 100 output)
- `convex/openalex/actions.ts` — `resolveManualIds` (batch paste resolution) and `resolveByDoi` (single DOI resolution)
- `convex/extraction/mutations.ts` — `createExtractionJob` with tier arg and hard-limit rejection
- `lib/toast/error-resolver.ts` — `EXTRACTION_LIMIT_EXCEEDED` error routing

### Existing UI Primitives
- `components/shared/filter-section.tsx` — `FilterSection` with icon/title/isActive/onClear/children
- `components/shared/sidebar-layout.tsx` — `SidebarLayout` responsive component (reference for layout patterns)
- `components/ui/sheet.tsx` — shadcn Sheet for evidence drawer and basket drawer
- `components/ui/tabs.tsx` — shadcn Tabs for selector page tab navigation
- `components/ui/table.tsx` — shadcn Table primitive
- `components/extraction/tier-selector.tsx` — TierSelector for job creation dialog
- `components/extraction/extraction-dialog.tsx` — Job creation dialog (questions + tier + submit)

### Library & Collections Data
- `convex/library/queries.ts` — `getLibraryItems` (paginated), `getCollections`, `getCollectionItems`
- `convex/library/mutations.ts` — Collection CRUD
- `components/library/library-page-client.tsx` — Library page with paper listing (reference for library tab)

### Search Data
- `convex/search/queries.ts` — `getSearchResults` returning papers per search
- `components/results-list.tsx` — Search results rendering (reference for search tab)

### Normalize Utility
- `lib/openalex/normalize.ts` — `normalizeOpenAlexId(input): string | null`

### Limit System (Phase 98 output)
- `convex/lib/queryBounds.ts` — `MAX_EXTRACTION_PAPERS_PER_JOB`, `EXTRACTION_LIMITS_BY_TIER`
- `convex/lib/extractionLimit.ts` — `getExtractionLimitForUser(ctx, userId)`
- `convex/extraction/queries.ts:689` — `getExtractionLimit` reactive query

### Auth
- `lib/auth/use-auth-query.ts` — `useProtectedQuery` wrapper preventing Clerk auth-transition flashes

### i18n
- `messages/en-US.json` — Source of truth; `extraction.*` namespace for all extraction i18n keys

### Conventions
- `.planning/codebase/CONVENTIONS.md` — File naming (kebab-case), component naming (PascalCase), i18n key naming
- `.planning/codebase/STRUCTURE.md` — Directory layout for new files

### Convex Guidelines
- `convex/_generated/ai/guidelines.md` — Convex API patterns (MUST read before writing any Convex code)

### Prior Phase Context
- `.planning/phases/98-pre-flight-hard-limit-foundation/98-CONTEXT.md` — Limit constant architecture
- `.planning/phases/99-selection-basket-core/99-CONTEXT.md` — Basket store and hook decisions
- `.planning/phases/100-backend-wiring-tierselector-fix/100-CONTEXT.md` — Error system, TierSelector, OpenAlex actions
- `.planning/phases/101-workbench-primitives/101-CONTEXT.md` — Workbench store, column definitions, toolbar patterns
- `.planning/phases/102-entry-points-counter-ux/102-CONTEXT.md` — Counter, AddToExtractionButton, sidebar badge

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `components/extraction/workbench-shell.tsx` — Complete shell with table/card/split branches; card and split currently render placeholder divs ("Phase 103") — ready to be replaced with real implementations
- `components/extraction/paper-result-card.tsx` — Full card component with questions, evidence, badges — reuse directly for card view items and split view detail panel
- `components/extraction/evidence-quote.tsx` — Verbatim slice renderer — reuse inside the evidence drawer
- `components/extraction/workbench-toolbar.tsx` — Toolbar with filter controls — extend with search input and export dropdown
- `lib/extraction/export.ts` — Complete CSV/JSON/XLSX export pipeline — reuse without modification
- `lib/store/extraction-basket.ts` — Full basket store with all required APIs for the selector page
- `lib/hooks/use-add-to-basket.ts` — Complete hook for selector tab add/remove operations
- `components/extraction/extraction-counter.tsx` — Ready to mount on selector page
- `components/extraction/add-to-extraction-button.tsx` — Ready to mount in selector tab rows
- `components/extraction/extraction-dialog.tsx` — Job creation dialog with questions + tier — needs papers prop wiring from basket

### Established Patterns
- Zustand stores: `create<T>()(persist(...))` with localStorage (view state) or sessionStorage (basket)
- shadcn Sheet: side="right" pattern for drawers (basket drawer as reference)
- shadcn Tabs: tab navigation pattern (no prior usage in extraction — reference `components/ui/tabs.tsx`)
- TanStack Table: `useReactTable` with sorting/filtering/visibility/pagination row models
- Motion/React: `AnimatePresence` + `motion.div` for view transitions (WorkbenchShell already implements this)
- `useProtectedQuery`: standard wrapper for auth-safe reactive queries
- i18n: seed keys in all 6 locales before UI work

### Integration Points
- `WorkbenchShell` line 142-147 (card placeholder) → replace with virtualized card list
- `WorkbenchShell` line 157-163 (split placeholder) → replace with split view component
- `extraction-results-client.tsx` lines 132-184 → refactor to use WorkbenchShell
- `extraction-dialog.tsx` line 125 → wire papers from basket store
- `workbench-toolbar.tsx` → add search input and export dropdown
- `/app/extraction/new/` directory → create selector page (new route)

</code_context>

<specifics>
## Specific Ideas

- `@tanstack/react-virtual@^3.13.23` is the ONLY new runtime dependency for Phase 103. It is scoped to the card view bundle only — do not use it for the table or split views.
- The card view's `useVirtualizer` must measure actual element heights via `measureElement` ref callback, not rely solely on `estimateSize`. PaperResultCards have variable heights depending on question count and evidence presence.
- The split view falls back to table view on mobile (< 768px). Do not attempt a stacked mobile split — it's confusing for the paper-comparison workflow.
- The evidence drawer is a single Sheet instance mounted in WorkbenchShell, controlled via state — not per-row mounts. This avoids DOM bloat at 1000 rows.
- The `EvidenceQuote` component's bare `useQuery` (line 24) must be changed to `useProtectedQuery` for GAP-02. This is a 1-line import change + 1-line call change.
- The selector page `/extraction/new` must include a disabled Zotero tab placeholder so Phase 104 can activate it without restructuring the tabs.
- The "Start Extraction" flow opens the existing ExtractionDialog with papers from the basket — it does NOT create a new dialog component. The dialog needs its `papers` prop wired from `useExtractionBasketStore`.
- Export of filtered subset requires a small backend change: add an optional `paperIds?: string[]` parameter to `getExtractionResultsForExport` so it can filter to the currently-visible subset.
- Highlighted-citation is explicitly NOT a top-level 4th view — it's a drawer pattern (per ROADMAP.md anti-features). The evidence drawer is the implementation of WB-07.
- Table view does NOT virtualize (per ROADMAP.md anti-features) — only card view does. Table view uses standard DOM pagination.
- Do NOT add infinite scroll to any view (per ROADMAP.md anti-features). All views use explicit pagination.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 103-workbench-views-selector-page*
*Context gathered: 2026-04-16*
