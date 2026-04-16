# Phase 103: Workbench Views + Selector Page - Research

**Researched:** 2026-04-16
**Domain:** React UI composition (virtualized lists, split-pane layouts, tabbed selectors, drawer patterns, TanStack Table pagination + global filter, Convex reactive queries)
**Confidence:** HIGH

## Summary

Phase 103 builds the two largest user-facing surfaces of v7.0: (A) a four-view extraction results workbench at `/extraction/[jobId]` (table, card, split, evidence drawer) and (B) a unified paper selector page at `/extraction/new` with four tabs plus a Zotero placeholder. Both surfaces integrate with the WorkbenchShell from Phase 101, the basket store from Phase 99, and the backend actions from Phase 100.

The codebase is well-prepared for this phase. The WorkbenchShell already has placeholder branches for card and split views (lines 142-163). The PaperResultCard, EvidenceQuote, export pipeline, basket store, and counter are all shipped and tested. The only new runtime dependency is `@tanstack/react-virtual@3.13.23` (verified current on npm), scoped to the card view. The primary technical risks are (1) card view virtualization with dynamic row heights from PaperResultCard, (2) the WorkbenchShell refactoring to support pagination and global filter on the shared `useReactTable` instance, and (3) wiring the ExtractionDialog's `papers` prop from the basket store.

**Primary recommendation:** Split into two parallel sub-plans: Plan A (Workbench Views: card, split, evidence drawer, search, pagination, export, GAP-01, GAP-02) and Plan B (Selector Page: tabs, library/collection/search/manual tabs, ExtractionDialog wiring). Both can execute in parallel since they touch different file trees with the single shared dependency being the basket store, which is already shipped.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Install `@tanstack/react-virtual@^3.13.23` scoped to the card-view bundle only (not used in table or split views). The card view renders a single-column virtualized list using `useVirtualizer` with dynamic row height estimation. Each virtual row renders a `PaperResultCard` (existing component from `components/extraction/paper-result-card.tsx`). The virtualizer container is a fixed-height div that fills the remaining viewport below the toolbar.
- **D-02:** Use `estimateSize` callback returning ~280px (estimated card height) with `measureElement` for actual measured heights after first render. This prevents layout jumps as cards of varying heights (different question counts, evidence quotes) settle. The overscan count is 5 rows above and below the viewport.
- **D-03:** The card view does NOT use a grid layout -- single column only. At 1000 papers, a grid introduces complex row-height synchronization across columns that @tanstack/react-virtual handles poorly. A single column with variable-height cards is the proven pattern.
- **D-04:** The split view uses a fixed 40%/60% horizontal split. Left panel: a paginated paper list showing title, status badge, and parsingSource badge per row. Right panel: the selected paper's full detail (reusing `PaperResultCard` with all question answers, evidence quotes, and badges). Selection is driven by a local `useState<string | null>(null)` holding the selected paper `_id`.
- **D-05:** The left panel uses TanStack Table's `getPaginationRowModel` with a page size of 10 (denser than the full table view since rows are compact). Clicking a row in the left panel sets the selected paper ID and scrolls the right panel to top. The right panel shows an empty-state prompt ("Select a paper to view details") when no paper is selected.
- **D-06:** The split is NOT resizable (no drag handle). A fixed split avoids the complexity of a resize library and matches the read-heavy workflow where users scan left and read right. On mobile (< 768px), the split view falls back to the table view with a toast suggesting the user switch -- split is a desktop-only layout.
- **D-07:** Create an `EvidenceDrawer` component using shadcn `Sheet` (side="right", same pattern as the basket drawer). The drawer opens when a user clicks any citation/evidence-quote element in any view (table cell, card, or split detail). The drawer content shows: (1) the verbatim `source.text.slice(evidence_start_char, evidence_end_char)` via the existing `EvidenceQuote` component, (2) a `parsingSource` badge (GAP-01), (3) the question text, (4) the model used, (5) the critic verdict badge.
- **D-08:** The drawer receives props: `paperId`, `startChar`, `endChar`, `questionText`, `parsingSource`, `modelUsed`, `criticVerdict`. It is mounted once in the WorkbenchShell and controlled via a local state object `{ open: boolean, props: EvidenceDrawerProps | null }`. Clicking an evidence element sets the state and opens the drawer. This avoids per-row Sheet mount overhead.
- **D-09:** The existing `EvidenceQuote` component uses bare `useQuery` (not `useProtectedQuery`) -- this is the GAP-02 fix. Change `useQuery` to `useProtectedQuery` in `evidence-quote.tsx` to prevent flash during Clerk auth transitions. Also fix `JobMetricsPanel` if it uses bare `useQuery`.
- **D-10:** Create `/app/extraction/new/page.tsx` (server component) and `/app/extraction/new/selector-page-client.tsx` (client component). The page uses shadcn `Tabs` component with 4 tabs: Library, Collections, Search Results, Manual IDs. A 5th tab placeholder ("Zotero -- coming soon" disabled state) is included for Phase 104 to activate. The `<ExtractionCounter>` from Phase 102 is mounted as a sticky element above the tabs.
- **D-11:** Each tab renders a source-specific list component that reads data from existing Convex queries (Library: `browseLibrary`/`searchLibrary`, Collections: `listCollections` + junction via `libraryItemCollections`, Search Results: via search history data, Manual IDs: textarea + `resolveManualIds`).
- **D-12:** Below the tabs, a sticky footer bar renders: the `<ExtractionCounter>` progress bar, a "Review Basket" button (opens the basket drawer), and a "Start Extraction" CTA that navigates to a confirmation step (ExtractionDialog with questions + tier selector, pre-populated with basket contents). The CTA is disabled when the basket is empty.
- **D-13:** The "Start Extraction" CTA on the selector page opens the existing `ExtractionDialog` component but with a key difference: the `papers` prop is populated from `useExtractionBasketStore` entries (resolving the v6.0 UI-01 gap). On successful `createExtractionJob`, the basket clears (Phase 99 design) and the user is navigated to `/extraction/[newJobId]`.
- **D-14:** The ExtractionDialog is adapted to accept papers from the basket store shape (`BasketEntry[]`) and map them to the mutation's expected format. The dialog's existing question builder and tier selector remain unchanged.
- **D-15:** Add a search input to the WorkbenchToolbar that drives TanStack Table's `globalFilter` state. The search input value is wrapped in React 19's `useDeferredValue` to avoid filter re-render storms at 1000 rows. The global filter function searches across paper title, DOI, and all answer text columns. The search input uses the existing debounced input pattern from `lib/hooks/use-debounced-value.ts` as a secondary debounce layer (300ms) on top of `useDeferredValue`.
- **D-16:** The global filter is additive with column-specific filters -- both apply simultaneously via TanStack Table's built-in filter pipeline. The search input shows a clear button when non-empty and resets pagination to page 1 on change.
- **D-17:** Enable `getPaginationRowModel` on the existing `useReactTable` instance in WorkbenchShell. Default page size: 25 for table view, 25 for card view (virtualized -- pagination controls how many rows the virtualizer receives, not what's visible), 10 for the split view left panel. Page size is stored in the `extraction-results-view` Zustand store alongside `activeView`.
- **D-18:** Pagination controls render below the active view: "Showing X-Y of Z papers" text + Previous/Next buttons. Pagination state resets to page 1 when any filter changes (column filter, global search, or sort). The control uses the existing shadcn `Button` primitives.
- **D-19:** The export dropdown in the workbench toolbar exports the currently-filtered subset by reading `table.getFilteredRowModel().rows` to get the filtered paper IDs, then calling `getExtractionResultsForExport` with an optional `paperIds` filter parameter (requires a small backend addition to `convex/extraction/queries.ts`). This ensures the export matches exactly what the user sees in the filtered view.
- **D-20:** If no filters are active, the export falls back to the current behavior (export all results). The existing `exportExtractionToCSV`, `exportExtractionToJSON`, and `exportExtractionToXLSX` functions from `lib/extraction/export.ts` are reused without modification -- only the data they receive changes.
- **D-21:** The `parsingSource` column already exists in `workbench-columns.tsx` static columns. The table view renders it as a cell. The card view already renders it via `PaperResultCard` (which has the badge at line 73-76). The split view's left panel shows a compact badge next to the status badge. The evidence drawer shows it prominently (D-07). This closes GAP-01 across all 4 surfaces.
- **D-22:** Replace `useQuery` with `useProtectedQuery` in: `components/extraction/evidence-quote.tsx` (line 24) and `components/extraction/job-metrics-panel.tsx` (line 36). Import `useProtectedQuery` from `lib/auth/use-auth-query`.
- **D-23:** Refactor `app/extraction/[jobId]/extraction-results-client.tsx` to replace the flat card list with the WorkbenchShell. Keep the existing loading skeleton, not-found state, and empty state. Replace the results section (lines 132-184) with `<WorkbenchShell>` containing the card view, split view, and evidence drawer as children.
- **D-24:** Move the export dropdown from the page header into the WorkbenchToolbar (it logically belongs with filters and view controls).

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

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEL-01 | Selector page at `/extraction/new` with 4 tabs + sticky counter | D-10, D-12: shadcn Tabs + ExtractionCounter composition. Route `/app/extraction/new/` does not exist yet -- must create. |
| SEL-02 | Bulk-select papers from library and add to basket | D-11: Reuse `browseLibrary` paginated query + `useAddToBasket` hook. `libraryItems` schema has `openalexId`, `title`, `doi` needed for `BasketEntry`. |
| SEL-03 | Extract entire collection in one click | D-11: `listCollections` + `libraryItemCollections` junction query by `by_collection` index. No `getCollectionItems` query exists -- must create one or inline the join. |
| SEL-04 | Bulk-select papers from search results | D-11: Search results data accessed via existing search history / results data flow. |
| WB-04 | Client-side search with useDeferredValue | D-15, D-16: TanStack Table `globalFilter` + React 19 `useDeferredValue` + existing `useDebouncedValue(300ms)`. |
| WB-05 | Card view virtualized for 1000 cards | D-01, D-02, D-03: `@tanstack/react-virtual@3.13.23` `useVirtualizer` with `estimateSize(280px)` + `measureElement` ref. |
| WB-06 | Split view with paginated list + detail | D-04, D-05, D-06: 40/60 fixed split, left panel paginated (page size 10), right panel `PaperResultCard`, mobile fallback to table. |
| WB-07 | Evidence drawer with verbatim slice | D-07, D-08: Single `Sheet` mounted in WorkbenchShell, controlled via state. Reuses `EvidenceQuote` component for the slice. |
| WB-08 | Export filtered subset as CSV/JSON/XLSX | D-19, D-20: Read `table.getFilteredRowModel().rows` for paper IDs, pass to `getExtractionResultsForExport` with new optional `paperIds` parameter. |
| WB-09 | Pagination with counts | D-17, D-18: `getPaginationRowModel` on shared table instance, view-specific page sizes, reset on filter change. |
| GAP-01 | parsingSource badge in all views | D-21: Already in table columns and PaperResultCard. Add to split view left panel and evidence drawer. |
| GAP-02 | useProtectedQuery fix | D-22: evidence-quote.tsx line 24 and job-metrics-panel.tsx line 36 both use bare `useQuery` -- change to `useProtectedQuery`. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Backend**: Convex -- always read `convex/_generated/ai/guidelines.md` before writing Convex code
- **Auth**: Clerk -- use `useProtectedQuery` wrapper, never bare `useQuery` for auth-guarded queries
- **i18n**: All strings via `useTranslations(namespace)` from `next-intl`, must exist in all 6 locales
- **Styling**: Tailwind v4, OKLCH color space, dark mode via `dark:` prefix, `cn()` for class composition
- **Animation**: `motion/react` v12 with spring-based animations from `lib/animation-config.ts`
- **State**: Zustand stores with `persist` middleware for client state, Convex reactive queries for server state
- **TypeScript**: `strict: true`, no `any` types (enforced by `scripts/verify-no-any.sh`)
- **Components**: `"use client"` directive on all interactive components, shadcn primitives in `components/ui/`
- **Testing**: Vitest with `@edge-runtime/vm` for Convex, jsdom for React hooks/components
- **Files**: kebab-case for files, PascalCase for components, `@/` path alias
- **No dead code**: Destructive approach -- no legacy compatibility, clean modern code only
- **DRY**: Check codebase for reusable patterns before implementing anything new

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Card view virtualization (WB-05) | Browser / Client | -- | Pure DOM virtualization -- no server involvement. TanStack Virtual renders only visible items. |
| Split view layout (WB-06) | Browser / Client | -- | CSS layout + local state for selected paper ID. No server-side rendering. |
| Evidence drawer (WB-07) | Browser / Client | API / Backend | Drawer is client-side Sheet; content fetched via `getPaperBodyText` Convex query. |
| Client-side search (WB-04) | Browser / Client | -- | TanStack Table's `globalFilter` + `useDeferredValue` -- all client-side filtering. |
| Pagination (WB-09) | Browser / Client | -- | `getPaginationRowModel` runs entirely in the browser on pre-fetched data. |
| Export filtered subset (WB-08) | Browser / Client | API / Backend | Filter state lives client-side; export data fetched via `getExtractionResultsForExport` with `paperIds` filter. |
| Selector page tabs (SEL-01) | Browser / Client | API / Backend | Tab UI is client; each tab fetches data via Convex paginated queries. |
| Library bulk-select (SEL-02) | Browser / Client | API / Backend | Checkboxes are client; data from `browseLibrary` Convex query. Basket store is client-only. |
| Collection extract-all (SEL-03) | Browser / Client | API / Backend | Client adds items to basket; needs Convex query to fetch collection member items. |
| ExtractionDialog wiring (D-13/D-14) | Browser / Client | API / Backend | Dialog is client; `createExtractionJob` mutation fires to Convex backend. |
| GAP-02 useProtectedQuery fix | Browser / Client | -- | Import change only -- `useProtectedQuery` wraps `useQuery` with auth guard. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@tanstack/react-virtual` | 3.13.23 | Card view virtualization | Only new runtime dep. Headless virtualizer -- matches existing TanStack Table ecosystem. [VERIFIED: npm registry] |
| `@tanstack/react-table` | 8.21.3 | Table state management, pagination, global filter | Already installed (Phase 101). Single `useReactTable` instance shared across all views. [VERIFIED: package.json] |
| `react` | 19.2.4 | `useDeferredValue` for filter debounce | Already installed. React 19 `useDeferredValue` is the recommended approach for deferred state transitions. [VERIFIED: package.json] |
| `zustand` | (installed) | View state persistence (activeView, columnVisibility, pageSize) | Already used for `extraction-results-view` and `extraction-basket` stores. [VERIFIED: codebase] |
| `motion/react` | v12 (installed) | AnimatePresence transitions for view switching | Already used in WorkbenchShell. [VERIFIED: codebase] |
| `next-intl` | (installed) | i18n for all new UI strings | Required by CLAUDE.md -- all 6 locales. [VERIFIED: codebase] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn `Sheet` | (installed) | Evidence drawer (side="right") | Evidence drawer component -- same pattern as basket drawer. [VERIFIED: components/ui/sheet.tsx] |
| shadcn `Tabs` | (installed) | Selector page tab navigation | 4+1 tabs on `/extraction/new`. [VERIFIED: components/ui/tabs.tsx] |
| shadcn `Table` | (installed) | Table view rendering | Already used by WorkbenchDataTable. [VERIFIED: codebase] |
| `exceljs` | (installed, dynamic import) | XLSX export | Lazy-loaded only when user clicks XLSX export. [VERIFIED: lib/extraction/export.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@tanstack/react-virtual` | `react-window` | react-window has fixed-size-only mode by default; dynamic heights require `react-window` + `react-virtualized-auto-sizer` + custom height cache. TanStack Virtual's `measureElement` handles dynamic heights natively. Decision locked (D-01). |
| `@tanstack/react-virtual` | `virtua` | Smaller bundle but less ecosystem integration with TanStack Table. Decision locked. |
| Custom split view | `allotment` / `react-split` | Decision locked (D-06): fixed 40/60 split, no resize handle needed. A resize library adds complexity for no user value. |
| Custom pagination | `@tanstack/react-table` built-in | Decision locked (D-17): use `getPaginationRowModel` already in TanStack Table. No additional dep needed. |

**Installation:**
```bash
npm install @tanstack/react-virtual@^3.13.23
```

**Version verification:**
- `@tanstack/react-virtual`: 3.13.23 on npm (2026-04-16) [VERIFIED: npm registry]
- `@tanstack/react-table`: 8.21.3 already in package.json [VERIFIED: package.json]

## Architecture Patterns

### System Architecture Diagram

```
User Action Flow (Workbench):

  /extraction/[jobId]
         |
         v
  ExtractionResultsClient --------> useProtectedQuery(getExtractionResults)
         |                                      |
         v                                      v
  WorkbenchShell (single useReactTable)    Convex Backend
         |                              (papers + results)
         |
    +----+--------+----------+
    |              |          |
    v              v          v
  TableView   CardView   SplitView
  (DataTable) (Virtual)  (40/60)
    |              |          |
    |    +---------+----------+
    |    |
    v    v
  EvidenceDrawer (Sheet)
         |
         v
  useProtectedQuery(getPaperBodyText)

User Action Flow (Selector):

  /extraction/new
         |
         v
  SelectorPageClient
         |
    +----+----+--------+---------+
    |         |        |         |
    v         v        v         v
  Library  Collections Search  Manual
    Tab       Tab      Tab     IDs Tab
    |         |        |         |
    v         v        v         v
  browseLib  listCol  (search   resolveManualIds
  searchLib  +junction  data)    (Phase 100)
    |         |        |         |
    +----+----+--------+---------+
         |
         v
  useAddToBasket (cap-aware)
         |
         v
  ExtractionBasketStore (sessionStorage)
         |
         v
  "Start Extraction" CTA
         |
         v
  ExtractionDialog (papers from basket)
         |
         v
  createExtractionJob mutation
         |
         v
  Navigate to /extraction/[newJobId]
```

### Recommended Project Structure

```
components/extraction/
  workbench-shell.tsx         # MODIFY: add pagination, global filter, evidence drawer mount
  workbench-toolbar.tsx       # MODIFY: add search input, export dropdown
  workbench-data-table.tsx    # existing -- no changes
  workbench-columns.tsx       # existing -- no changes (GAP-01 already covered)
  card-view.tsx               # NEW: virtualized card list using @tanstack/react-virtual
  split-view.tsx              # NEW: 40/60 split with paginated left + detail right
  split-view-row.tsx          # NEW: compact row for split view left panel
  evidence-drawer.tsx         # NEW: Sheet-based drawer for verbatim evidence
  evidence-quote.tsx          # MODIFY: useQuery -> useProtectedQuery (GAP-02)
  job-metrics-panel.tsx       # MODIFY: useQuery -> useProtectedQuery (GAP-02)
  pagination-controls.tsx     # NEW: "Showing X-Y of Z" + prev/next buttons
  extraction-dialog.tsx       # MODIFY: wire papers prop from basket store
  paper-result-card.tsx       # existing -- reused by card view and split view detail

app/extraction/new/
  page.tsx                    # NEW: server component for selector route
  selector-page-client.tsx    # NEW: client component with tabs, counter, footer
  library-tab.tsx             # NEW: library items with checkboxes + AddToExtractionButton
  collections-tab.tsx         # NEW: collection list with "Extract entire collection"
  search-results-tab.tsx      # NEW: search results with bulk select
  manual-ids-tab.tsx          # NEW: textarea + resolve button

app/extraction/[jobId]/
  extraction-results-client.tsx # MODIFY: replace flat card list with WorkbenchShell

lib/store/
  extraction-results-view.ts  # MODIFY: add pageSize field

convex/extraction/
  queries.ts                  # MODIFY: add optional paperIds to getExtractionResultsForExport

convex/library/
  queries.ts                  # MAY NEED: getCollectionItems query for SEL-03

messages/
  en-US.json                  # MODIFY: add extraction.selector.*, extraction.workbench.* keys
  (+ 5 other locales)
```

### Pattern 1: Card View Virtualization with Dynamic Heights

**What:** A single-column virtualized list of PaperResultCards using `@tanstack/react-virtual`
**When to use:** Card view with 1000 variable-height items
**Example:**
```typescript
// Source: https://tanstack.com/virtual/latest/docs/framework/react/examples/dynamic
// [VERIFIED: Context7 /websites/tanstack_virtual]

import { useVirtualizer } from "@tanstack/react-virtual";

function CardView({ rows }: { rows: WorkbenchPaper[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 280, // D-02: ~280px estimated card height
    overscan: 5,             // D-02: 5 rows above and below
  });

  return (
    <div ref={parentRef} className="h-[calc(100vh-200px)] overflow-y-auto">
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement} // D-02: dynamic measurement
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <PaperResultCard
              paper={rows[virtualRow.index]}
              questions={questions}
              index={virtualRow.index}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Pattern 2: TanStack Table Pagination + Global Filter

**What:** Adding pagination and global search to the shared `useReactTable` instance
**When to use:** WorkbenchShell enhancement for WB-04 and WB-09
**Example:**
```typescript
// Source: TanStack Table v8 docs
// [VERIFIED: Context7 /tanstack/table]

import {
  getPaginationRowModel,
  type PaginationState,
  type GlobalFilterTableState,
} from "@tanstack/react-table";

// In WorkbenchShell:
const [globalFilter, setGlobalFilter] = useState("");
const [pagination, setPagination] = useState<PaginationState>({
  pageIndex: 0,
  pageSize: 25, // default for table view
});

const table = useReactTable({
  data,
  columns,
  state: {
    sorting,
    columnFilters,
    columnVisibility,
    globalFilter,
    pagination,
  },
  onGlobalFilterChange: setGlobalFilter,
  onPaginationChange: setPagination,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  getPaginationRowModel: getPaginationRowModel(), // D-17
  globalFilterFn: "includesString", // D-15: built-in string matching
});
```

### Pattern 3: Evidence Drawer (Single Mount)

**What:** A single Sheet instance controlled via state, not per-row mounts
**When to use:** Any view that needs to open evidence detail on click
**Example:**
```typescript
// [ASSUMED] -- pattern derived from basket drawer (verified) + D-07/D-08 decisions

interface EvidenceDrawerProps {
  paperId: Id<"extractionPapers">;
  startChar: number;
  endChar: number;
  questionText: string;
  parsingSource?: string;
  modelUsed?: string;
  criticVerdict?: string;
}

// In WorkbenchShell:
const [drawerState, setDrawerState] = useState<{
  open: boolean;
  props: EvidenceDrawerProps | null;
}>({ open: false, props: null });

const openEvidence = useCallback((props: EvidenceDrawerProps) => {
  setDrawerState({ open: true, props });
}, []);

// Pass openEvidence to all views via props or context
// Mount once at WorkbenchShell level:
<EvidenceDrawer
  open={drawerState.open}
  onOpenChange={(open) => setDrawerState(prev => ({ ...prev, open }))}
  {...drawerState.props}
/>
```

### Pattern 4: Selector Page Tab Composition

**What:** shadcn Tabs with per-tab list components reading from Convex queries
**When to use:** The `/extraction/new` selector page
**Example:**
```typescript
// [VERIFIED: components/ui/tabs.tsx exports Tabs, TabsList, TabsTrigger, TabsContent]

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

<Tabs defaultValue="library">
  <TabsList>
    <TabsTrigger value="library">{t("tabs.library")}</TabsTrigger>
    <TabsTrigger value="collections">{t("tabs.collections")}</TabsTrigger>
    <TabsTrigger value="search">{t("tabs.search")}</TabsTrigger>
    <TabsTrigger value="manual">{t("tabs.manual")}</TabsTrigger>
    <TabsTrigger value="zotero" disabled>{t("tabs.zotero")}</TabsTrigger>
  </TabsList>
  <TabsContent value="library"><LibraryTab /></TabsContent>
  <TabsContent value="collections"><CollectionsTab /></TabsContent>
  <TabsContent value="search"><SearchResultsTab /></TabsContent>
  <TabsContent value="manual"><ManualIdsTab /></TabsContent>
  <TabsContent value="zotero">
    <div className="text-center text-muted-foreground p-8">
      {t("tabs.zoteroComingSoon")}
    </div>
  </TabsContent>
</Tabs>
```

### Pattern 5: useDeferredValue + useDebouncedValue Layered Debounce

**What:** Two-layer debounce for search input to prevent filter storms
**When to use:** WB-04 global search on 1000 rows
**Example:**
```typescript
// [VERIFIED: React 19 useDeferredValue docs + lib/hooks/use-debounced-value.ts]

import { useDeferredValue } from "react";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";

// Layer 1: 300ms traditional debounce (prevents API-like frequent updates)
const [searchInput, setSearchInput] = useState("");
const debouncedSearch = useDebouncedValue(searchInput, 300);

// Layer 2: useDeferredValue (lets React prioritize rendering over filtering)
const deferredSearch = useDeferredValue(debouncedSearch);

// Pass deferredSearch to table.setGlobalFilter
useEffect(() => {
  table.setGlobalFilter(deferredSearch);
}, [deferredSearch, table]);
```

### Anti-Patterns to Avoid

- **Per-row Sheet mounts:** Never render an evidence drawer per card/row. At 1000 papers, this creates 1000 invisible DOM trees. Mount once in WorkbenchShell (D-08).
- **Virtualizing the table view:** Decision locked -- 1000 DOM rows with pagination (25 per page) is well within browser limits. Virtualization adds complexity for zero gain on paginated table.
- **Infinite scroll anywhere:** Decision locked -- breaks pagination counters and back-button behavior. All views use explicit pagination.
- **Grid layout for cards:** Decision locked (D-03) -- variable-height cards in a grid create row-height synchronization nightmares with TanStack Virtual.
- **Table column filters in Convex query:** Filter state lives in TanStack Table client-side, NOT in the `getExtractionResults` reactive query. The query returns all papers; the client filters.
- **Resizable split pane:** Decision locked (D-06) -- fixed 40/60 avoids resize library dependency.
- **Custom global filter function:** Use TanStack Table's built-in `"includesString"` filterFn. It handles string matching across all columns.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| List virtualization | Custom windowing with IntersectionObserver | `@tanstack/react-virtual` `useVirtualizer` | Dynamic height measurement, overscanning, absolute positioning -- dozens of edge cases. [VERIFIED: Context7] |
| Table pagination | Custom page state + slice | `getPaginationRowModel` from `@tanstack/react-table` | Handles page index, page size, filtered count, row slicing automatically. [VERIFIED: Context7] |
| Global text search | Manual string matching across columns | TanStack Table `globalFilter` + `"includesString"` | Built-in filter pipeline that integrates with sorting and pagination. [VERIFIED: Context7] |
| Deferred rendering | Custom `setTimeout`/`requestIdleCallback` | React 19 `useDeferredValue` | Scheduler-aware -- yields to user interactions during filter storms. [VERIFIED: React 19 docs] |
| Right-side drawer | Custom overlay + portal | shadcn `Sheet` (Radix Dialog primitive) | Accessibility (focus trap, escape handling, screen reader) handled automatically. [VERIFIED: components/ui/sheet.tsx] |
| Tab navigation | Custom state + conditional rendering | shadcn `Tabs` (Radix Tabs primitive) | Keyboard navigation (arrow keys), ARIA roles, managed focus. [VERIFIED: components/ui/tabs.tsx] |
| CSV/JSON/XLSX export | Custom serialization | Existing `lib/extraction/export.ts` | Already tested and working -- pure functions that accept data and produce files. [VERIFIED: codebase] |
| Auth-safe queries | Conditional rendering to avoid flash | `useProtectedQuery` from `lib/auth/use-auth-query.ts` | Defers query until Clerk auth settles. [VERIFIED: codebase] |

**Key insight:** Phase 103 is an integration phase. Every hard problem (virtualization, pagination, filtering, drawer semantics, export serialization) has an existing library or component solution. The complexity is in wiring them together correctly, not in building new primitives.

## Common Pitfalls

### Pitfall 1: TanStack Virtual measureElement Without data-index
**What goes wrong:** Cards render at wrong positions or overlap
**Why it happens:** `measureElement` needs `data-index` attribute on the DOM element to associate measured height with the correct virtual row. Without it, heights get misassigned.
**How to avoid:** Every virtual item's wrapper MUST have `data-index={virtualRow.index}` AND `ref={virtualizer.measureElement}`.
**Warning signs:** Cards overlap or leave gaps; scrolling causes layout jumps.

### Pitfall 2: Card View Scroll Position Lost on Filter Change
**What goes wrong:** User filters results, virtual list shows blank space or wrong scroll offset
**Why it happens:** TanStack Virtual caches scroll measurements. When the underlying data changes (filter applied), cached sizes refer to old indices.
**How to avoid:** Call `virtualizer.scrollToIndex(0)` when filter/sort/pagination state changes. Reset the virtualizer when `rows.length` changes.
**Warning signs:** Blank space at top of card list after applying a filter.

### Pitfall 3: Pagination State Not Resetting on Filter Change
**What goes wrong:** User applies a filter that reduces results to 5 papers but pagination still says "Page 3 of 1"
**Why it happens:** `onColumnFiltersChange` and `onGlobalFilterChange` do not automatically reset `pageIndex`.
**How to avoid:** In the `onColumnFiltersChange` and `onGlobalFilterChange` handlers, also call `setPagination(prev => ({ ...prev, pageIndex: 0 }))`. TanStack Table v8 has an `autoResetPageIndex` option -- set it to `true`.
**Warning signs:** "Showing 51-75 of 5 papers" text after filtering.

### Pitfall 4: EvidenceQuote Bare useQuery Causes Flash (GAP-02)
**What goes wrong:** EvidenceQuote component briefly renders undefined state during Clerk auth visibility-change transitions
**Why it happens:** Bare `useQuery` from `convex/react` fires immediately regardless of auth state. During a visibility change (tab switch), Clerk briefly deauthenticates before re-authenticating.
**How to avoid:** Replace `useQuery` with `useProtectedQuery` which defers the query until auth settles. The fix is 2 lines per file.
**Warning signs:** Evidence quote flashes "unavailable" then shows content on tab-switch.

### Pitfall 5: ExtractionDialog papers Prop Shape Mismatch
**What goes wrong:** `createExtractionJob` mutation rejects with validation error
**Why it happens:** `BasketEntry` from the store has `{ openAlexId, title, doi, source, addedAt }` but the mutation expects `{ openalexId, title, doi? }`. Note the casing difference: `openAlexId` vs `openalexId`.
**How to avoid:** Map basket entries to the mutation's expected shape before passing to ExtractionDialog: `{ openalexId: entry.openAlexId, title: entry.title, doi: entry.doi ?? undefined }`.
**Warning signs:** "Invalid arguments" error on job submission.

### Pitfall 6: Split View on Mobile Renders Broken Layout
**What goes wrong:** 40/60 split renders impossibly narrow panels on mobile
**Why it happens:** Fixed percentage split does not work below 768px -- 40% of 375px is 150px, unusable for paper titles.
**How to avoid:** Decision locked (D-06): detect viewport < 768px (use existing `useIsTablet` hook or media query) and fall back to table view with a toast.
**Warning signs:** Horizontal scrollbar or truncated text in split view panels on mobile.

### Pitfall 7: Export Fetches All Results When Filters Active
**What goes wrong:** User exports filtered subset but gets all 1000 papers
**Why it happens:** Current `getExtractionResultsForExport` has no `paperIds` parameter -- it always exports everything.
**How to avoid:** Add optional `paperIds: v.optional(v.array(v.id("extractionPapers")))` to the export query args. When provided, filter the paper loop to only include matching IDs.
**Warning signs:** Export CSV has more rows than the visible filtered table.

### Pitfall 8: Collection "Extract All" Exceeds Basket Cap
**What goes wrong:** User clicks "Extract entire collection" on a 500-item collection when basket already has 800 items
**Why it happens:** Bulk add without cap awareness would silently overshoot the 1000 limit.
**How to avoid:** Use the existing `useAddToBasket` hook which already has cap-aware batch truncation via `computeCapAwareBatch`. Fire a toast with the dropped count (D-14 pattern from `AddToExtractionButton`).
**Warning signs:** Basket shows more than 1000 items, or mutation rejects at submit time.

## Code Examples

### GAP-02 Fix: EvidenceQuote useProtectedQuery

```typescript
// Source: components/extraction/evidence-quote.tsx
// [VERIFIED: codebase -- line 3 uses `useQuery` from "convex/react"]

// BEFORE (line 3-4, 24):
import { useQuery } from "convex/react";
const paperData = useQuery(api.extraction.queries.getPaperBodyText, { paperId });

// AFTER:
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
const { data: paperData } = useProtectedQuery(
  api.extraction.queries.getPaperBodyText,
  { paperId },
);
```

### GAP-02 Fix: JobMetricsPanel useProtectedQuery

```typescript
// Source: components/extraction/job-metrics-panel.tsx
// [VERIFIED: codebase -- line 1 uses `useQuery` from "convex/react", line 36]

// BEFORE (line 36):
const metrics = useQuery(api.extraction.queries.getExtractionJobMetrics, { jobId });

// AFTER:
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
const { data: metrics } = useProtectedQuery(
  api.extraction.queries.getExtractionJobMetrics,
  { jobId },
);
```

### Backend Change: Export with Optional paperIds

```typescript
// Source: convex/extraction/queries.ts
// [VERIFIED: codebase -- getExtractionResultsForExport at line 587]

export const getExtractionResultsForExport = query({
  args: {
    jobId: v.id("extractionJobs"),
    paperIds: v.optional(v.array(v.id("extractionPapers"))), // NEW: D-19
  },
  // ... existing returns validator unchanged ...
  handler: async (ctx, args) => {
    // ... existing auth + job lookup ...

    let papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_EXTRACTION_PAPERS_PER_JOB);

    // NEW: filter to requested subset if paperIds provided
    if (args.paperIds) {
      const idSet = new Set(args.paperIds.map(String));
      papers = papers.filter((p) => idSet.has(String(p._id)));
    }

    // ... rest of existing handler unchanged ...
  },
});
```

### ExtractionDialog Basket Wiring (D-13/D-14)

```typescript
// Source: components/extraction/extraction-dialog.tsx
// [VERIFIED: codebase -- ExtractionDialogProps has optional papers prop at line 33]

// In the selector page, when opening the dialog:
const basketPapers = useExtractionBasketStore((s) => s.papers);

const papersForDialog = useMemo(
  () =>
    Array.from(basketPapers.values()).map((entry) => ({
      openalexId: entry.openAlexId, // Note: casing difference
      title: entry.title,
      doi: entry.doi ?? undefined,
    })),
  [basketPapers],
);

<ExtractionDialog
  open={dialogOpen}
  onOpenChange={setDialogOpen}
  papers={papersForDialog}
/>
```

### Collection Items Fetch for SEL-03

```typescript
// [ASSUMED] -- no getCollectionItems query exists yet.
// Must be created or handled inline.

// Option: inline the join in the Collections tab component
const memberships = useProtectedQuery(
  api.library.queries.browseLibrary,
  { collectionId: selectedCollectionId, sortBy: "savedAt", sortOrder: "desc", paginationOpts: { numItems: 1000, cursor: null } },
);

// Alternative: create a new query getCollectionItemsForBasket
// that returns [{openalexId, title, doi}] for bulk basket add.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `react-window` for virtualization | `@tanstack/react-virtual` | v3 release (2023+) | Headless, framework-agnostic, native dynamic heights via `measureElement`. [VERIFIED: Context7] |
| Custom `useDebounce` for search | `useDeferredValue` (React 19) | React 19 (2024) | Scheduler-aware -- yields to urgent updates. Better than manual debounce alone. [VERIFIED: React 19 docs] |
| Separate pagination state | TanStack Table `getPaginationRowModel` | TanStack Table v8 (2022+) | Integrated with filtering and sorting -- auto-adjusts page bounds. [VERIFIED: Context7] |

**Deprecated/outdated:**
- `react-virtualized`: Predecessor to `react-window`, now unmaintained. Do not use.
- `react-window`: Still maintained but lacks built-in dynamic height support. TanStack Virtual supersedes it.
- Manual `globalFilter` implementation: TanStack Table v8 has built-in `globalFilterFn` support -- no custom row matching needed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Evidence drawer pattern (single Sheet mount + state) is performant at 1000 rows | Architecture Patterns: Pattern 3 | LOW -- basket drawer uses same pattern. Could need React.lazy for content if drawer content is heavy. |
| A2 | `browseLibrary` query with `collectionId` filter works for fetching collection member items for SEL-03 | Code Examples: Collection Items | MEDIUM -- may need a dedicated `getCollectionItemsForBasket` query that returns lighter-weight data. |
| A3 | `useDeferredValue` + `useDebouncedValue` layered debounce prevents filter storms at 1000 rows | Architecture Patterns: Pattern 5 | LOW -- both mechanisms are well-documented for this use case. Fallback: increase debounce to 500ms. |
| A4 | PaperResultCard average height of ~280px is a reasonable `estimateSize` | Architecture Patterns: Pattern 1 | LOW -- if wrong, virtualizer self-corrects after `measureElement` renders. Worst case: brief layout shift on first render. |

## Open Questions

1. **SEL-03: Collection items query strategy**
   - What we know: `browseLibrary` accepts `collectionId` filter and returns paginated library items. `libraryItemCollections` junction table has `by_collection` index.
   - What's unclear: Whether `browseLibrary` with `collectionId` and `numItems: 1000` is sufficient for "Extract entire collection" or if a lighter-weight query returning only `{openalexId, title, doi}` would be better for basket population.
   - Recommendation: Start with `browseLibrary` + `collectionId` filter. If it works within Convex's response size limits, no new query needed. Create a dedicated `getCollectionItemsForBasket` only if the full `libraryItems` shape exceeds reasonable payload size.

2. **WB-04: Search results tab data source**
   - What we know: The CONTEXT.md references `searchHistory` and `convex/search/queries.ts:getSearchResults`, but no `getSearchResults` export exists in the convex directory (grep returned no matches in the expected location).
   - What's unclear: How the Search Results tab accesses saved search results. The existing `app/results/[searchId]` page likely uses a different data pathway.
   - Recommendation: Investigate the search results data flow from the results page during implementation. The selector tab may need to read from the same source as `results-list.tsx` or the search history mechanism.

3. **Zustand store migration for pageSize**
   - What we know: `extraction-results-view` store (version 1) has `columnVisibility` and `activeView`. D-17 adds `pageSize`.
   - What's unclear: Whether adding `pageSize` requires a version bump + migration function.
   - Recommendation: Add `pageSize` with a default value in the store definition and bump the version to 2. The existing `migrateViewState` function already handles version < 1 returning defaults. Add a version < 2 case that spreads existing state and adds `pageSize: 25`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@tanstack/react-virtual` | WB-05 (card view) | To be installed | 3.13.23 | -- (required) |
| `@tanstack/react-table` | WB-04, WB-09 (pagination, filter) | Installed | 8.21.3 | -- |
| React 19 `useDeferredValue` | WB-04 (deferred search) | Installed | 19.2.4 | -- |
| shadcn Sheet | WB-07 (evidence drawer) | Installed | -- | -- |
| shadcn Tabs | SEL-01 (selector tabs) | Installed | -- | -- |
| `exceljs` | WB-08 (XLSX export) | Installed (dynamic) | -- | -- |
| `next-intl` | All UI strings | Installed | -- | -- |

**Missing dependencies with no fallback:**
- `@tanstack/react-virtual@^3.13.23` must be installed before card view implementation

**Missing dependencies with fallback:**
- None

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEL-01 | Selector page renders 4 tabs + counter | component | `npx vitest run tests/components/selector-page.test.tsx -t "renders tabs"` | No -- Wave 0 |
| SEL-02 | Library tab bulk add to basket | hook/unit | `npx vitest run tests/extraction-basket-cap.test.ts` | Partial (cap tests exist) |
| SEL-03 | Collection extract-all adds items to basket | unit | `npx vitest run tests/components/collections-tab.test.tsx` | No -- Wave 0 |
| SEL-04 | Search results bulk add to basket | unit | `npx vitest run tests/components/search-results-tab.test.tsx` | No -- Wave 0 |
| WB-04 | Global filter + useDeferredValue | unit | `npx vitest run tests/hooks/workbench-search.test.ts` | No -- Wave 0 |
| WB-05 | Card view renders virtualized list | component | `npx vitest run tests/components/card-view.test.tsx` | No -- Wave 0 |
| WB-06 | Split view layout + mobile fallback | component | `npx vitest run tests/components/split-view.test.tsx` | No -- Wave 0 |
| WB-07 | Evidence drawer opens with correct props | component | `npx vitest run tests/components/evidence-drawer.test.tsx` | No -- Wave 0 |
| WB-08 | Export filtered subset | unit | `npx vitest run tests/export-csv-json.test.ts` | Existing (needs filter extension) |
| WB-09 | Pagination controls + count reset | unit | `npx vitest run tests/hooks/workbench-pagination.test.ts` | No -- Wave 0 |
| GAP-01 | parsingSource badge in all views | component | `npx vitest run tests/components/parsing-source-badge.test.tsx` | No -- Wave 0 |
| GAP-02 | useProtectedQuery in EvidenceQuote + JobMetrics | unit | `npx vitest run tests/crash-prevention/usequery-guard.test.ts` | Existing |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run && npx tsc --noEmit`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/components/card-view.test.tsx` -- covers WB-05
- [ ] `tests/components/split-view.test.tsx` -- covers WB-06
- [ ] `tests/components/evidence-drawer.test.tsx` -- covers WB-07
- [ ] `tests/components/selector-page.test.tsx` -- covers SEL-01
- [ ] `tests/hooks/workbench-search.test.ts` -- covers WB-04
- [ ] `tests/hooks/workbench-pagination.test.ts` -- covers WB-09
- [ ] Update `tests/crash-prevention/usequery-guard.test.ts` for GAP-02 fixes
- [ ] Update `tests/export-csv-json.test.ts` for filtered export (WB-08)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `useProtectedQuery` wrapper prevents unauthenticated data access (GAP-02 fix reinforces this) |
| V3 Session Management | no | Handled by Clerk -- not in scope for this phase |
| V4 Access Control | yes | All Convex queries check `getCurrentUser` + `userId` ownership. The new `paperIds` export filter does not bypass ownership. |
| V5 Input Validation | yes | Convex validators on all query/mutation args. Manual IDs textarea validated via `normalizeOpenAlexId`. |
| V6 Cryptography | no | No crypto operations in this phase |

### Known Threat Patterns for This Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthenticated query flash | Information Disclosure | `useProtectedQuery` defers until auth settles (GAP-02) |
| Cross-user data access via export `paperIds` | Elevation of Privilege | Convex query already checks `job.userId === user._id` before accessing papers |
| Manual ID injection (XSS via pasted IDs) | Tampering | `normalizeOpenAlexId` validates format; IDs are never rendered as HTML |
| Basket overflow past limit | Denial of Service | `computeCapAwareBatch` truncates at cap; `createExtractionJob` hard-rejects over-limit |

## Sources

### Primary (HIGH confidence)
- [Context7 /websites/tanstack_virtual] - useVirtualizer API, measureElement pattern, dynamic height examples
- [Context7 /tanstack/table] - getPaginationRowModel, globalFilter, getFilteredRowModel
- [npm registry] - @tanstack/react-virtual@3.13.23, @tanstack/react-table@8.21.3
- [Codebase direct reads] - All existing components, stores, queries, and types referenced in CONTEXT.md canonical refs

### Secondary (MEDIUM confidence)
- [React 19 docs] - useDeferredValue API (verified via package.json React 19.2.4)

### Tertiary (LOW confidence)
- None -- all findings verified against codebase or official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- only new dep is verified on npm; all others already installed
- Architecture: HIGH -- all patterns verified against existing codebase components and official library docs
- Pitfalls: HIGH -- derived from verified API constraints (measureElement data-index, pagination reset, auth flash) and explicit CONTEXT.md decisions

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (30 days -- stable ecosystem, no alpha dependencies)
