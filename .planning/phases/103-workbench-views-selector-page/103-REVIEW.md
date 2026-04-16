---
phase: 103-workbench-views-selector-page
reviewed: 2026-04-16T12:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - app/extraction/[jobId]/extraction-results-client.tsx
  - app/extraction/new/collections-tab.tsx
  - app/extraction/new/library-tab.tsx
  - app/extraction/new/manual-ids-tab.tsx
  - app/extraction/new/page.tsx
  - app/extraction/new/search-results-tab.tsx
  - app/extraction/new/selector-page-client.tsx
  - components/extraction/card-view.tsx
  - components/extraction/evidence-drawer.tsx
  - components/extraction/evidence-quote.tsx
  - components/extraction/job-metrics-panel.tsx
  - components/extraction/pagination-controls.tsx
  - components/extraction/split-view-row.tsx
  - components/extraction/split-view.tsx
  - components/extraction/workbench-shell.tsx
  - components/extraction/workbench-toolbar.tsx
  - convex/extraction/queries.ts
  - lib/store/extraction-results-view.ts
findings:
  critical: 1
  warning: 6
  info: 5
  total: 12
status: issues_found
---

# Phase 103: Code Review Report

**Reviewed:** 2026-04-16T12:00:00Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Phase 103 introduces the workbench views (CardView, SplitView with virtualization), the evidence drawer, the selector page with library/collections/search/manual tabs, pagination controls, and supporting Convex queries. Overall, the code is well-structured: auth guards are consistent across all Convex queries, Zustand hydration is handled correctly, and the TanStack Table instance is properly shared across views. However, there is one critical stale-closure bug in the export handler, several accessibility issues, hardcoded English strings bypassing i18n, and a few type-safety concerns.

## Critical Issues

### CR-01: Stale closure over `filteredPaperIds` in export callback

**File:** `components/extraction/workbench-toolbar.tsx:106-147`
**Issue:** `filteredPaperIds` is computed inline on every render (lines 106-108) and then captured in the `handleExport` `useCallback` dependency array. Because `filteredPaperIds` is a new array reference on every render, this defeats memoization entirely -- `handleExport` is recreated on every render. More critically, the array identity comparison in the deps means React sees it as "always changed," which causes unnecessary re-renders of the dropdown menu children. If the intent was to stabilize references, the array should be memoized with `useMemo`. If filters change rapidly (e.g., while typing a search term), `handleExport` could fire with a stale or intermediate filter set that does not match what the user sees.
**Fix:**
```typescript
// Wrap filteredPaperIds in useMemo to stabilize the reference
const filteredPaperIds = useMemo(
  () => table.getFilteredRowModel().rows.map((row) => row.original._id),
  [table.getFilteredRowModel().rows],
);
```
Alternatively, read `filteredPaperIds` inside `handleExport` rather than closing over it, and remove it from the dependency array:
```typescript
const handleExport = useCallback(
  async (fmt: "csv" | "json" | "xlsx") => {
    if (!jobId) return;
    const currentFilteredIds = table
      .getFilteredRowModel()
      .rows.map((row) => row.original._id);
    const currentHasFilters = globalFilter !== "" || columnFilters.length > 0;
    setIsExporting(true);
    try {
      const exportData = await convex.query(
        api.extraction.queries.getExtractionResultsForExport,
        {
          jobId: jobId as Id<"extractionJobs">,
          ...(currentHasFilters
            ? { paperIds: currentFilteredIds as Id<"extractionPapers">[] }
            : {}),
        },
      );
      // ... rest unchanged
    } finally {
      setIsExporting(false);
    }
  },
  [jobId, convex, globalFilter, columnFilters, table, t],
);
```

## Warnings

### WR-01: `EvidenceQuote` uses `role="link"` without navigation behavior

**File:** `components/extraction/evidence-quote.tsx:83-85`
**Issue:** The root element has `role="link"` and `tabIndex={0}` with `cursor-pointer`, but there is no `onClick` or `onKeyDown` handler. A screen reader will announce this as an interactive link, but activating it does nothing. This is a WCAG violation (4.1.2 Name, Role, Value) that the project's AAA accessibility target explicitly requires.
**Fix:** Either add an `onClick`/`onKeyDown` handler that navigates to the evidence in a PDF viewer, or change `role="link"` to a presentational element until the click-to-navigate feature is implemented:
```typescript
<div
  role="region"
  aria-label={`Evidence text from characters ${startChar} to ${endChar}`}
  className={cn(
    "rounded-md border-l-[3px] border-l-primary/40 bg-[var(--pdf-highlight)] px-4 py-2 text-sm leading-[1.43]",
    className,
  )}
>
```

### WR-02: Unsafe `as` type assertions for Convex IDs throughout

**File:** `components/extraction/card-view.tsx:87`, `components/extraction/split-view.tsx:129`, `components/extraction/evidence-drawer.tsx:90`, `components/extraction/workbench-toolbar.tsx:121`
**Issue:** Multiple files cast string values to Convex `Id<>` types using `as` (e.g., `paper._id as Id<"extractionPapers">`, `jobId as Id<"extractionJobs">`). If the string is malformed or tampered with, the cast silently passes and the Convex query will fail at runtime with a confusing error. This is repeated across 4+ files.
**Fix:** Validate at the boundary where the string first enters the component. For `jobId` from URL params, validate in the page component before passing down:
```typescript
// At the entry point (extraction-results-client.tsx or route handler):
import { Id } from "@/convex/_generated/dataModel";

// Convex will validate the ID format server-side, but the cast
// should be in one place, not scattered across leaf components.
// Consider a helper:
function asExtractionJobId(id: string): Id<"extractionJobs"> {
  // Convex IDs follow a known format; validate or let it fail at the boundary
  return id as Id<"extractionJobs">;
}
```

### WR-03: SplitView pagination does not reset when filters change

**File:** `components/extraction/split-view.tsx:36`
**Issue:** `currentPage` is local state (line 36) initialized to 0, but it is never reset when the underlying `allRows` changes due to filter/sort changes from the toolbar. If the user is on page 5 and then applies a filter that reduces results to 2 pages, `currentPage` will be 5 which is out of bounds. The `pageRows` slice on line 42-48 will return an empty array, showing a blank list with no visible error.
**Fix:** Add an effect to clamp `currentPage` when `allRows` changes:
```typescript
useEffect(() => {
  const maxPage = Math.max(0, Math.ceil(allRows.length / SPLIT_PAGE_SIZE) - 1);
  setCurrentPage((prev) => Math.min(prev, maxPage));
}, [allRows.length]);
```

### WR-04: `EvidenceDrawer` spreads potentially null props

**File:** `components/extraction/workbench-shell.tsx:231-234`
**Issue:** `{...drawerState.props}` is spread into `EvidenceDrawer`, but `drawerState.props` can be `null` (line 125: `props: null`). Spreading `null` in JSX is harmless in practice (React ignores it), but the TypeScript type `EvidenceDrawerProps | null` does not match the expected `Partial<EvidenceDrawerData>` interface of `EvidenceDrawer`. This works only because of structural overlap. If `EvidenceDrawerData` ever adds a required field, this will silently pass `undefined` for it.
**Fix:**
```typescript
<EvidenceDrawer
  open={drawerState.open}
  onOpenChange={(open) => setDrawerState((prev) => ({ ...prev, open }))}
  {...(drawerState.props ?? {})}
/>
```

### WR-05: Hardcoded English strings bypass i18n

**File:** `app/extraction/new/search-results-tab.tsx:98,300`, `app/extraction/new/collections-tab.tsx:119`
**Issue:** Several user-facing strings are hardcoded in English instead of using the `t()` translation function:
- Line 98: `"Failed to load search results. Try again."`
- Line 300: `"No papers found for this search."`
- Line 119 (collections-tab): `{itemCount === 1 ? "paper" : "papers"}` -- hardcoded English singular/plural instead of using ICU plural format via `t()`
**Fix:** Move all three to the translation files and use `t()`:
```typescript
// search-results-tab.tsx:98
setFetchError(t("searchFetchError"));

// search-results-tab.tsx:300
<p className="text-sm text-muted-foreground">
  {t("searchNoResults")}
</p>

// collections-tab.tsx:119 -- use ICU MessageFormat plural
{t("paperCount", { count: itemCount })}
```

### WR-06: `void openEvidence` suppresses unused-variable lint without actual usage path

**File:** `components/extraction/workbench-shell.tsx:132`
**Issue:** `void openEvidence;` is used to suppress the "unused variable" lint warning. The `openEvidence` callback is created but never passed to any child component (`CardView`, `SplitView`). This means the evidence drawer can never be opened -- clicking evidence in any view does nothing. While the comment says "Prepared for integration," shipping dead code paths without a wiring plan risks the feature being forgotten.
**Fix:** Either wire `openEvidence` as a prop to `CardView` and `SplitView` now, or remove the callback and the drawer mount entirely until the integration is ready. If keeping as a stub, add a tracking reference (e.g., a TODO with an issue number) rather than silently voiding it:
```typescript
// TODO(#XXX): Wire openEvidence to CardView/SplitView onEvidenceClick
```

## Info

### IN-01: `console.error` left in production export handler

**File:** `components/extraction/workbench-toolbar.tsx:140`
**Issue:** `console.error("Export failed:", err)` will leak error details to the browser console in production. The error is already surfaced to the user via `showStyledToast`.
**Fix:** Remove or gate behind a dev check:
```typescript
if (process.env.NODE_ENV === "development") {
  console.error("Export failed:", err);
}
```

### IN-02: Duplicate `ExtractionCounter` rendered in header and footer

**File:** `app/extraction/new/selector-page-client.tsx:61,102`
**Issue:** `<ExtractionCounter />` is rendered both in the sticky header (line 61) and the sticky footer (line 102). On short viewports both will be visible simultaneously, showing the same information twice. This is a UX concern rather than a bug, but may cause visual noise.
**Fix:** Consider showing the counter only in the footer (closer to the action button), or conditionally hide one based on scroll position using an `IntersectionObserver`.

### IN-03: Duplicate interface `EvidenceDrawerProps` defined in two files

**File:** `components/extraction/workbench-shell.tsx:39-47`, `components/extraction/evidence-drawer.tsx:25-33`
**Issue:** The `EvidenceDrawerProps` / `EvidenceDrawerData` interface is defined in both `workbench-shell.tsx` (line 39, exported) and `evidence-drawer.tsx` (line 25, as `EvidenceDrawerData`, exported). They have the same fields but different names. The shell's version is never imported anywhere else.
**Fix:** Remove the duplicate from `workbench-shell.tsx` and import `EvidenceDrawerData` from `evidence-drawer.tsx`:
```typescript
import { EvidenceDrawer, type EvidenceDrawerData } from "@/components/extraction/evidence-drawer";
```

### IN-04: `getReviewQueue` fetches 100 items then filters client-side

**File:** `convex/extraction/queries.ts:428-434`
**Issue:** `getReviewQueue` takes 100 items via `.take(100)` then filters to `reviewStatus === "pending"` in JavaScript (line 434). If most items are not pending, the result set will be much smaller than expected. The query could return 0 pending items even when some exist beyond the first 100.
**Fix:** If `reviewStatus` is indexed, use the index to filter directly. If not, consider adding a compound index `by_review_status_timestamp` on `(reviewStatus, timestamp)`:
```typescript
const pending = await ctx.db
  .query("qualityChecks")
  .withIndex("by_review_status", (q) => q.eq("reviewStatus", "pending"))
  .order("desc")
  .take(100);
```

### IN-05: SplitView left panel uses `role="grid"` without full grid semantics

**File:** `components/extraction/split-view.tsx:76`
**Issue:** The left panel container has `role="grid"` but its children (`SplitViewRow`) use `role="row"` without `role="gridcell"` children. A proper ARIA grid requires `grid > row > gridcell` nesting. Since this is a single-column selection list, `role="listbox"` with `role="option"` children would be more semantically correct.
**Fix:**
```typescript
// split-view.tsx
<div className="flex-1 overflow-y-auto" role="listbox" aria-label="Paper list">

// split-view-row.tsx
<div role="option" aria-selected={isSelected} ...>
```

---

_Reviewed: 2026-04-16T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
