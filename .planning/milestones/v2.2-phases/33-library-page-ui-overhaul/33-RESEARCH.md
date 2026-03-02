# Phase 33: Library Page UI Overhaul - Research

**Researched:** 2026-03-01
**Domain:** React component composition, responsive layout, URL state management, filter sidebar
**Confidence:** HIGH

## Summary

Phase 33 applies the proven Phase 31/32 sidebar layout pattern to the library page. The current library page (`LibraryPageClient`, 381 lines) renders a single-column layout with an inline filter grid (`LibraryFilters`) that arranges four FilterSection cards in a responsive CSS grid. This phase replaces that layout with the two-column `SidebarLayout` + a new `LibraryFilterSidebar` component that wraps the filter panels in the `FilterSidebar` chrome shell, exactly mirroring how the search page's `SearchFilterSidebar` composes `FilterSidebar` + `SidebarContent`.

The core work is: (1) create `LibraryFilterSidebar` that composes `FilterSidebar` + library-specific filter content, (2) rewrite `LibraryPageClient` to use `SidebarLayout` with `LibraryFilterSidebar` as the sidebar slot, (3) move the search bar into the sidebar, (4) compute active filter count for the badge, and (5) handle the mobile/desktop split (raw filter content on mobile, `FilterSidebar` chrome on desktop). The existing filter UI components (`FilterSection` with rating stars, date saved presets, year range inputs, collection dropdown) already work well -- they just need to be rearranged from a horizontal grid into a vertical sidebar stack. The existing nuqs URL state (`librarySearchParams`) continues to be the single source of truth. No new libraries are needed.

A key difference from the search page: the library page uses its own Zustand store instance for sidebar collapse state (via `createSidebarStore` with a unique persist key like `'openalex-library-sidebar'`), ensuring the library sidebar collapse state is independent of the search sidebar. The `createSidebarDimensions` factory provides the matching dimension calculator.

**Primary recommendation:** Create a `LibraryFilterSidebar` component following the exact same composition pattern as `SearchFilterSidebar`. Create a dedicated sidebar store via `createSidebarStore('openalex-library-sidebar')`. Restructure `LibraryPageClient` to use `SidebarLayout` with the content area containing only the header, results list, and pagination. Move all filter UI (rating, date saved, year range, collection, search bar) into the sidebar.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LAYOUT-01 | Library page uses two-column layout with filter sidebar on left and content area on right | Use `SidebarLayout` component from Phase 31. Pass `LibraryFilterSidebar` as the `sidebar` prop, library content as `children`. `SidebarLayout` delegates to `TwoColumnLayout` on desktop (left sidebar, right content). |
| LAYOUT-02 | Filter sidebar is collapsible on desktop with toggle button and smooth animation | `FilterSidebar` from Phase 31 provides collapse/expand toggle with Framer Motion animation, keyboard shortcut (Ctrl+Shift+F), and Zustand-persisted collapse state. Use `createSidebarStore('openalex-library-sidebar')` for independent persistence. |
| LAYOUT-03 | Library page uses tab-based interface on mobile (Results/Filters tabs) matching search page pattern | `SidebarLayout` handles this automatically -- renders `Tabs` with Results/Filters tabs on mobile viewports (`useIsMobile()`). The `LibraryFilterSidebar` must render raw filter content (not wrapped in `FilterSidebar`) on mobile since `FilterSidebar` returns `null` on mobile. |
| LAYOUT-04 | Sidebar is sticky on desktop so filters remain visible while scrolling content | `TwoColumnLayout` (used internally by `SidebarLayout`) applies `sticky top-0 h-screen` to the left column. Already implemented. |
| FLTR-01 | User can filter library items by rating using star buttons in sidebar | Existing rating filter UI in `LibraryFilters` using `FilterSection` + star buttons. Move into sidebar content layout (vertical stack instead of grid column). |
| FLTR-02 | User can filter library items by date saved (week/month/year presets) in sidebar | Existing date saved preset UI in `LibraryFilters` using `FilterSection` + preset toggle buttons. Move into sidebar. |
| FLTR-03 | User can filter library items by publication year range in sidebar | Existing year range inputs in `LibraryFilters` using `FilterSection` + two number inputs. Move into sidebar. |
| FLTR-04 | User can filter library items by collection using dropdown in sidebar | Existing collection dropdown in `LibraryFilters` using `FilterSection` + `Select` component. Move into sidebar. |
| FLTR-05 | User can search within library items using text search in sidebar | Existing `LibrarySearchBar` component. Move from above the filter grid into the sidebar as the first element. |
| FLTR-06 | Active filter count badge displays on sidebar header | `FilterSidebar` renders an active count badge when `activeFilterCount > 0`. Implement a `countLibraryActiveFilters()` function that counts non-default filter values from nuqs params. |
| FLTR-07 | User can clear all active filters with a single button | `FilterSidebar` renders a clear button (X icon) when `activeFilterCount > 0`, calling `onClearAll`. The existing `clearFilters` callback in `LibraryPageClient` resets all params to defaults. Pass it as `onClearAll`. |
| FLTR-08 | All filter state persists in URL via nuqs (bookmarkable, survives reload) | Already implemented via `librarySearchParams` parsers and `useQueryStates(librarySearchParams)`. No changes needed to the URL state layer. |
| DRY-04 | Library page uses same SidebarLayout + LibraryFilterSidebar composition | Follow the exact pattern from `SearchFilterSidebar` + `ResultsPageContent`: `<SidebarLayout sidebar={<LibraryFilterSidebar />}>{content}</SidebarLayout>`. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.2.4 | Component framework | Already in project |
| Next.js | ^16.1.6 | App router, SSR | Already in project |
| motion | ^12.23.12 | FilterSidebar collapse animation | Already used by Phase 31 FilterSidebar |
| zustand | ^5.0.5 | Sidebar collapse state persistence | Already used; `createSidebarStore` factory exists |
| next-intl | ^4.8.2 | i18n for filter labels | Already used by all library filter panels |
| nuqs | ^2.6.0 | URL state for library filters | Already used via `librarySearchParams` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | ^0.487.0 | Filter panel icons (Star, Calendar, Hash, FolderOpen, Search) | Already used in LibraryFilters |
| date-fns | ^4.1.0 | Date preset calculations (subWeeks, subMonths, subYears) | Already used in search-params.ts |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `createSidebarStore` factory | Reuse `useFilterSidebarStore` directly | Would share collapse state with search page -- opening library sidebar would affect search sidebar. Use separate store. |
| Custom active filter counter | Extend `countActiveFilters` from `lib/filters` | `countActiveFilters` is deeply tied to `FilterParams` (search-specific fields). Simpler to write a dedicated `countLibraryActiveFilters` that checks library params. |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
components/
  shared/
    sidebar-layout.tsx          # EXISTING (Phase 31) - SidebarLayout
    filter-sidebar.tsx          # EXISTING (Phase 31) - FilterSidebar chrome
    filter-section.tsx          # EXISTING - shared filter chrome
  library/
    library-filter-sidebar.tsx  # NEW - LibraryFilterSidebar (composes FilterSidebar + filter content)
    library-filter-content.tsx  # NEW - LibraryFilterContent (stacked filter panels for sidebar)
    library-page-client.tsx     # MODIFIED - uses SidebarLayout + LibraryFilterSidebar
    library-filters.tsx         # REMOVED or DEPRECATED - replaced by library-filter-content.tsx
    library-search-bar.tsx      # EXISTING - reused inside sidebar content
    library-empty-state.tsx     # EXISTING - unchanged
    library-item-skeleton.tsx   # EXISTING - unchanged
    library-item-row.tsx        # EXISTING - unchanged
    library-item-card.tsx       # EXISTING - unchanged
    collection-manager.tsx      # EXISTING - unchanged
    collection-picker.tsx       # EXISTING - unchanged
lib/
  store.ts                      # MODIFIED - add useLibrarySidebarStore + getLibrarySidebarDimensions
  library/
    search-params.ts            # EXISTING - unchanged
    export.ts                   # EXISTING - unchanged
```

### Pattern 1: LibraryFilterSidebar - Domain-Specific Sidebar Composition

**What:** A new component that composes the generic `FilterSidebar` chrome with library-specific filter content. Follows the exact same pattern as `SearchFilterSidebar`.

**When to use:** When the library page needs a sidebar with all library filters.

**Example:**
```typescript
// components/library/library-filter-sidebar.tsx
"use client";

import React from "react";
import { FilterSidebar } from "@/components/shared/filter-sidebar";
import { useLibrarySidebarStore, getLibrarySidebarDimensions } from "@/lib/store";
import { useIsMobile } from "@/lib/hooks";
import { LibraryFilterContent } from "./library-filter-content";

interface LibraryFilterSidebarProps {
  // All filter state + callbacks from LibraryPageClient
  rawSearch: string;
  onSearchChange: (value: string) => void;
  minRating: number | undefined;
  onMinRatingChange: (rating: number | undefined) => void;
  savedPreset: string | null;
  onSavedPresetChange: (preset: string | null) => void;
  yearFrom: number | null;
  yearTo: number | null;
  onYearFromChange: (year: number | null) => void;
  onYearToChange: (year: number | null) => void;
  collectionId: string | null;
  onCollectionChange: (id: string | null) => void;
  collections: Array<{ _id: string; name: string; itemCount: number }> | undefined;
  onManageCollections: () => void;
  activeFilterCount: number;
  onClearAll: () => void;
}

export function LibraryFilterSidebar(props: LibraryFilterSidebarProps) {
  const isMobile = useIsMobile();

  const filterContent = (
    <LibraryFilterContent {...props} />
  );

  // Mobile: render raw filter content (SidebarLayout handles tab chrome)
  if (isMobile) {
    return (
      <div className="w-full max-w-2xl mx-auto">
        {filterContent}
      </div>
    );
  }

  // Desktop: wrap in FilterSidebar for glassmorphic chrome + collapse
  return (
    <FilterSidebar
      useStore={useLibrarySidebarStore}
      getDimensions={getLibrarySidebarDimensions}
      activeFilterCount={props.activeFilterCount}
      onClearAll={props.onClearAll}
    >
      {filterContent}
    </FilterSidebar>
  );
}
```

### Pattern 2: LibraryPageClient with SidebarLayout

**What:** `LibraryPageClient` delegates all responsive layout logic to `SidebarLayout`, identical to how `ResultsPageContent` uses it.

**When to use:** The library page.

**Example:**
```typescript
// components/library/library-page-client.tsx (restructured)
import { SidebarLayout } from "@/components/shared/sidebar-layout";
import { LibraryFilterSidebar } from "./library-filter-sidebar";
import { PageWrapper } from "@/components/PageWrapper";

export function LibraryPageClient() {
  // ... existing state, queries, mutations ...

  return (
    <SidebarLayout
      sidebar={
        <LibraryFilterSidebar
          rawSearch={rawSearch}
          onSearchChange={setRawSearch}
          minRating={minRating}
          onMinRatingChange={(r) => setParams({ rating: r === undefined ? null : r })}
          savedPreset={params.saved}
          onSavedPresetChange={(p) => setParams({ saved: p })}
          yearFrom={params.yf}
          yearTo={params.yt}
          onYearFromChange={(y) => setParams({ yf: y })}
          onYearToChange={(y) => setParams({ yt: y })}
          collectionId={params.col}
          onCollectionChange={(id) => setParams({ col: id })}
          collections={collectionsWithCounts}
          onManageCollections={() => setCollectionManagerOpen(true)}
          activeFilterCount={activeFilterCount}
          onClearAll={clearFilters}
        />
      }
    >
      <PageWrapper>
        <div className="container mx-auto p-4 sm:p-6 max-w-4xl">
          {/* Header, results list, load more, empty states */}
        </div>
      </PageWrapper>
    </SidebarLayout>
  );
}
```

### Pattern 3: LibraryFilterContent - Vertical Filter Stack

**What:** The filter panels arranged vertically for the sidebar. Replaces the 4-column CSS grid layout of `LibraryFilters` with a vertical `space-y-4` stack, and adds the search bar at the top.

**When to use:** Inside `LibraryFilterSidebar`, rendering both on desktop (inside `FilterSidebar` chrome) and mobile (raw in SidebarLayout tab).

**Example:**
```typescript
// components/library/library-filter-content.tsx
export function LibraryFilterContent({
  rawSearch, onSearchChange,
  minRating, onMinRatingChange,
  savedPreset, onSavedPresetChange,
  yearFrom, yearTo, onYearFromChange, onYearToChange,
  collectionId, onCollectionChange, collections, onManageCollections,
}: LibraryFilterContentProps) {
  return (
    <div className="space-y-4 p-4 pt-15">
      {/* Search bar */}
      <LibrarySearchBar value={rawSearch} onChange={onSearchChange} />

      {/* Rating filter */}
      <FilterSection title={t("ratingFilter")} icon={Star} isActive={minRating !== undefined} ...>
        {/* Star buttons */}
      </FilterSection>

      {/* Date saved presets */}
      <FilterSection title={t("filterDateSaved")} icon={Calendar} ...>
        {/* Week/Month/Year toggles */}
      </FilterSection>

      {/* Year range */}
      <FilterSection title={t("filterYearRange")} icon={Hash} ...>
        {/* From/To inputs */}
      </FilterSection>

      {/* Collection */}
      <FilterSection title={t("filterCollection")} icon={FolderOpen} ...>
        {/* Collection dropdown */}
      </FilterSection>
    </div>
  );
}
```

### Pattern 4: Active Filter Count Computation

**What:** A simple function that counts non-default library filter values. Unlike the search page's `countActiveFilters` (which uses the complex `buildFilterData` pipeline), the library filters are simple enough for a direct count.

**Example:**
```typescript
function countLibraryActiveFilters(params: {
  q: string;
  rating: number | null;
  saved: string | null;
  yf: number | null;
  yt: number | null;
  col: string | null;
}): number {
  let count = 0;
  if (params.q.trim().length > 0) count++;
  if (params.rating !== null) count++;
  if (params.saved !== null) count++;
  if (params.yf !== null || params.yt !== null) count++;  // Year range counts as 1 filter
  if (params.col !== null) count++;
  return count;
}
```

### Pattern 5: Sidebar Store Creation

**What:** Use the existing `createSidebarStore` factory to create an independent sidebar store for the library page.

**Example:**
```typescript
// In lib/store.ts
export const useLibrarySidebarStore = createSidebarStore('openalex-library-sidebar');
export const getLibrarySidebarDimensions = createSidebarDimensions(320, 48);
```

### Anti-Patterns to Avoid

- **Sharing `useFilterSidebarStore` with the search page:** The library must have its own store instance so collapsing one sidebar does not affect the other. Use `createSidebarStore` with a unique key.
- **Passing FilterSidebar directly as the mobile sidebar:** `FilterSidebar` returns `null` on mobile by design. The mobile sidebar tab needs raw filter content, not the chrome wrapper. `LibraryFilterSidebar` must detect mobile and bypass `FilterSidebar`.
- **Copy-pasting the search page's `SearchFilterSidebar` logic:** Follow the same composition pattern but with library-specific filter content. Do not duplicate the search filter panels.
- **Keeping the inline filter grid alongside the sidebar:** The old `LibraryFilters` grid should be fully replaced by the sidebar. Do not render filters in both places.
- **Removing sort/view mode controls from the content area:** Sort controls and view mode toggles are Phase 34 scope (DISP requirements). For Phase 33, these controls should remain in the content area where they currently live. Only FLTR-xx and LAYOUT-xx requirements are in scope.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Desktop two-column + mobile tabs | Manual responsive branching | `SidebarLayout` from Phase 31 | Already proven on search page in Phase 32 |
| Sidebar collapse chrome | Custom collapse toggle/animation | `FilterSidebar` from Phase 31 | Provides glassmorphic background, keyboard shortcut, badge, clear button |
| Sidebar collapse state persistence | Custom localStorage + state | `createSidebarStore('openalex-library-sidebar')` | Factory function already exists in lib/store.ts |
| Sidebar dimension calculator | Inline width constants | `createSidebarDimensions(320, 48)` | Factory function already exists in lib/store.ts |
| Filter section visual chrome | Custom filter card styling | `FilterSection` from components/shared | Already used by existing library filters |

**Key insight:** This phase reuses 100% of the infrastructure built in Phases 31-32. The only new code is the library-specific composition layer (`LibraryFilterSidebar` + `LibraryFilterContent`) and two lines of store creation.

## Common Pitfalls

### Pitfall 1: Mobile FilterSidebar Returns Null
**What goes wrong:** `FilterSidebar` has a hydration guard: `if (!_hasHydrated || isMobileView) return null`. If `LibraryFilterSidebar` always wraps content in `FilterSidebar`, the mobile "Filters" tab will be empty.
**Why it happens:** `FilterSidebar` is designed for desktop panel chrome only. Mobile rendering goes through `SidebarLayout`'s tab interface, which directly renders the sidebar content.
**How to avoid:** `LibraryFilterSidebar` must conditionally render: wrap in `FilterSidebar` on desktop, render raw `LibraryFilterContent` on mobile. Check `useIsMobile()` at the top of the component. This is the exact same pattern used in `SearchFilterSidebar`.
**Warning signs:** Empty "Filters" tab on mobile, or filters only visible on desktop.

### Pitfall 2: Sort/View Controls Scope Confusion
**What goes wrong:** The current `LibraryFilters` component contains both filter controls (FLTR-xx scope) and sort/view controls (DISP-xx scope, Phase 34). Moving everything into the sidebar could entangle Phase 33 and Phase 34 work.
**Why it happens:** The existing `LibraryFilters` mixes concerns -- it renders rating, date saved, year range, and collection filters alongside sort dropdowns and view mode toggles.
**How to avoid:** Move only the FLTR-xx filter controls into `LibraryFilterContent`. Keep sort controls and view mode toggle in the content area (they already render in Row 2 of `LibraryFilters`). Phase 34 can later relocate or enhance them.
**Warning signs:** Sort dropdown appearing in the sidebar, or view mode toggle missing from the content area.

### Pitfall 3: Desktop Sidebar Content Padding
**What goes wrong:** On desktop, `FilterSidebar` has floating controls in the top-right corner (`absolute top-3 right-3`). If the filter content does not have enough top padding (`pt-15` in the search page pattern), the first FilterSection will overlap with the floating controls.
**Why it happens:** The `FilterSidebar` chrome and the content share the same visual space. The content must account for the chrome's absolute-positioned controls.
**How to avoid:** Use `pt-15` (or equivalent) on the top padding of `LibraryFilterContent` on desktop, matching the search page's `SidebarContent` padding pattern (`p-4 pt-15`). On mobile, use standard `p-4` since there are no floating controls.
**Warning signs:** Filter cards overlapping with the collapse toggle or badge buttons.

### Pitfall 4: Search Bar Debounce State Management
**What goes wrong:** The library search bar uses a local `rawSearch` state with `useDebouncedValue` to avoid writing every keystroke to the URL. If the search bar moves into the sidebar, the debounce state must still live in `LibraryPageClient` (where it feeds the Convex query), not inside the sidebar component.
**Why it happens:** The sidebar component receives the raw search value as a prop, but the debounce-to-URL sync logic is in the parent.
**How to avoid:** Keep `rawSearch` state and `useDebouncedValue` in `LibraryPageClient`. Pass `rawSearch` and `setRawSearch` as props to `LibraryFilterSidebar`. The sidebar simply renders the search bar with controlled props.
**Warning signs:** Search text not debouncing (every keystroke hits the URL), or search bar state desyncing between sidebar and URL.

### Pitfall 5: Active Filter Count Not Including Search Text
**What goes wrong:** The active filter count badge does not update when the user types in the search bar, or it counts the debounced value instead of the raw value.
**Why it happens:** The badge should reflect what the user sees. If they have typed text, the badge should count it as an active filter even before debounce completes.
**How to avoid:** Count search text activity based on `rawSearch.trim().length > 0` (the immediate value), not the debounced value. This ensures the badge updates in real time as the user types.
**Warning signs:** Badge not showing search as an active filter, or badge flickering as debounce triggers.

### Pitfall 6: Year Range Commit-on-Blur Logic
**What goes wrong:** The year range inputs use local state + commit-on-blur to avoid URL updates on every keystroke. If this logic is not preserved when moving the inputs into the sidebar, every keystroke triggers a Convex query.
**Why it happens:** The `localYearFrom`/`localYearTo` state and `commitYearFrom`/`commitYearTo` handlers are currently inside `LibraryFilters`. They must be preserved in the new `LibraryFilterContent`.
**How to avoid:** Keep the existing commit-on-blur pattern. The local year state can live inside `LibraryFilterContent` since it is purely UI-local. The committed values (from props) drive the Convex query.
**Warning signs:** Convex query re-running on every keystroke in year fields, or year fields losing focus unexpectedly.

## Code Examples

Verified patterns from the existing codebase:

### SearchFilterSidebar Pattern (Phase 32 -- to replicate)
```typescript
// Source: components/search-filter-sidebar.tsx
// This is the exact pattern to follow for LibraryFilterSidebar:
export function SearchFilterSidebar() {
  const isMobile = useIsMobile();
  // ... compute filter state, active count, clear handler ...

  const filterContent = (
    <SidebarContent hideHeader isMobileSheet={isMobile} ... />
  );

  if (isMobile) {
    return <div className="w-full max-w-2xl mx-auto">{filterContent}</div>;
  }

  return (
    <FilterSidebar
      useStore={useFilterSidebarStore}
      getDimensions={getFilterSidebarDimensions}
      activeFilterCount={activeFiltersCount}
      onClearAll={handleClearAllFilters}
    >
      {filterContent}
    </FilterSidebar>
  );
}
```

### ResultsPageContent SidebarLayout Usage (Phase 32 -- to replicate)
```typescript
// Source: components/results-page-content.tsx
// Lines 63-94: The entire page is wrapped in SidebarLayout
return (
  <SidebarLayout sidebar={<SearchFilterSidebar />}>
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <main className="w-full">
          <ResultsList ... />
        </main>
      </div>
    </PageWrapper>
  </SidebarLayout>
);
```

### Existing Library Filters (to be relocated into sidebar)
```typescript
// Source: components/library/library-filters.tsx
// Currently renders a 4-column CSS grid of FilterSection cards:
// - Rating filter (Star icon, 5 star buttons)
// - Date saved presets (Calendar icon, week/month/year buttons)
// - Year range (Hash icon, two number inputs with commit-on-blur)
// - Collection filter (FolderOpen icon, Select dropdown + manage link)
// Plus a Row 2 with sort controls and view mode toggle.
// The filter sections move into LibraryFilterContent as a vertical stack.
// Sort/view mode controls stay in the content area.
```

### Store Factory Usage
```typescript
// Source: lib/store.ts lines 1156-1188
// createSidebarStore('openalex-library-sidebar') returns a Zustand store
// with the same shape as useFilterSidebarStore:
// { isCollapsed, _hasHydrated, setCollapsed, toggle, setHasHydrated }
// Persisted to localStorage under the given key.

// createSidebarDimensions(320, 48) returns a function:
// (isCollapsed: boolean) => { expandedWidth: 320, collapsedWidth: 48, currentWidth: ... }
```

### Existing Library URL State (unchanged)
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
};
```

### FilterSidebar Props (from Phase 31)
```typescript
// Source: components/shared/filter-sidebar.tsx
export interface FilterSidebarProps {
  children: React.ReactNode;
  activeFilterCount: number;
  onClearAll: () => void;
  useStore: UseBoundStore<StoreApi<FilterSidebarState>>;
  getDimensions: (isCollapsed: boolean) => {
    expandedWidth: number;
    collapsedWidth: number;
    currentWidth: number;
  };
}
```

### SidebarLayout Props (from Phase 31)
```typescript
// Source: components/shared/sidebar-layout.tsx
interface SidebarLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  sidebarTabLabel?: string;
  contentTabLabel?: string;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline filter grid above content | Filter sidebar in left column | Phase 33 (this phase) | Aligns library with search page layout |
| Manual single-column layout | SidebarLayout handles responsive two-column + tabs | Phase 31 created, Phase 33 adopts | Consistent layout across pages |
| No sidebar collapse on library | FilterSidebar chrome with persist | Phase 31 created, Phase 33 adopts | User can collapse to gain content space |

**Deprecated/outdated:**
- `LibraryFilters` component (inline grid layout): Replaced by `LibraryFilterContent` (vertical sidebar stack). The component file can be deleted or gutted.
- `LibrarySearchBar` above the filter grid: Moved inside the sidebar. The component itself is reused but its placement changes.

## Open Questions

1. **Should sort/view mode controls move into the sidebar or stay in the content area?**
   - What we know: Sort (DISP-01, DISP-02) and view mode toggle (DISP-05) are Phase 34 requirements, not Phase 33. The current `LibraryFilters` renders them in "Row 2" below the filter grid.
   - What's unclear: Whether keeping them in the content area during Phase 33 will look right without the filter grid above them.
   - Recommendation: Keep sort/view controls in the content area during Phase 33. Place them in the header row alongside the title and export button. Phase 34 can refine their placement.

2. **Should the export button stay in the header or move into the sidebar?**
   - What we know: The export button is currently in the header row. It is not a filter -- it is an action on the filtered results.
   - What's unclear: Whether it looks better in the sidebar or the header with the new layout.
   - Recommendation: Keep the export button in the content area header. Actions on results belong in the content area, not the filter sidebar.

3. **What should the mobile padding be for LibraryFilterContent?**
   - What we know: On desktop, `pt-15` is needed to clear the FilterSidebar floating controls. On mobile, standard `p-4` suffices since FilterSidebar is not rendered.
   - What's unclear: Whether the mobile path should match the search page's mobile SidebarContent padding exactly.
   - Recommendation: Use `p-4` on mobile (matching `SidebarContent`'s `isMobileSheet` path). Use `p-4 pt-15` on desktop.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** - Direct reading of all relevant source files:
  - `components/library/library-page-client.tsx` (381 lines) - Current library page with inline filter grid
  - `components/library/library-filters.tsx` (407 lines) - Current inline filter grid with 4 FilterSections + sort/view controls
  - `components/library/library-search-bar.tsx` (44 lines) - Search bar component to reuse
  - `components/shared/sidebar-layout.tsx` (116 lines) - Phase 31 SidebarLayout
  - `components/shared/filter-sidebar.tsx` (265 lines) - Phase 31 FilterSidebar chrome
  - `components/shared/filter-section.tsx` (88 lines) - Shared filter section chrome
  - `components/search-filter-sidebar.tsx` (120 lines) - Phase 32 SearchFilterSidebar (pattern to follow)
  - `components/results-page-content.tsx` (96 lines) - Phase 32 SidebarLayout usage (pattern to follow)
  - `lib/store.ts` (lines 1112-1188) - FilterSidebarState, createSidebarStore, createSidebarDimensions factories
  - `lib/library/search-params.ts` (73 lines) - nuqs parsers for library URL state
  - `convex/library/queries.ts` (250 lines) - browseLibrary and searchLibrary queries with filter args
  - `app/library/page.tsx` (20 lines) - Server component entry point
  - `messages/en-US.json` (libraryPage namespace) - Existing i18n keys for all filter labels
  - `messages/en-US.json` (sidebarLayout namespace) - Existing i18n keys for sidebar chrome

### Secondary (MEDIUM confidence)
- Phase 32 research (`32-RESEARCH.md`) - Validated composition patterns, mobile pitfall, keyboard shortcut handling

### Tertiary (LOW confidence)
- None. All findings are from direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries; everything is already in the project
- Architecture: HIGH - All building blocks exist from Phases 31-32; this replicates a proven pattern
- Pitfalls: HIGH - All pitfalls identified from actual code analysis and Phase 32 lessons learned

**Research date:** 2026-03-01
**Valid until:** 2026-03-31 (stable; no external dependencies to go stale)
