---
phase: 103-workbench-views-selector-page
verified: 2026-04-16T14:30:00Z
status: gaps_found
score: 11/12 must-haves verified
overrides_applied: 0
gaps:
  - truth: "User clicks any citation in any view and a highlighted evidence drawer opens rendering the verbatim source.text.slice(evidence_start_char, evidence_end_char) with a parsing-source badge -- never the LLM's evidence_quote field (WB-07)"
    status: partial
    reason: "EvidenceDrawer component exists, is mounted in WorkbenchShell, and renders verbatim slice with parsingSource badge correctly. However, the openEvidence callback is void-ed (line 132 of workbench-shell.tsx) and never passed to CardView or SplitView. EvidenceQuote has role='link' and cursor-pointer but no onClick handler. Clicking a citation does NOT open the drawer. Evidence is only displayed inline via PaperResultCard."
    artifacts:
      - path: "components/extraction/workbench-shell.tsx"
        issue: "openEvidence callback is voided on line 132 and not passed to CardView or SplitView"
      - path: "components/extraction/card-view.tsx"
        issue: "CardViewProps does not include onEvidenceClick prop"
      - path: "components/extraction/split-view.tsx"
        issue: "SplitViewProps does not include onEvidenceClick prop"
      - path: "components/extraction/evidence-quote.tsx"
        issue: "Has role='link' and cursor-pointer but no onClick handler to trigger the drawer"
    missing:
      - "Pass openEvidence to CardView and SplitView as onEvidenceClick prop"
      - "Add onEvidenceClick to CardViewProps and SplitViewProps interfaces"
      - "Add onClick handler to EvidenceQuote or to PaperResultCard's evidence section that triggers the drawer via onEvidenceClick callback"
      - "Remove void openEvidence from workbench-shell.tsx line 132"
human_verification:
  - test: "Navigate to /extraction/new and verify 5 tabs render (Library, Collections, Search Results, Manual IDs, Zotero disabled)"
    expected: "All 5 tabs visible, Zotero tab greyed out/disabled, ExtractionCounter visible in header and footer"
    why_human: "Visual layout, tab styling, disabled state appearance cannot be verified programmatically"
  - test: "Add papers from Library tab via bulk select, verify ExtractionCounter updates"
    expected: "Counter increments, progress bar updates, basket drawer shows added papers"
    why_human: "Interactive flow crossing multiple components and Zustand state"
  - test: "Switch between table, card, and split views on /extraction/[jobId]"
    expected: "Smooth animated transitions, card view scrolls without jank on large datasets, split view shows 40/60 layout"
    why_human: "Animation quality, scroll performance, visual layout fidelity"
  - test: "Search for a paper title in the workbench toolbar"
    expected: "Results filter in real-time with visible debounce, no UI freezing"
    why_human: "Debounce timing and perceived responsiveness"
  - test: "Export filtered results as CSV with active search filter"
    expected: "Downloaded CSV contains only the filtered subset, export note shows filtered count"
    why_human: "File download behavior and content verification"
  - test: "Resize browser to mobile width (< 768px) while in split view"
    expected: "Auto-switches to table view with toast notification"
    why_human: "Responsive behavior and toast appearance"
---

# Phase 103: Workbench Views + Selector Page Verification Report

**Phase Goal:** The two user-facing surfaces that make v7.0 feel real -- a four-view extraction results workbench and a unified cross-source paper selector page -- wired end-to-end with the primitives from 101, the basket from 99, and the backend actions from 100.
**Verified:** 2026-04-16T14:30:00Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User navigates to `/extraction/new` and sees a selector page with 4 tabs (Library, Collections, Search Results, Manual IDs) and a sticky "X / 1000" counter (SEL-01) | VERIFIED | `app/extraction/new/page.tsx` server component renders `SelectorPageClient` which mounts 5 TabsTriggers (Library, Collections, Search, Manual, Zotero disabled). ExtractionCounter in sticky header and footer renders "X / 1000" with progress bar. |
| 2 | User bulk-selects papers from the Library tab and adds them to the basket in one action (SEL-02) | VERIFIED | `app/extraction/new/library-tab.tsx` uses `useProtectedQuery(api.library.queries.listLibrary)`, checkboxes with `handleToggle`/`handleToggleAll`, "Add selected" button calls `addToBasket(toAdd)` with `source: "library"`. |
| 3 | User clicks "Extract entire collection" and all collection items are staged into the basket (SEL-03) | VERIFIED | `app/extraction/new/collections-tab.tsx` has `CollectionRow` component with per-collection `useProtectedQuery(listLibrary, {collectionId})` and `handleAddAll` calling `addToBasket(toAdd)` with `source: "collection"`. Button labeled `t("extractCollection")`. |
| 4 | User bulk-selects papers from the Search Results tab and adds them to the basket (SEL-04) | VERIFIED | `app/extraction/new/search-results-tab.tsx` uses search history store, fetches via `getSearchResultsWithFilters`, supports checkboxes + "Add selected" button with `addToBasket(toAdd)` and `source: "search"`. |
| 5 | User runs a full-text search over paper titles/authors/answers, debounced via useDeferredValue (WB-04) | VERIFIED | `workbench-toolbar.tsx` implements layered debounce: `useDebouncedValue(searchInput, 300)` -> `useDeferredValue(debouncedSearch)` -> `table.setGlobalFilter(deferredSearch)`. WorkbenchShell uses `globalFilterFn: "includesString"`. |
| 6 | User switches to Card view and scrolls through 1000 cards without crashing, virtualized via @tanstack/react-virtual (WB-05) | VERIFIED | `components/extraction/card-view.tsx` uses `useVirtualizer` from `@tanstack/react-virtual@^3.13.23` with `estimateSize: () => 280`, `overscan: 5`, `data-index`, `measureElement`, and `scrollToIndex(0)` on data change. Wired into WorkbenchShell card branch. |
| 7 | User switches to Split view and sees a paginated paper list on the left with detail on the right (WB-06) | VERIFIED | `components/extraction/split-view.tsx` has `w-[40%]`/`w-[60%]` fixed split, `SPLIT_PAGE_SIZE = 10`, `selectedPaperId` state, `PaperResultCard` in right panel, scroll-to-top on selection. Wired into WorkbenchShell split branch. |
| 8 | User clicks any citation in any view and a highlighted evidence drawer opens with verbatim slice and parsingSource badge (WB-07) | FAILED | EvidenceDrawer component exists and is mounted in WorkbenchShell. However, `openEvidence` is `void`-ed (line 132) and not passed to CardView/SplitView. EvidenceQuote has `role="link"` and `cursor-pointer` but NO onClick handler. Clicking a citation does NOT open the drawer. Evidence is displayed inline only. |
| 9 | User exports currently-filtered result subset as CSV/JSON/XLSX matching filter state (WB-08) | VERIFIED | `workbench-toolbar.tsx` has export dropdown with `handleExport` calling `convex.query(getExtractionResultsForExport, { jobId, paperIds })`. `hasActiveFilters` check sends filtered `paperIds`. Backend `convex/extraction/queries.ts` has `paperIds: v.optional(v.array(v.id("extractionPapers")))` with `idSet` filter. |
| 10 | User paginates table/card/split views with "X-Y of Z papers" counts that reset on filter change (WB-09) | VERIFIED | `components/extraction/pagination-controls.tsx` renders `paginationShowing` with `start`/`end`/`total`, Previous/Next buttons. WorkbenchShell uses `getPaginationRowModel()` with `autoResetPageIndex: true`. Split view has its own pagination at `SPLIT_PAGE_SIZE = 10`. |
| 11 | Every paper row/card in every view renders a parsingSource badge (GAP-01) | VERIFIED | Table: `workbench-columns.tsx` has `accessorKey: "parsingSource"` column. Card: `PaperResultCard` renders `paper.parsingSource` Badge. Split: `SplitViewRow` renders `paper.parsingSource` Badge. EvidenceDrawer renders `parsingSource` Badge. |
| 12 | EvidenceQuote and JobMetricsPanel use useProtectedQuery not bare useQuery (GAP-02) | VERIFIED | `evidence-quote.tsx` line 3: `import { useProtectedQuery } from "@/lib/auth/use-auth-query"`, line 24: `const { data: paperData } = useProtectedQuery(...)`. `job-metrics-panel.tsx` line 3: `import { useProtectedQuery }`, line 36: `const { data: metrics } = useProtectedQuery(...)`. No `useQuery from "convex/react"` in either file. |

**Score:** 11/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/extraction/new/page.tsx` | Server component for /extraction/new route | VERIFIED | 14 lines, exports `ExtractionNewPage`, renders `SelectorPageClient` |
| `app/extraction/new/selector-page-client.tsx` | Client component with tabs, counter, footer, ExtractionDialog wiring | VERIFIED | 148 lines, 5 tabs, sticky header/footer, ExtractionDialog with `papersForDialog` |
| `app/extraction/new/library-tab.tsx` | Library items with checkboxes and AddToExtractionButton | VERIFIED | 178 lines, `useProtectedQuery`, `useAddToBasket`, `AddToExtractionButton`, `source: "library"` |
| `app/extraction/new/collections-tab.tsx` | Collection list with Extract entire collection button | VERIFIED | 136 lines, `useProtectedQuery`, per-collection query, `t("extractCollection")` |
| `app/extraction/new/search-results-tab.tsx` | Search results with bulk select | VERIFIED | 307 lines, search history store, `getSearchResultsWithFilters`, `source: "search"` |
| `app/extraction/new/manual-ids-tab.tsx` | Textarea + Resolve & Add button | VERIFIED | 136 lines, `resolveManualIds` action, `normalizeOpenAlexId`, `font-mono`, `source: "manual"` |
| `components/extraction/workbench-shell.tsx` | Fully wired shell with CardView, SplitView, EvidenceDrawer, mobile fallback | VERIFIED (with gap) | 237 lines, imports and renders CardView/SplitView/EvidenceDrawer, has mobile fallback. But `openEvidence` is voided. |
| `components/extraction/workbench-toolbar.tsx` | Toolbar with search input and export dropdown | VERIFIED | 319 lines, layered debounce search, export dropdown with CSV/JSON/XLSX |
| `components/extraction/pagination-controls.tsx` | Pagination UI with range text and prev/next | VERIFIED | 69 lines, `paginationShowing`, `aria-live="polite"`, `h-11` touch targets |
| `components/extraction/card-view.tsx` | Virtualized single-column card list | VERIFIED | 99 lines, `useVirtualizer`, `estimateSize: () => 280`, `overscan: 5`, `data-index`, `measureElement` |
| `components/extraction/split-view.tsx` | 40/60 split with paginated left panel and detail right panel | VERIFIED | 148 lines, `w-[40%]`/`w-[60%]`, `SPLIT_PAGE_SIZE = 10`, `selectedPaperId`, `scrollTo({ top: 0 })` |
| `components/extraction/split-view-row.tsx` | Compact row for split view left panel | VERIFIED | 51 lines, `StatusBadge`, `parsingSource` Badge, `aria-selected`, keyboard accessible |
| `components/extraction/evidence-drawer.tsx` | Sheet-based evidence drawer with verbatim slice and metadata | VERIFIED | 139 lines, Sheet side="right", `EvidenceQuote`, `parsingSource` Badge, `CriticVerdictBadge`, `space-y-6`, `px-5 py-4` |
| `app/extraction/[jobId]/extraction-results-client.tsx` | Results page using WorkbenchShell | VERIFIED | 116 lines, `WorkbenchShell` with `data`, `questions`, `jobId`, `jobStatus`. No PaperResultCard, no DropdownMenu, `max-w-6xl`. |
| `convex/extraction/queries.ts` | Filtered export query with optional paperIds | VERIFIED | `paperIds: v.optional(v.array(v.id("extractionPapers")))`, `let papers`, `if (args.paperIds)` filter after auth check. |
| `lib/store/extraction-results-view.ts` | View store v2 with pageSize | VERIFIED | `pageSize: number`, `setPageSize`, `version: 2`, migration case for `version < 2`. |
| `components/extraction/evidence-quote.tsx` | Auth-safe evidence rendering (GAP-02 fix) | VERIFIED | `useProtectedQuery` import, no bare `useQuery`. |
| `components/extraction/job-metrics-panel.tsx` | Auth-safe metrics rendering (GAP-02 fix) | VERIFIED | `useProtectedQuery` import, no bare `useQuery`. |
| `messages/en-US.json` | All Phase 103 i18n keys | VERIFIED | `extraction.workbench.*` keys (searchPlaceholder through exportFilteredNote) and `extraction.selector.*` keys (title through startExtractionEmpty) present. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `extraction-results-client.tsx` | `workbench-shell.tsx` | `WorkbenchShell data= prop` | WIRED | Line 108: `<WorkbenchShell data={data.papers} questions={data.job.questions} jobId={jobId} jobStatus={data.job.status} />` |
| `workbench-shell.tsx` | `card-view.tsx` | CardView in activeView=card branch | WIRED | Line 203: `<CardView table={table} questions={questions} />` |
| `workbench-shell.tsx` | `split-view.tsx` | SplitView in activeView=split branch | WIRED | Line 217: `<SplitView table={table} questions={questions} />` |
| `workbench-shell.tsx` | `evidence-drawer.tsx` | Single EvidenceDrawer mount | WIRED | Line 230: `<EvidenceDrawer open={drawerState.open} onOpenChange={...} {...drawerState.props} />` |
| `workbench-shell.tsx` | `pagination-controls.tsx` | PaginationControls table prop | WIRED | Line 227: `<PaginationControls table={table} />` |
| `workbench-toolbar.tsx` | `workbench-shell.tsx` | table prop with globalFilter | WIRED | Line 181: `<WorkbenchToolbar table={table} jobId={jobId} jobStatus={jobStatus} />` |
| `selector-page-client.tsx` | `extraction-dialog.tsx` | papers prop from basket store | WIRED | Line 141-144: `<ExtractionDialog open={dialogOpen} onOpenChange={setDialogOpen} papers={papersForDialog} />` |
| `selector-page-client.tsx` | `extraction-basket.ts` | useExtractionBasketStore for papers | WIRED | Lines 32-33: `useExtractionBasketStore((s) => s.papers)` and `.papers.size` |
| `library-tab.tsx` | `use-add-to-basket.ts` | useAddToBasket hook | WIRED | Line 9: `import { useAddToBasket }`, Line 25: `const { addToBasket } = useAddToBasket()` |
| `manual-ids-tab.tsx` | `convex/openalex/actions.ts` | resolveManualIds action | WIRED | Line 6: `import { useAction }`, Line 22: `const resolveManualIds = useAction(api.openalex.actions.resolveManualIds)` |
| `workbench-shell.tsx` -> views | `openEvidence` callback | onEvidenceClick prop | NOT WIRED | openEvidence is `void`-ed on line 132. Not passed to CardView or SplitView. No onClick on EvidenceQuote. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `extraction-results-client.tsx` | `data` (papers, job) | `useProtectedQuery(getExtractionResults)` | Yes -- Convex DB query | FLOWING |
| `library-tab.tsx` | `items` (library papers) | `useProtectedQuery(listLibrary)` | Yes -- Convex DB query | FLOWING |
| `collections-tab.tsx` | `collections` | `useProtectedQuery(getCollectionsWithCounts)` | Yes -- Convex DB query | FLOWING |
| `search-results-tab.tsx` | `papers` | `getSearchResultsWithFilters` (OpenAlex API) | Yes -- external API | FLOWING |
| `manual-ids-tab.tsx` | `result` (resolved IDs) | `resolveManualIds` Convex action | Yes -- OpenAlex API resolution | FLOWING |
| `extraction-counter.tsx` | `count`, `limit` | `useExtractionBasketStore`, `useProtectedQuery(getExtractionLimit)` | Yes -- store + Convex query | FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED (no runnable entry points without starting dev server and Convex backend)

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SEL-01 | 103-02 | Selector page at /extraction/new with 4 tabs + Zotero placeholder | SATISFIED | 5 tabs rendered, Zotero disabled |
| SEL-02 | 103-02 | Bulk-select from Library tab | SATISFIED | Checkboxes + "Add selected" + AddToExtractionButton |
| SEL-03 | 103-02 | "Extract entire collection" button | SATISFIED | CollectionRow with handleAddAll |
| SEL-04 | 103-02 | Bulk-select from Search Results tab | SATISFIED | Search picker + checkboxes + addToBasket |
| WB-04 | 103-03 | Full-text client-side search with useDeferredValue | SATISFIED | Layered debounce in toolbar, globalFilterFn in shell |
| WB-05 | 103-04, 103-05 | Card view virtualized via @tanstack/react-virtual | SATISFIED | useVirtualizer with all required patterns |
| WB-06 | 103-04, 103-05 | Split view with paginated list + detail | SATISFIED | 40/60 split, SPLIT_PAGE_SIZE=10, PaperResultCard detail |
| WB-07 | 103-04, 103-05 | Evidence drawer with verbatim slice on citation click | BLOCKED | Drawer exists but click-to-open wiring is missing |
| WB-08 | 103-01, 103-03 | Export filtered subset as CSV/JSON/XLSX | SATISFIED | Export dropdown in toolbar, paperIds filter in backend |
| WB-09 | 103-01, 103-03 | Pagination with "X-Y of Z papers" counts | SATISFIED | PaginationControls component, autoResetPageIndex |
| GAP-01 | 103-01, 103-04 | parsingSource badge in all views | SATISFIED | Table column, PaperResultCard Badge, SplitViewRow Badge, EvidenceDrawer Badge |
| GAP-02 | 103-01 | useProtectedQuery in EvidenceQuote and JobMetricsPanel | SATISFIED | Both files import useProtectedQuery, no bare useQuery |

No orphaned requirements found. All 12 requirement IDs from REQUIREMENTS.md that map to Phase 103 appear in the plan frontmatters and are accounted for above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `workbench-shell.tsx` | 132 | `void openEvidence` -- prepared but unused callback | BLOCKER | Prevents WB-07 evidence drawer click-to-open from working |
| `evidence-quote.tsx` | 84 | `role="link"` with no onClick handler | WARNING | Misleading accessibility role -- suggests clickable but is not |

### Human Verification Required

1. **Selector page visual layout**
   - **Test:** Navigate to /extraction/new and verify 5 tabs render (Library, Collections, Search Results, Manual IDs, Zotero disabled)
   - **Expected:** All 5 tabs visible, Zotero tab greyed out/disabled, ExtractionCounter visible in header and footer
   - **Why human:** Visual layout, tab styling, disabled state appearance

2. **Basket add flow**
   - **Test:** Add papers from Library tab via bulk select, verify ExtractionCounter updates
   - **Expected:** Counter increments, progress bar updates, basket drawer shows added papers
   - **Why human:** Interactive flow crossing multiple components and Zustand state

3. **View switching animation**
   - **Test:** Switch between table, card, and split views on /extraction/[jobId]
   - **Expected:** Smooth animated transitions, card view scrolls without jank, split view shows 40/60 layout
   - **Why human:** Animation quality, scroll performance, visual layout fidelity

4. **Search debounce feel**
   - **Test:** Search for a paper title in the workbench toolbar
   - **Expected:** Results filter in real-time with visible debounce, no UI freezing
   - **Why human:** Debounce timing and perceived responsiveness

5. **Filtered export**
   - **Test:** Export filtered results as CSV with active search filter
   - **Expected:** Downloaded CSV contains only the filtered subset, export note shows filtered count
   - **Why human:** File download behavior and content verification

6. **Mobile split fallback**
   - **Test:** Resize browser to mobile width (< 768px) while in split view
   - **Expected:** Auto-switches to table view with toast notification
   - **Why human:** Responsive behavior and toast appearance

### Gaps Summary

**1 gap blocking goal achievement:**

The EvidenceDrawer is fully implemented as a component (verbatim slice, parsingSource badge, metadata sections, Sheet UI) and is correctly mounted once in WorkbenchShell outside the view branches. However, the critical click-to-open wiring is missing: the `openEvidence` callback is voided, neither CardView nor SplitView accept an `onEvidenceClick` prop, and EvidenceQuote renders evidence inline with `role="link"` styling but no onClick handler. The user can see evidence inline within PaperResultCard, but cannot click to open the dedicated evidence drawer with full metadata (parsingSource, model used, critic verdict).

This is a focused wiring gap -- all the pieces exist but the last connection (click handler -> drawer state) was not made. Plan 05's SUMMARY documented this as "CardView/SplitView use inline EvidenceQuote via PaperResultCard" and retained `openEvidence` for "future evidence-click-to-drawer integration." However, the ROADMAP success criterion explicitly requires "User clicks any citation in any view and a highlighted evidence drawer opens."

**To close this gap:**
1. Add `onEvidenceClick` prop to CardView and SplitView (or pass it through PaperResultCard)
2. Add an onClick handler to EvidenceQuote (or its parent in PaperResultCard) that calls `onEvidenceClick` with the evidence data
3. Pass `openEvidence` from WorkbenchShell to the view components instead of voiding it
4. Remove the `void openEvidence` line

---

_Verified: 2026-04-16T14:30:00Z_
_Verifier: Claude (gsd-verifier)_
