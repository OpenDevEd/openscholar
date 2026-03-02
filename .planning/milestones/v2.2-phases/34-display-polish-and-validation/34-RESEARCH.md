# Phase 34: Display Polish and Validation - Research

**Researched:** 2026-03-01
**Domain:** Sort controls, cursor-based pagination UX, rating display, view mode toggle (React + Convex + nuqs)
**Confidence:** HIGH

## Summary

Phase 34 completes the library display layer with five DISP requirements. Analysis of the current codebase reveals that three of the five requirements are already substantially implemented: DISP-02 (sort disabled during search), DISP-04 (rating display on rows and cards), and DISP-05 (list/grid view mode toggle). The remaining work centers on two areas: (1) adding "title" as a fourth sort option (DISP-01), which requires a new Convex database index and extending the sort type definitions, and (2) replacing the current "Load More" infinite-scroll pattern with a proper pagination bar showing result counts ("X-Y of Z papers") with prev/next navigation (DISP-03).

The pagination work is the most complex part of this phase. Convex's `usePaginatedQuery` uses cursor-based pagination (not offset-based), returning `{page, isDone, continueCursor}` without total counts. To display "X-Y of Z papers", the implementation needs either: (a) a dedicated `getFilteredLibraryCount` Convex query that runs the same filters without pagination and returns a count, or (b) leveraging the existing `exportLibrary` query's result length (already fetched for the export feature). The `exportLibrary` query already applies all the same filters and returns all matching items -- its `.length` can serve as the filtered total count without adding a new query. For the page range (X-Y), the implementation can track the cumulative number of loaded items client-side since `usePaginatedQuery` accumulates results in `results[]`.

However, the DISP-03 requirement specifies prev/next navigation, not just "Load More". Convex's `usePaginatedQuery` only supports forward cursor pagination (no backward navigation). True prev/next requires either: (a) keeping the current "Load More" approach but displaying it as "showing 1-N of Z" (where N grows as the user loads more), or (b) building client-side page windowing on top of the accumulated results array. Option (b) is the recommended approach: load items progressively via `loadMore`, track all accumulated results, then slice the results array into pages client-side. This gives the user a traditional pagination feel while working within Convex's cursor-based model.

**Primary recommendation:** Add a `by_user_title` index to the Convex schema and extend sort types for "title" sorting. Implement client-side page windowing over the Convex `usePaginatedQuery` accumulated results to provide "X-Y of Z papers" pagination with prev/next buttons. Use `exportLibrary` result length as the filtered total count. Verify that the already-implemented DISP-02, DISP-04, and DISP-05 features work correctly and polish any rough edges.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DISP-01 | User can sort library items via dropdown (date saved, year, rating, title) | Current sort options are `savedAt`, `rating`, `publicationYear` -- missing "title". Requires: (1) new Convex index `by_user_title` on `["userId", "title"]` in schema.ts, (2) add `"title"` to `librarySortValues` in search-params.ts, (3) add `"title"` literal to `browseLibrary` args validator and `indexMap` in queries.ts, (4) add `sortTitle` i18n key across 6 locales. |
| DISP-02 | Sort options are disabled/hidden when text search is active (relevance ordering from search index) | **Already implemented.** The sort dropdown and order toggle in `library-page-client.tsx` have `disabled={hasSearchText}` with `opacity-50 cursor-not-allowed` styling and a tooltip explaining "Sort is disabled during search". Needs verification only -- no code changes required. |
| DISP-03 | Pagination displays result counts ("X-Y of Z papers") with prev/next navigation | Current "Load More" button at bottom of results list must be replaced/augmented with a pagination bar. Use `exportLibrary` result length for filtered total count (Z). Implement client-side page windowing: accumulate results via `loadMore`, slice into fixed-size pages, display "X-Y of Z papers" with prev/next buttons. Add `page` URL param via nuqs for bookmarkable page state. |
| DISP-04 | Rating is visually displayed on each library item row and card | **Already implemented.** Both `LibraryItemRow` and `LibraryItemCard` render 5 star icons with filled amber stars for the item's rating and muted empty stars for the remainder. Needs verification only. |
| DISP-05 | User can toggle between list and grid view modes | **Already implemented.** A `LayoutList`/`LayoutGrid` toggle button group in the content header switches between `params.view === "list"` (renders `LibraryItemRow` list) and `params.view === "grid"` (renders `LibraryItemCard` grid). The view mode is persisted in URL via nuqs `view` param. Needs verification only. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.2.4 | Component framework | Already in project |
| Next.js | ^16.1.6 | App router, SSR | Already in project |
| Convex | (project version) | Backend queries, cursor-based pagination | Already in project; `usePaginatedQuery` drives the data layer |
| nuqs | ^2.6.0 | URL state for sort, view, page params | Already used for all library URL state |
| next-intl | ^4.8.2 | i18n for sort labels, pagination text | Already used across all library components |
| lucide-react | ^0.487.0 | Icons (ChevronLeft, ChevronRight, LayoutList, LayoutGrid, ArrowUp, ArrowDown) | Already used in library components |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn/ui Select | (project version) | Sort dropdown UI | Already used in content header sort dropdown |
| shadcn/ui Button | (project version) | Pagination prev/next buttons | Already used throughout library |
| shadcn/ui Tooltip | (project version) | Sort disabled tooltip | Already used in content header |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Client-side page windowing over accumulated results | True offset-based pagination (new Convex queries with skip/limit) | Convex does not natively support offset-based queries. Would require `.collect()` then `.slice()` server-side, which fetches all data on every page change. Client-side windowing reuses the existing cursor pagination and only loads incrementally. |
| `exportLibrary` result length for total count | New `getFilteredLibraryCount` query | `exportLibrary` already applies all filters and is already fetched for the export feature. Using its `.length` avoids adding another query. Downside: it fetches all items not just a count, but it is already being fetched anyway. |
| Adding `page` to nuqs URL state | Keeping page in local React state | URL persistence allows bookmarking page 3 of results, and back button navigates pages. Better UX. |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
components/
  library/
    library-page-client.tsx     # MODIFIED - add title sort option, replace Load More with pagination bar
    library-item-row.tsx        # EXISTING - already displays rating stars (DISP-04)
    library-item-card.tsx       # EXISTING - already displays rating stars (DISP-04)
    library-item-skeleton.tsx   # EXISTING - unchanged
    library-empty-state.tsx     # EXISTING - unchanged
    library-filters.tsx         # EXISTING - may still be referenced but superseded by Phase 33
    library-filter-sidebar.tsx  # EXISTING - unchanged
    library-filter-content.tsx  # EXISTING - unchanged
    library-search-bar.tsx      # EXISTING - unchanged
convex/
  library/
    queries.ts                  # MODIFIED - add "title" to browseLibrary sort options + indexMap
  schema.ts                     # MODIFIED - add by_user_title index on libraryItems
lib/
  library/
    search-params.ts            # MODIFIED - add "title" to librarySortValues
messages/
  en-US.json                    # MODIFIED - add sortTitle, pagination i18n keys
  en-GB.json                    # MODIFIED - same
  fr.json                       # MODIFIED - same
  hi.json                       # MODIFIED - same
  ja.json                       # MODIFIED - same
  zh.json                       # MODIFIED - same
```

### Pattern 1: Add "title" Sort Option

**What:** Extend the sort system to support sorting by paper title alphabetically.

**When to use:** DISP-01 implementation.

**Example (schema change):**
```typescript
// convex/schema.ts -- add index to libraryItems table
libraryItems: defineTable({
  // ... existing fields ...
})
  .index("by_user", ["userId"])
  .index("by_user_openalexId", ["userId", "openalexId"])
  .index("by_user_rating", ["userId", "rating"])
  .index("by_user_savedAt", ["userId", "savedAt"])
  .index("by_user_year", ["userId", "publicationYear"])
  .index("by_user_title", ["userId", "title"])  // NEW
  .searchIndex("search_library", {
    searchField: "searchableText",
    filterFields: ["userId", "rating"],
  }),
```

**Example (search-params change):**
```typescript
// lib/library/search-params.ts
export const librarySortValues = ["savedAt", "rating", "publicationYear", "title"] as const;
```

**Example (query change):**
```typescript
// convex/library/queries.ts -- extend browseLibrary
const indexMap = {
  savedAt: "by_user_savedAt",
  rating: "by_user_rating",
  publicationYear: "by_user_year",
  title: "by_user_title",  // NEW
} as const;
```

### Pattern 2: Client-Side Page Windowing

**What:** Use Convex's `usePaginatedQuery` for data fetching but present results in fixed-size pages with prev/next navigation client-side.

**When to use:** DISP-03 implementation.

**Key Concept:**
- `usePaginatedQuery` accumulates ALL loaded results in `results[]` and provides `loadMore(N)` to fetch the next batch.
- Track a `page` number in URL state via nuqs (e.g., `p: parseAsInteger.withDefault(1)`).
- Compute the display window: `startIdx = (page - 1) * PAGE_SIZE`, `endIdx = page * PAGE_SIZE`.
- Slice `results[startIdx..endIdx]` for the current page display.
- When the user navigates to a page beyond loaded results, call `loadMore` to fetch more.
- Use `exportLibrary` result length as the total filtered count for "of Z papers".

**Example:**
```typescript
// In library-page-client.tsx
const PAGE_SIZE = 20;

// Add page to URL state
// In search-params.ts: p: parseAsInteger.withDefault(1)
const currentPage = params.p;

// Total filtered count from already-fetched export data
const filteredTotal = exportItems?.length ?? 0;
const totalPages = Math.ceil(filteredTotal / PAGE_SIZE);

// Slice accumulated results for current page display
const startIdx = (currentPage - 1) * PAGE_SIZE;
const endIdx = currentPage * PAGE_SIZE;
const pageResults = displayResults.slice(startIdx, endIdx);

// Ensure enough results are loaded for the requested page
useEffect(() => {
  if (endIdx > activeResults.results.length && activeResults.status === "CanLoadMore") {
    activeResults.loadMore(PAGE_SIZE);
  }
}, [currentPage, activeResults.results.length, activeResults.status]);

// Pagination display: "1-20 of 150 papers"
const rangeStart = startIdx + 1;
const rangeEnd = Math.min(endIdx, filteredTotal);

// Prev/Next handlers
const goToPrev = () => setParams({ p: Math.max(1, currentPage - 1) });
const goToNext = () => setParams({ p: Math.min(totalPages, currentPage + 1) });
```

### Pattern 3: Pagination Bar Component

**What:** A simple pagination bar component displaying result counts and prev/next buttons.

**When to use:** Below the results list in `library-page-client.tsx`.

**Example:**
```typescript
// Inline in library-page-client.tsx or extracted to a small component
<div className="flex items-center justify-between py-4 border-t border-border/40">
  <p className="text-sm text-muted-foreground">
    {t("showingRange", { start: rangeStart, end: rangeEnd, total: filteredTotal })}
  </p>
  <div className="flex items-center gap-2">
    <Button
      variant="outline"
      size="sm"
      onClick={goToPrev}
      disabled={currentPage <= 1}
    >
      <ChevronLeft className="h-4 w-4 mr-1" />
      {t("previous")}
    </Button>
    <Button
      variant="outline"
      size="sm"
      onClick={goToNext}
      disabled={currentPage >= totalPages}
    >
      {t("next")}
      <ChevronRight className="h-4 w-4 ml-1" />
    </Button>
  </div>
</div>
```

### Anti-Patterns to Avoid

- **Building a separate `getFilteredLibraryCount` query:** The `exportLibrary` query already fetches all matching items with the same filter logic. Duplicating the filter logic in a count-only query adds maintenance burden and risks filter logic drift. Use `exportItems.length` instead.
- **Attempting Convex backward cursor pagination:** Convex's `usePaginatedQuery` only supports forward cursors. Do not try to store and reuse previous cursors for backward navigation -- it is unsupported and fragile. Use client-side windowing instead.
- **Storing page state in local React state instead of URL:** Page number should be in the URL so bookmarking and back-button navigation work. Use nuqs `parseAsInteger`.
- **Not resetting page to 1 when filters change:** When any filter, sort, or search parameter changes, the page must reset to 1. Otherwise the user might be on page 5 of the old results but the new filter only has 2 pages.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Offset-based pagination on Convex | Custom skip/limit queries | Client-side windowing over `usePaginatedQuery` results | Convex does not support offset queries; `.collect().slice()` fetches everything server-side every time |
| Filtered total count | New `getFilteredLibraryCount` query | `exportItems.length` from already-fetched `exportLibrary` | Avoids duplicating filter logic; query is already running |
| Pagination UI component | Custom pagination from scratch | Follow `SmartPagination` pattern from extraction feature or build simple prev/next inline | The extraction feature has a working pagination pattern to reference |
| Sort dropdown with disabled tooltip | Custom disabled state handling | Existing pattern already in `library-page-client.tsx` | Already implemented with `disabled={hasSearchText}` + Tooltip |

**Key insight:** Most of Phase 34's scope is already implemented. The primary new work is adding "title" sort (schema + query + UI changes) and implementing pagination display with result counts. Both are well-contained changes that build on existing patterns.

## Common Pitfalls

### Pitfall 1: Page State Not Resetting When Filters Change
**What goes wrong:** User is on page 3, changes a filter, and the page still shows 3 even though the new results only have 1 page. The result: empty page or out-of-bounds display.
**Why it happens:** The `page` URL param persists independently of other filter params. Filter changes do not automatically reset pagination.
**How to avoid:** When any filter, sort, or search parameter changes, always reset `page` to 1 (or null/default). Use nuqs `setParams({ ...filterChanges, p: 1 })` on every filter update.
**Warning signs:** Seeing "0-0 of 5 papers" or blank results after changing a filter.

### Pitfall 2: Race Between Page Navigation and Data Loading
**What goes wrong:** User clicks "Next" to go to page 3, but results for page 3 have not been loaded yet via `loadMore`. The display shows empty or stale data.
**Why it happens:** Convex's `usePaginatedQuery` loads data incrementally. Navigating forward requires ensuring enough data has been fetched.
**How to avoid:** When the user navigates to a page whose data is not yet loaded, trigger `loadMore` to fetch the necessary items. Show a loading state while data is being fetched. Only enable the "Next" button if more data is available (`status === "CanLoadMore"` or results already loaded for next page).
**Warning signs:** Blank page after clicking Next, or Next button enabled but clicking it shows no data.

### Pitfall 3: Convex Index Deployment for Title Sort
**What goes wrong:** Adding `by_user_title` index to the schema requires Convex to backfill the index on existing data. If deployed incorrectly, queries using the new index may fail or return incomplete results during backfill.
**Why it happens:** Convex indexes are eventually consistent during backfill. New indexes are available immediately but may not contain all historical data for a brief period.
**How to avoid:** Deploy the schema change first (via `npx convex dev` or `npx convex deploy`). The backfill is automatic and typically fast for small-to-medium tables. For production, deploy the index before the code that uses it.
**Warning signs:** Missing items when sorting by title immediately after deployment.

### Pitfall 4: Export Query Performance with Large Libraries
**What goes wrong:** Using `exportItems.length` as the filtered total count means the `exportLibrary` query fetches ALL matching items (not just a count). For users with thousands of library items, this could be slow.
**Why it happens:** There is no efficient "count-only" query pattern in Convex -- you have to collect items to count them.
**How to avoid:** The `exportLibrary` query is already being fetched (for the export feature). Its performance impact is already present. If performance becomes an issue for large libraries, consider adding a dedicated count query that uses `.collect().length` with the same index (avoiding the full document fetch) or caching the count. For now, the existing approach is acceptable for typical library sizes (< 10K items).
**Warning signs:** Slow page load with libraries > 5K items. Monitor Convex dashboard query timings.

### Pitfall 5: Title Sort Index Ordering with Mixed Case
**What goes wrong:** Convex sorts strings lexicographically by UTF-8 byte order. Uppercase letters sort before lowercase letters, so "Zebra" sorts before "alpha". This may produce unexpected title sort order.
**Why it happens:** Convex indexes use raw string comparison, not locale-aware collation.
**How to avoid:** Accept the default lexicographic ordering as "good enough" for an academic library (most titles are capitalized consistently). If case-insensitive sort is critical, add a `titleLower` field (lowercased title) to the schema and index on that instead. For Phase 34, the standard lexicographic sort is acceptable and matches how the search page sorts by `display_name`.
**Warning signs:** Titles starting with lowercase letters appearing after all uppercase titles.

### Pitfall 6: Pagination Counts Mismatch During Data Loading
**What goes wrong:** The "X-Y of Z papers" display shows a total count (Z) from `exportLibrary` but the accumulated results from `usePaginatedQuery` have not finished loading all pages. The user sees "1-20 of 150" but can only navigate to pages they have loaded so far.
**Why it happens:** `exportLibrary` returns the full filtered count instantly (all items), but `usePaginatedQuery` loads incrementally (20 at a time).
**How to avoid:** The pagination should handle two scenarios: (a) Enable "Next" whenever `status === "CanLoadMore"` or next page data is already loaded. (b) The total count (Z) is always accurate from `exportLibrary`. The "1-20 of 150" is always correct -- the user just needs to wait for data to load when navigating forward. Show a brief loading indicator when navigating to an unloaded page.
**Warning signs:** "Next" button disabled even though more pages exist, or clicking Next and seeing a loading state for too long.

## Code Examples

Verified patterns from the existing codebase:

### Current Sort Dropdown (already in library-page-client.tsx lines 269-375)
```typescript
// Source: components/library/library-page-client.tsx
// Sort options array -- add "title" here
const sortOptions: { value: LibrarySortBy; label: string }[] = [
  { value: "savedAt", label: t("sortDateSaved") },
  { value: "rating", label: t("sortRating") },
  { value: "publicationYear", label: t("sortPublicationYear") },
  // NEW: { value: "title", label: t("sortTitle") },
];

// Sort dropdown with disabled-during-search tooltip
<Tooltip delayDuration={300}>
  <TooltipTrigger asChild>
    <span>
      <Select
        value={params.sort}
        onValueChange={(v) => setParams({ sort: v as LibrarySortBy })}
        disabled={hasSearchText}
      >
        <SelectTrigger className={cn("h-8 w-[160px] text-xs", hasSearchText && "opacity-50 cursor-not-allowed")}>
          <span className="text-muted-foreground mr-1">{t("sortBy")}:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  </TooltipTrigger>
  {hasSearchText && (
    <TooltipContent side="bottom" className="text-xs">
      {t("sortDisabledInSearch")}
    </TooltipContent>
  )}
</Tooltip>
```

### Current Rating Display (already in library-item-row.tsx lines 70-82)
```typescript
// Source: components/library/library-item-row.tsx
// Rating stars -- read-only display, already implemented
<div className="flex items-center gap-px shrink-0">
  {[1, 2, 3, 4, 5].map((s) => (
    <Star
      key={s}
      className={cn(
        "h-3 w-3",
        s <= item.rating
          ? "fill-amber-400 text-amber-400"
          : "text-muted-foreground/25",
      )}
    />
  ))}
</div>
```

### Current View Mode Toggle (already in library-page-client.tsx lines 378-405)
```typescript
// Source: components/library/library-page-client.tsx
// View mode toggle -- already implemented with URL persistence
<div className="flex items-center gap-0.5 p-0.5 bg-muted/50 dark:bg-muted/30 rounded-lg border border-border/60">
  <button type="button" onClick={() => setParams({ view: "list" as LibraryViewMode })}
    className={cn("p-1.5 rounded-md transition-colors",
      params.view === "list" ? "text-primary bg-background shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-background/50"
    )} title={t("viewList")}>
    <LayoutList className="h-4 w-4" />
  </button>
  <button type="button" onClick={() => setParams({ view: "grid" as LibraryViewMode })}
    className={cn("p-1.5 rounded-md transition-colors",
      params.view === "grid" ? "text-primary bg-background shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-background/50"
    )} title={t("viewGrid")}>
    <LayoutGrid className="h-4 w-4" />
  </button>
</div>
```

### SmartPagination Pattern (extraction feature -- reference for pagination bar)
```typescript
// Source: components/extraction/smart-pagination.tsx
// Shows "Showing 1-25 of 150" with prev/next + page numbers
// Key pattern: startIdx = (currentPage - 1) * pageSize + 1
//              endIdx = Math.min(currentPage * pageSize, filteredCount)
<p className="text-sm text-muted-foreground">
  {t("showingRange", { start: startIdx, end: endIdx, total: filteredCount })}
</p>
```

### Convex browseLibrary Index Map (to extend)
```typescript
// Source: convex/library/queries.ts lines 48-52
const indexMap = {
  savedAt: "by_user_savedAt",
  rating: "by_user_rating",
  publicationYear: "by_user_year",
  // NEW: title: "by_user_title",
} as const;
```

### nuqs Library Search Params (to extend)
```typescript
// Source: lib/library/search-params.ts
export const librarySearchParams = {
  q: parseAsString.withDefault(""),
  sort: parseAsStringLiteral(librarySortValues).withDefault("savedAt"),
  order: parseAsStringLiteral(librarySortOrderValues).withDefault("desc"),
  rating: parseAsInteger,
  saved: parseAsStringLiteral(librarySavedPresets),
  yf: parseAsInteger,
  yt: parseAsInteger,
  view: parseAsStringLiteral(libraryViewModes).withDefault("list"),
  col: parseAsString,
  // NEW: p: parseAsInteger.withDefault(1),  // Page number for pagination
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "Load More" button for infinite scroll | Pagination with result counts and prev/next | Phase 34 (this phase) | Users see where they are in the result set ("1-20 of 150 papers") |
| Sort by savedAt, rating, year only | Sort by savedAt, rating, year, title | Phase 34 (this phase) | Users can alphabetically browse their library |
| No page state in URL | Page number persisted in URL via nuqs | Phase 34 (this phase) | Bookmarkable pagination, back button navigates pages |

**Deprecated/outdated:**
- "Load More" button pattern for library results: Replaced by pagination bar with result counts. The `loadMore` API from Convex is still used internally to fetch data, but the UI presentation changes to page-based.

## Open Questions

1. **Should the pagination use the `exportLibrary` result length or a dedicated count query?**
   - What we know: `exportLibrary` is already fetched for the export feature and applies identical filters. Its `.length` gives the total filtered count.
   - What's unclear: Whether fetching all items just for a count is acceptable performance-wise at scale (> 5K items).
   - Recommendation: Use `exportItems.length` for now. It avoids duplicating filter logic and the query is already running. If performance becomes an issue, add a dedicated `getFilteredLibraryCount` query later.

2. **Should the pagination bar include page number buttons (1, 2, 3...) or just prev/next?**
   - What we know: The requirement says "prev/next navigation." The `SmartPagination` component in the extraction feature includes page number buttons.
   - What's unclear: Whether page number buttons add value for a library that typically has 50-500 items (2-25 pages of 20).
   - Recommendation: Start with simple prev/next buttons (matching the requirement text). If the user wants page number buttons, they can be added later following the `SmartPagination` pattern. Keep the initial implementation simple.

3. **Should page reset to 1 on filter change be automatic in nuqs or manual?**
   - What we know: nuqs allows batch updates via `setParams({ rating: 3, p: 1 })`. Each filter change callback would need to include `p: 1`.
   - What's unclear: Whether there is a cleaner way to "subscribe" to filter changes and auto-reset page.
   - Recommendation: Add `p: 1` to every `setParams` call that modifies a filter or sort parameter. Also reset in the `clearFilters` callback. This is explicit and easy to understand. Consider a wrapper function like `setFilters(changes)` that always includes `p: 1`.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** -- Direct reading of all relevant source files:
  - `components/library/library-page-client.tsx` (516 lines) -- Current sort/view/load-more implementation
  - `components/library/library-item-row.tsx` (219 lines) -- Rating star display in list view
  - `components/library/library-item-card.tsx` (148 lines) -- Rating star display in grid view
  - `components/library/library-item-skeleton.tsx` (96 lines) -- Loading skeleton
  - `components/library/library-empty-state.tsx` (53 lines) -- Empty states
  - `components/library/library-filter-sidebar.tsx` (77 lines) -- Phase 33 sidebar wrapper
  - `components/library/library-filter-content.tsx` (299 lines) -- Phase 33 filter content
  - `components/extraction/smart-pagination.tsx` (158 lines) -- Existing pagination pattern with page numbers
  - `lib/library/search-params.ts` (73 lines) -- nuqs parsers for library URL state
  - `convex/library/queries.ts` (250 lines) -- browseLibrary, searchLibrary, exportLibrary, getLibraryCount
  - `convex/schema.ts` (libraryItems definition) -- Current indexes: by_user, by_user_openalexId, by_user_rating, by_user_savedAt, by_user_year
  - `lib/auth/use-auth-query.ts` (175 lines) -- useProtectedPaginatedQuery wrapping Convex pagination
  - `messages/en-US.json` (libraryPage namespace) -- Existing i18n keys
  - `components/ui/pagination.tsx` (133 lines) -- shadcn pagination primitives (available but currently unused by library)

### Secondary (MEDIUM confidence)
- Phase 33 research (`33-RESEARCH.md`) -- Confirmed sort/view controls were intentionally left in content area for Phase 34 to address
- Architecture document (`.planning/research/ARCHITECTURE_v2.2_UI_OVERHAUL.md`) -- Confirms data flow patterns and pagination strategy

### Tertiary (LOW confidence)
- None. All findings are from direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new libraries; everything already installed
- Architecture: HIGH -- Three of five requirements already implemented; remaining two follow established codebase patterns
- Pitfalls: HIGH -- Pitfalls identified from actual Convex pagination model analysis and codebase patterns

**Research date:** 2026-03-01
**Valid until:** 2026-03-31 (stable; no external dependencies to go stale)
