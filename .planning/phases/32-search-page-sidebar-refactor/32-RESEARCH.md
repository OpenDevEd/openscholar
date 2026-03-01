# Phase 32: Search Page Sidebar Refactor - Research

**Researched:** 2026-03-01
**Domain:** React component refactoring, composition pattern migration, visual regression prevention
**Confidence:** HIGH

## Summary

Phase 32 replaces the monolithic `SearchSidebar` + manual `ResultsPageContent` mobile tab logic with the Phase 31 shared components (`SidebarLayout` + `FilterSidebar`). The work is a pure **refactoring exercise** -- no new features, no new libraries, no new patterns. The goal is to prove the Phase 31 infrastructure works under real production conditions before Phase 33 applies the same pattern to the library page.

The current `ResultsPageContent` (223 lines) manually implements both a desktop two-column layout using `TwoColumnLayout` + `SearchSidebar mode="panel"` and a mobile tab-based layout using Radix Tabs + AnimatePresence + `SearchSidebar mode="page"`. Phase 32 replaces this with `SidebarLayout` (which already encapsulates both patterns) wrapping a new `SearchFilterSidebar` component. The `SearchFilterSidebar` composes `FilterSidebar` (generic chrome) with the existing `SidebarContent` (search-specific filter panels), effectively splitting the 944-line `SearchSidebar` into reusable chrome + domain-specific content.

Only two modes of `SearchSidebar` are actually used in production: `mode="panel"` (desktop) and `mode="page"` (mobile). The `mode="sheet"` and default `mode="sidebar"` branches have zero consumers. The `SearchSidebar` component can therefore be significantly simplified -- the panel chrome is now handled by `FilterSidebar`, and the mobile layout is handled by `SidebarLayout`.

**Primary recommendation:** Create a `SearchFilterSidebar` component that composes `FilterSidebar` + existing `SidebarContent`. Rewrite `ResultsPageContent` to use `SidebarLayout` with `SearchFilterSidebar` as the sidebar slot. Simplify `SearchSidebar` to only export what is needed (or replace it entirely). Preserve exact visual fidelity -- the user must see zero difference.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DRY-03 | Search page refactored to use SidebarLayout + SearchFilterSidebar (replacing monolithic SearchSidebar) | `ResultsPageContent` currently uses `TwoColumnLayout` + `SearchSidebar mode="panel"` (desktop) and manual Tabs + `SearchSidebar mode="page"` (mobile). Replace with `SidebarLayout` wrapping `SearchFilterSidebar` which composes `FilterSidebar` + `SidebarContent`. All building blocks exist from Phase 31. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.2.4 | Component framework | Already in project |
| Next.js | ^16.1.6 | App router, SSR | Already in project |
| motion | ^12.23.12 | FilterSidebar collapse animation | Already used by Phase 31 FilterSidebar |
| zustand | ^5.0.5 | Sidebar collapse state persistence | Already used by `useFilterSidebarStore` |
| next-intl | ^4.8.2 | i18n for filter labels | Already used by all filter panels |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | ^0.487.0 | Filter panel icons | Already used in all filter panels |
| @radix-ui/react-tabs | ^1.1.12 | Mobile tab interface (inside SidebarLayout) | Already handled by SidebarLayout |
| nuqs | ^2.6.0 | URL state for search filters | Already used via `useSearch()` context |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Keeping SearchSidebar as-is and wrapping it | Deleting SearchSidebar entirely | SearchSidebar has unused modes (sheet, sidebar) that can be removed, but keeping a slim SearchSidebar wrapper avoids breaking any future consumers. Recommend removing unused modes. |

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
  search-filter-sidebar.tsx     # NEW - SearchFilterSidebar (composes FilterSidebar + SidebarContent)
  search-sidebar.tsx            # MODIFIED - simplified, delegates to SearchFilterSidebar
  results-page-content.tsx      # MODIFIED - uses SidebarLayout + SearchFilterSidebar
lib/
  store.ts                      # EXISTING - useFilterSidebarStore, getFilterSidebarDimensions
```

### Pattern 1: SearchFilterSidebar - Domain-Specific Sidebar Composition

**What:** A new component that composes the generic `FilterSidebar` chrome with search-specific filter content. This replaces the `mode="panel"` branch of `SearchSidebar`.

**When to use:** When the search page needs a sidebar with all search filters.

**Example:**
```typescript
// components/search-filter-sidebar.tsx
"use client";

import { FilterSidebar } from "@/components/shared/filter-sidebar";
import { useFilterSidebarStore, getFilterSidebarDimensions } from "@/lib/store";
// ... import filter panels, hooks, etc.

export function SearchFilterSidebar() {
  // Get search state and compute activeFilterCount + handleClearAll
  // (same logic currently in SearchSidebar lines 625-686)

  return (
    <FilterSidebar
      useStore={useFilterSidebarStore}
      getDimensions={getFilterSidebarDimensions}
      activeFilterCount={activeFiltersCount}
      onClearAll={handleClearAllFilters}
    >
      <SidebarContent
        hideHeader
        activeFiltersCount={activeFiltersCount}
        isCitesActive={isCitesActive}
        isCitedByActive={isCitedByActive}
        isRelatedToActive={isRelatedToActive}
        onClearAllFilters={handleClearAllFilters}
      />
    </FilterSidebar>
  );
}
```

### Pattern 2: ResultsPageContent Simplified with SidebarLayout

**What:** `ResultsPageContent` delegates all responsive layout logic to `SidebarLayout`, eliminating ~90 lines of manual desktop/mobile branching.

**When to use:** The search results page.

**Example:**
```typescript
// components/results-page-content.tsx (simplified)
import { SidebarLayout } from "@/components/shared/sidebar-layout";
import { SearchFilterSidebar } from "./search-filter-sidebar";

export default function ResultsPageContent({ searchId }: ResultsPageContentProps) {
  // ... existing toast, router, search context setup ...

  return (
    <SidebarLayout
      sidebar={<SearchFilterSidebar />}
    >
      <PageWrapper>
        <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
          <main className="w-full">
            <ResultsList ... />
          </main>
        </div>
      </PageWrapper>
    </SidebarLayout>
  );
}
```

### Pattern 3: Mobile Filter Content via SidebarLayout Tab

**What:** On mobile, `SidebarLayout` renders the sidebar content under a "Filters" tab. The search filters need to render in a mobile-friendly format (no panel chrome, no collapse animation -- just the filter content).

**When to use:** Automatically handled by SidebarLayout's mobile branch.

**Key insight:** On mobile, `FilterSidebar` returns `null` (its hydration guard: `if (!_hasHydrated || isMobileView) return null`). This means the mobile sidebar tab would render nothing if we just pass `<SearchFilterSidebar />` as the sidebar prop. The mobile path needs the raw filter content without the FilterSidebar chrome wrapper.

**Solution:** `SearchFilterSidebar` should detect mobile via `useIsMobile()` and render just the `SidebarContent` (without `FilterSidebar` wrapper) on mobile. Or, the sidebar prop to `SidebarLayout` should be a component that renders the filter content directly (not wrapped in `FilterSidebar`). The simplest approach is to have `SearchFilterSidebar` render `FilterSidebar` wrapping `SidebarContent` on desktop, and just `SidebarContent` on mobile.

```typescript
export function SearchFilterSidebar() {
  const isMobile = useIsMobile();

  // ... compute activeFilterCount, handleClearAll, etc.

  const filterContent = (
    <SidebarContent
      hideHeader={!isMobile}
      isMobileSheet={isMobile}
      activeFiltersCount={activeFiltersCount}
      isCitesActive={isCitesActive}
      isCitedByActive={isCitedByActive}
      isRelatedToActive={isRelatedToActive}
      onClearAllFilters={handleClearAllFilters}
    />
  );

  if (isMobile) {
    return filterContent;
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

### Anti-Patterns to Avoid

- **Passing FilterSidebar directly as the mobile sidebar:** `FilterSidebar` returns `null` on mobile by design. The mobile sidebar tab needs raw filter content, not the chrome wrapper.
- **Duplicating the mobile tab logic in ResultsPageContent:** The entire point of this phase is to eliminate the manual tab logic. Use `SidebarLayout`, not a reimplementation.
- **Breaking the keyboard shortcut (Ctrl+Shift+F):** The shortcut is now in `FilterSidebar` (Phase 31). The old shortcut in `SearchSidebar` must be removed to avoid double-binding.
- **Changing filter behavior or appearance:** This is a refactor, not a redesign. Every filter must work identically to production.
- **Creating a new Zustand store for search:** Use the existing `useFilterSidebarStore` with its existing persist key `'openalex-filter-sidebar'`. Users who had the sidebar collapsed will keep their preference.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Desktop two-column + mobile tabs | Manual responsive branching (current ResultsPageContent pattern) | `SidebarLayout` from Phase 31 | Already proven; eliminates 90+ lines from ResultsPageContent |
| Sidebar collapse chrome | Keep SearchSidebar mode="panel" chrome inline | `FilterSidebar` from Phase 31 | Already matches SearchSidebar pixel-for-pixel; avoids chrome duplication |
| Active filter count computation | Inline counting logic | `countActiveFilters()` from `lib/filters` | Already used by SearchSidebar; single source of truth |
| Clear-all filter reset | Custom reset logic | Existing `handleClearAllFilters` pattern (reset all to `DEFAULT_FILTERS`) | Already tested and working |

**Key insight:** This phase produces zero new technology. It rewires existing components to use shared infrastructure. The risk is purely in the wiring, not in the capabilities.

## Common Pitfalls

### Pitfall 1: Mobile FilterSidebar Returns Null
**What goes wrong:** `FilterSidebar` has a hydration guard `if (!_hasHydrated || isMobileView) return null`. If `SearchFilterSidebar` always wraps content in `FilterSidebar`, the mobile "Filters" tab will be empty.
**Why it happens:** `FilterSidebar` is designed for desktop panel chrome only. Mobile rendering goes through `SidebarLayout`'s tab interface, which directly renders the sidebar content.
**How to avoid:** `SearchFilterSidebar` must conditionally render: wrap in `FilterSidebar` on desktop, render raw `SidebarContent` on mobile. Check `useIsMobile()` at the top of the component.
**Warning signs:** Empty "Filters" tab on mobile, or filters only visible on desktop.

### Pitfall 2: Duplicate Keyboard Shortcut Binding
**What goes wrong:** `SearchSidebar` (lines 612-623) registers a `Ctrl+Shift+F` keyboard shortcut. `FilterSidebar` (from Phase 31) registers the same shortcut. If both components mount, the shortcut fires twice.
**Why it happens:** The old `SearchSidebar` and the new `FilterSidebar` both bind the same key listener independently.
**How to avoid:** Remove the keyboard shortcut `useEffect` from `SearchSidebar` when refactoring. `FilterSidebar` already handles this. Or, if `SearchSidebar` is no longer rendered, the problem resolves naturally.
**Warning signs:** Toggle fires twice on a single `Ctrl+Shift+F` press (sidebar opens then immediately closes).

### Pitfall 3: SidebarContent Header Visibility
**What goes wrong:** `SidebarContent` has a `hideHeader` prop. On desktop, the header should be hidden (FilterSidebar provides its own floating controls). On mobile, the header should be visible (it provides the "Filters" title and "Clear All" button since there's no FilterSidebar chrome).
**Why it happens:** The `hideHeader` prop needs to be set differently depending on the rendering context (desktop vs. mobile).
**How to avoid:** In `SearchFilterSidebar`, set `hideHeader={true}` when wrapped in `FilterSidebar` (desktop), and `hideHeader={false}` when rendering standalone (mobile). The current mobile mode ("page") already passes `hideHeader={true}` though -- so match whatever the current behavior is for visual parity.
**Warning signs:** Duplicate headers (FilterSidebar controls + SidebarContent header both showing) on desktop, or missing header on mobile.

### Pitfall 4: Losing the Outer Wrapper in ResultsPageContent
**What goes wrong:** The current desktop path wraps the entire layout in `<div className="flex flex-col flex-1 w-full">`. The mobile path wraps in `<div className="flex flex-col flex-1 w-full h-full">`. When switching to `SidebarLayout`, forgetting this outer wrapper could break the page height.
**Why it happens:** `SidebarLayout` provides its own flex layout on mobile but delegates to `TwoColumnLayout` on desktop. The outer wrapper ensures the component fills available space.
**How to avoid:** Keep an outer wrapper div around `SidebarLayout` or verify that `SidebarLayout`'s own wrapper is sufficient. Test both desktop and mobile to confirm full-height rendering.
**Warning signs:** Content not filling the viewport height, or footer floating midpage.

### Pitfall 5: Unused SearchSidebar Modes Left as Dead Code
**What goes wrong:** After refactoring, `SearchSidebar`'s `mode="sheet"` and default `mode="sidebar"` branches are dead code with zero consumers.
**Why it happens:** Only `mode="panel"` (now replaced by `FilterSidebar`) and `mode="page"` (now replaced by direct `SidebarContent` rendering) were used.
**How to avoid:** Remove unused modes and clean up the file. If the component is no longer needed at all, delete it and move the filter panel components (`SidebarContent`, `DateFilterPanel`, etc.) into their own file or into `SearchFilterSidebar`.
**Warning signs:** Linter warnings about unused code, or confusion about which component to use.

## Code Examples

Verified patterns from the existing codebase:

### Current Desktop Rendering (to be replaced)
```typescript
// Source: components/results-page-content.tsx lines 184-221
// Currently:
<div className="flex flex-col flex-1 w-full">
  <TwoColumnLayout
    leftColumn={<SearchSidebar mode="panel" />}
    rightColumn={
      <PageWrapper>
        <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
          <main className="w-full">
            <ResultsList ... />
          </main>
        </div>
      </PageWrapper>
    }
  />
</div>
```

### Current Mobile Rendering (to be replaced)
```typescript
// Source: components/results-page-content.tsx lines 92-181
// Currently: manual Tabs + AnimatePresence + SearchSidebar mode="page"
// This entire block (~90 lines) is replaced by SidebarLayout
```

### Target Desktop + Mobile (unified)
```typescript
// Replaces both the desktop and mobile branches:
<SidebarLayout sidebar={<SearchFilterSidebar />}>
  <PageWrapper>
    <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
      <main className="w-full">
        <ResultsList ... />
      </main>
    </div>
  </PageWrapper>
</SidebarLayout>
```

### Existing SidebarContent (to be reused as-is)
```typescript
// Source: components/search-sidebar.tsx lines 522-599
// SidebarContent renders all filter panels in order:
// - ID Filters at top when active (cites, citedBy, relatedTo)
// - DateFilterPanel
// - RatingFilterPanel
// - InstitutionLocationFilterPanel
// - CountryFocusFilterPanel
// - SearchFieldPanel
// - SortOptionsPanel
// - ReviewFilterPanel
// - Inactive ID Filters at bottom
// Props: hideHeader, isMobileSheet, activeFiltersCount, isCitesActive, isCitedByActive, isRelatedToActive, onClearAllFilters
```

### Existing Filter State + Clear Logic (to be moved to SearchFilterSidebar)
```typescript
// Source: components/search-sidebar.tsx lines 625-686
// This block reads all filter state from useCurrentSearchFormState() and useUpdateSearchFilter(),
// computes isCitesActive/isCitedByActive/isRelatedToActive,
// defines handleClearAllFilters (resets all to DEFAULT_FILTERS),
// and calls countActiveFilters().
// This entire block moves into SearchFilterSidebar.
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
| Monolithic SearchSidebar with 4 modes | Composed FilterSidebar chrome + domain-specific content | Phase 32 (this phase) | Eliminates chrome duplication, enables Phase 33 library reuse |
| Manual mobile tab logic in ResultsPageContent | SidebarLayout handles responsive branching | Phase 31 created, Phase 32 adopts | Eliminates ~90 lines of per-page mobile logic |
| Each page reimplements desktop two-column | SidebarLayout composes TwoColumnLayout internally | Phase 31 created, Phase 32 adopts | Single-line layout composition per page |

**Deprecated/outdated:**
- `SearchSidebar mode="sheet"`: Zero consumers in codebase. Should be removed.
- `SearchSidebar mode="sidebar"` (default): Zero consumers in codebase. Should be removed.
- Manual `TwoColumnLayout` + `Tabs` + `AnimatePresence` in ResultsPageContent: Replaced by `SidebarLayout`.

## Open Questions

1. **Should SearchSidebar be deleted entirely or kept as a thin wrapper?**
   - What we know: Only `mode="panel"` and `mode="page"` are used. Both are being replaced. The filter panel components (`DateFilterPanel`, `RatingFilterPanel`, etc.) and `SidebarContent` are defined inside `search-sidebar.tsx` and need to be accessible.
   - What's unclear: Whether to move the filter panels into `SearchFilterSidebar` or keep them in a renamed file.
   - Recommendation: Move `SidebarContent` and all filter panel components into `search-filter-sidebar.tsx` (or a dedicated `search-filter-panels.tsx` file). Delete or empty out `search-sidebar.tsx`. This avoids keeping a 944-line file with zero consumers.

2. **Should the mobile SidebarContent show a header with "Clear All" button?**
   - What we know: Currently, `SearchSidebar mode="page"` passes `hideHeader={true}` and `isMobile={true}` to `SidebarContent`. The mobile tab already provides navigation context, so the header is hidden. However, without the header, there is no "Clear All" button on mobile.
   - What's unclear: Whether the current production mobile experience intentionally hides the clear-all or if it was an oversight.
   - Recommendation: Match current production behavior exactly. Pass `hideHeader={true}` on mobile to maintain visual parity. If a mobile clear-all is desired, that is a separate feature request for a later phase.

3. **Should the `handleClearAllFilters` logic be extracted into a hook?**
   - What we know: The clear-all logic (reset 13+ filter fields to defaults) is currently inline in `SearchSidebar`. It will need to exist in `SearchFilterSidebar`.
   - What's unclear: Whether to extract it into a reusable `useClearAllSearchFilters()` hook or keep it inline.
   - Recommendation: Keep it inline in `SearchFilterSidebar` for now. Extract to a hook only if Phase 34 or another consumer needs the same logic. Avoid premature abstraction.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** - Direct reading of all relevant source files:
  - `components/results-page-content.tsx` (223 lines) - Current desktop/mobile rendering with manual layout logic
  - `components/search-sidebar.tsx` (944 lines) - Monolithic sidebar with 4 modes, filter panels, SidebarContent
  - `components/shared/sidebar-layout.tsx` (116 lines) - Phase 31 SidebarLayout component
  - `components/shared/filter-sidebar.tsx` (265 lines) - Phase 31 FilterSidebar chrome shell
  - `components/shared/filter-section.tsx` (88 lines) - Shared filter section chrome
  - `components/layout/two-column-layout.tsx` (32 lines) - Desktop two-column layout
  - `components/PageWrapper.tsx` (21 lines) - Page wrapper with footer
  - `lib/store.ts` (lines 1112-1188) - FilterSidebarState, useFilterSidebarStore, getFilterSidebarDimensions, createSidebarStore, createSidebarDimensions
  - `lib/hooks.ts` (lines 155-260) - useCurrentSearchFormState, useUpdateSearchFilter
  - `lib/filters/filter-builder.ts` (line 455) - countActiveFilters
  - `app/results/[searchId]/page.tsx` - ResultsPageContent consumer
  - `app/results/layout.tsx` - SearchProvider wrapping
  - Grep for `SearchSidebar` usage: only 2 call sites (both in results-page-content.tsx), only `mode="panel"` and `mode="page"`

### Secondary (MEDIUM confidence)
- Phase 31 research (`31-RESEARCH.md`) - Validated architecture patterns and pitfall catalog
- Phase 31 plan summaries (`31-01-SUMMARY.md`, `31-02-SUMMARY.md`) - Confirmed what was actually built

### Tertiary (LOW confidence)
- None. All findings are from direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries; everything is already in the project
- Architecture: HIGH - All building blocks exist from Phase 31; this is pure rewiring
- Pitfalls: HIGH - All pitfalls identified from actual code analysis (mobile null guard, duplicate keyboard shortcut, header visibility)

**Research date:** 2026-03-01
**Valid until:** 2026-03-31 (stable; no external dependencies to go stale)
