# Architecture Patterns: Library Page UI Overhaul

**Project:** OpenAlex Count (v2.2 Library UI Overhaul)
**Domain:** Academic search platform with library management
**Researched:** 2026-03-01
**Confidence:** HIGH

## Executive Summary

The library page currently uses a single-column layout (PageWrapper → LibraryPageClient → LibraryFilters → grid/list), while the search page uses a proven two-column pattern (TwoColumnLayout → SearchSidebar + ResultsList) with mobile tab-based fallback. The overhaul should **generalize the two-column layout and sidebar patterns** rather than duplicate them.

**Key decision:** Extract SearchSidebar into a generalized `<FilterSidebar>` component with mode-specific render strategies, keeping domain-specific filter logic (SearchSidebar vs LibrarySidebar) in separate, reusable filter panel components. This maintains DRY while preserving modularity.

**State management divergence:** Search uses SearchProvider context (for reactive filter changes), Library uses nuqs URL params directly (for bookmarkable states). The overhaul should preserve both patterns — they serve different purposes.

---

## Current Architecture Analysis

### Search Page Pattern (Desktop)
```
app/results/[searchId]/page.tsx
  ↓
ResultsPageContent
  ├─ TwoColumnLayout (flex layout: left sticky, right flex-1)
  │  ├─ SearchSidebar (mode="panel")
  │  │  ├─ SidebarContent (layout: flex flex-col, space-y-4)
  │  │  │  ├─ DateFilterPanel (memoized)
  │  │  │  ├─ RatingFilterPanel (memoized)
  │  │  │  ├─ InstitutionLocationFilterPanel
  │  │  │  ├─ SearchFieldPanel
  │  │  │  └─ SortOptionsPanel
  │  │  │  └─ ReviewFilterPanel
  │  │  └─ FloatingControls (collapse/clear buttons with Framer Motion)
  │  │
  │  └─ PageWrapper
  │     └─ ResultsList (PapersGrid → PaperCard[])
  │
  └─ shared: FilterSection component (consistent styling across all filters)
```

**Key characteristics:**
- **Layout:** TwoColumnLayout with sticky left sidebar (h-screen, shrink-0) + right column flex-1
- **Sidebar modes:** "panel" (collapsible with animation), "sheet" (mobile drawer), "page" (full-width)
- **Filter rendering:** 10 memoized filter panels inside SidebarContent
- **State:** SearchProvider context (reactive), nuqs URL params sync
- **Mobile:** Tabs instead of two-column (Results tab ↔ Filters tab with slide animation)

### Library Page Pattern (Current Single Column)
```
app/library/page.tsx
  ↓
PageWrapper
  ↓
LibraryPageClient
  ├─ Header (title + export dropdown)
  ├─ LibrarySearchBar (input for text search)
  ├─ LibraryFilters (inline horizontal layout)
  │  ├─ RatingFilterPanel (1-5 stars)
  │  ├─ DateSavedFilterPanel (week/month/year presets)
  │  ├─ YearRangeFilterPanel (from/to inputs)
  │  ├─ CollectionFilterPanel (select dropdown)
  │  └─ SortControls + ViewModeToggle
  └─ ContentArea
     ├─ LibraryItemCard[] OR LibraryItemRow[]
     └─ LoadMore button + pagination
```

**Key characteristics:**
- **Layout:** max-w-4xl centered container (single column)
- **Filters:** Horizontal grid layout (1/2/3/4 columns responsive), all always visible
- **State:** nuqs URL params (librarySearchParams)
- **Mobile:** Responsive grid collapses, but filters stay inline (responsive not tab-based)
- **No sidebar pattern:** Unlike search, no collapsible panel

### Shared Components (Already DRY)
- **FilterSection:** Header + content wrapper with active state styling, used by both pages
- **Input, Select, Button, Tooltip:** Shadcn components (no duplication)

### State Management Patterns
| Page | Pattern | Driver | Scope |
|------|---------|--------|-------|
| Search | SearchProvider context + nuqs URL sync | Context (reactive) | search/* pages |
| Library | nuqs URL params only | URL params (bookmarkable) | /library page |
| Bookmarks | Would need similar to library | Would be URL params or Context | /bookmarks page (existing but simple) |

---

## Recommended Architecture

### Layer 1: Generalized Layout Container
Enhance `TwoColumnLayout` or create `<SidebarLayout>` to abstract the two-column + mobile tab pattern:

```typescript
// components/layout/sidebar-layout.tsx (NEW)
interface SidebarLayoutProps {
  sidebar: React.ReactNode;
  sidebarWidth?: 'narrow' | 'default' | 'wide';
  content: React.ReactNode;
  mode?: 'desktop' | 'mobile'; // Auto-selected by isMobile hook
}

export function SidebarLayout({
  sidebar,
  sidebarWidth = 'default',
  content,
  mode,
}: SidebarLayoutProps) {
  // Desktop (≥768px): TwoColumnLayout pattern
  // Mobile (<768px): Tabs pattern (Results/Filters with slide animation)
  // Respects isMobile hook for automatic selection
}
```

**Why:** Eliminates duplication of two-column + tab logic. Both search and library pages use identical responsive behavior. TwoColumnLayout remains as a low-level layout primitive; SidebarLayout is the high-level pattern.

### Layer 2: Sidebar Wrapper Component
Create a generic `<FilterSidebar>` component that handles UI chrome (header, collapse, clear all):

```typescript
// components/layout/filter-sidebar.tsx (NEW)
interface FilterSidebarProps {
  title: string;
  content: React.ReactNode;
  activeFiltersCount: number;
  onClearAll?: () => void;
  isCollapsible?: boolean;
  mode?: 'panel' | 'sheet' | 'full-width';
  isMobile?: boolean;
}

export function FilterSidebar({
  title,
  content,
  activeFiltersCount,
  onClearAll,
  isCollapsible = true,
  mode = 'panel',
  isMobile = false,
}: FilterSidebarProps) {
  // Reusable sidebar chrome: header, collapse toggle, clear button
  // Content is render prop / children (filter panels supplied by caller)
  // Handles panel collapse animation (Framer Motion) for desktop
  // Handles Sheet rendering for mobile if mode='sheet'
}
```

**Why:** SearchSidebar is 944 lines (930 of logic + 14 of layout). Extract layout/chrome into this, move domain-specific logic to filter panels. Reduces cognitive load.

### Layer 3: Domain-Specific Filter Panels
Keep existing memoized filter panels (DateFilterPanel, RatingFilterPanel, etc.) but compose them separately:

**For Search:**
```typescript
// components/search/search-filter-sidebar.tsx (NEW)
export function SearchFilterSidebar({ mode = 'panel' }: { mode?: 'panel' | 'sheet' }) {
  const tf = useTranslations("searchFilters");
  const { /* state from SearchProvider */ } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const activeFiltersCount = countActiveFilters(/* ... */);

  return (
    <FilterSidebar
      title={tf("searchFiltersTitle")}
      activeFiltersCount={activeFiltersCount}
      onClearAll={handleClearAllFilters}
      mode={mode}
      content={
        <>
          <DateFilterPanel />
          <RatingFilterPanel />
          <InstitutionLocationFilterPanel />
          <SearchFieldPanel />
          <SortOptionsPanel />
          <ReviewFilterPanel />
          {/* ... etc */}
        </>
      }
    />
  );
}
```

**For Library:**
```typescript
// components/library/library-filter-sidebar.tsx (NEW)
export function LibraryFilterSidebar({ mode = 'panel' }: { mode?: 'panel' | 'sheet' }) {
  const t = useTranslations("libraryPage");
  const [params, setParams] = useQueryStates(librarySearchParams);

  const activeFiltersCount = countLibraryActiveFilters({
    minRating: params.rating,
    savedPreset: params.saved,
    yearFrom: params.yf,
    yearTo: params.yt,
    collectionId: params.col,
  });

  return (
    <FilterSidebar
      title={t("filters")}
      activeFiltersCount={activeFiltersCount}
      onClearAll={() => setParams({ rating: null, saved: null, yf: null, yt: null, col: null })}
      mode={mode}
      content={
        <>
          <LibraryRatingFilterPanel />
          <LibraryDateSavedFilterPanel />
          <LibraryYearRangeFilterPanel />
          <LibraryCollectionFilterPanel />
          {/* Sort + View mode controls can go here too */}
        </>
      }
    />
  );
}
```

**Why:** Each domain has different filters. Sidebar chrome is shared, filter logic is separate. This keeps the codebase maintainable.

### Component Boundaries

| Component | Responsibility | Location | Reused By | Status |
|-----------|-----------------|----------|-----------|--------|
| `TwoColumnLayout` | Low-level two-column flex layout | `components/layout/` | SidebarLayout, legacy code | Unchanged |
| `SidebarLayout` | High-level responsive (desktop two-column + mobile tabs) | `components/layout/` | Search, Library, Bookmarks | **NEW** |
| `FilterSidebar` | Sidebar chrome (header, collapse, clear button), content slot | `components/layout/` | Search, Library, Bookmarks | **NEW** |
| `FilterSection` | Individual filter panel wrapper (active state, clear button) | `components/shared/` | All filter panels | Unchanged |
| `SearchFilterSidebar` | Search-specific filters composition | `components/search/` | Search page only | **NEW** |
| `LibraryFilterSidebar` | Library-specific filters composition | `components/library/` | Library page only | **NEW** |
| `SearchSidebar` | Current 944-line sidebar (all-in-one) | `components/` | Search page | **Deprecated after refactor** |
| `LibraryFilters` | Current inline filter grid | `components/library/` | Library page | **Replaced by LibraryFilterSidebar** |
| `LibraryPageClient` | Main library page logic (state, queries) | `components/library/` | /library route | **Modified** |
| `ResultsPageContent` | Main search results logic (state, queries) | `components/` | /results/[searchId] route | **Modified** |

---

## Data Flow

### Search Page (Desktop)
```
ResultsPageContent (routes params to SearchProvider)
  ↓
SearchProvider (state = context + nuqs URL sync)
  ├─ SidebarLayout
  │  ├─ SearchFilterSidebar (reads context, triggers updates)
  │  │  ├─ DateFilterPanel (useCurrentSearchFormState, useUpdateSearchFilter)
  │  │  └─ RatingFilterPanel
  │  │
  │  └─ ResultsList (reads context, renders results)
```

**Query response to filter change:**
1. User clicks filter → useUpdateSearchFilter(new value)
2. Hook updates context + syncs to nuqs URL
3. Search query re-runs (context is dependency)
4. Results re-render

### Library Page (Desktop)
```
LibraryPageClient (manages state via nuqs URL params)
  ↓
SidebarLayout
  ├─ LibraryFilterSidebar (reads URL params, calls setParams)
  │  ├─ LibraryRatingFilterPanel (local rating state, onMinRatingChange callback)
  │  └─ LibraryYearRangeFilterPanel (local year state, onYearFromChange callback)
  │
  └─ ContentArea (reads URL params via useMemo, triggers Convex queries)
     ├─ searchLibrary query (if search text)
     └─ browseLibrary query (if no search text)
```

**Query response to filter change:**
1. User clicks filter → onMinRatingChange(value)
2. LibraryFilterSidebar calls setParams({ rating: value })
3. nuqs URL updates → page re-renders
4. useMemo(librarySearchParams) changes → Convex query re-runs
5. Results re-render

**Key difference:** Library doesn't use SearchProvider (search-specific), relies on nuqs directly. This is intentional and correct — URL params are the source of truth for bookmarkability.

---

## Mobile Pattern (Tab-Based)

Both search and library should support:

```
Mobile Tab Interface (SidebarLayout on mobile):
┌─────────────────────────────┐
│ [Results] | [Filters]       │  ← TabsList (Results tab active)
├─────────────────────────────┤
│ Results Tab:                │
│ ┌───────────────────────────┤
│ │ PapersGrid / LibraryGrid  │
│ │ (scrollable content)      │
│ └───────────────────────────┤
│                             │
│ Filters Tab (not shown):    │
│ ┌───────────────────────────┤
│ │ Filter panels (vertical)  │
│ │ with clear all button     │
│ │ (scrollable sidebar)      │
│ └───────────────────────────┤
└─────────────────────────────┘
```

**Implementation in SidebarLayout:**
```typescript
export function SidebarLayout({
  sidebar,
  sidebarWidth = 'default',
  content,
}: SidebarLayoutProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    const [activeTab, setActiveTab] = useState<'results' | 'filters'>('results');
    const direction = activeTab === 'filters' ? 1 : -1;

    return (
      <div className="flex flex-col flex-1 w-full h-full">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as 'results' | 'filters')}
          className="flex flex-col flex-1 h-full gap-0"
        >
          <TabsList className="w-full rounded-none border-b">
            <TabsTrigger value="results" className="flex-1">
              <FileText className="h-4 w-4 mr-2" />
              Results
            </TabsTrigger>
            <TabsTrigger value="filters" className="flex-1">
              <ListFilter className="h-4 w-4 mr-2" />
              Filters
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 relative overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout" custom={direction}>
              {activeTab === 'results' ? (
                <motion.div key="results" custom={direction} variants={slideVariants} /* ... */>
                  {content}
                </motion.div>
              ) : (
                <motion.div key="filters" custom={direction} variants={slideVariants} /* ... */>
                  {sidebar}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Tabs>
      </div>
    );
  }

  // Desktop: TwoColumnLayout
  return (
    <TwoColumnLayout
      leftColumn={sidebar}
      rightColumn={content}
    />
  );
}
```

---

## Anti-Patterns to Avoid

### ❌ Duplicating TwoColumnLayout
Current situation: TwoColumnLayout exists but only used by search.
**Problem:** If library overhaul creates its own two-column layout, mobile behavior (Tabs) must be reimplemented.
**Solution:** Create SidebarLayout that wraps TwoColumnLayout + adds mobile tab logic.

### ❌ Creating a "UniversalSidebar" Component
Taking SearchSidebar and trying to parameterize all its filter logic (date filters from search, rating filters from library, etc.).
**Problem:** 944-line component becomes unmaintainable. Too many conditionals.
**Solution:** Extract chrome (FilterSidebar), keep domain logic separate (SearchFilterSidebar, LibraryFilterSidebar).

### ❌ Forcing Library Filters into Sidebar Panel on Desktop
Library filters work as inline horizontal grid. Moving to sidebar loses this advantage.
**Problem:** Sidebar is fixed-width, filters are right-aligned, responsive grid breaks.
**Solution:** Redesign library filters to work as vertical sidebar panels (see Trade-off Analysis).

### ❌ Mixing State Management Patterns
SearchProvider is great for reactive real-time filter UX. URL params are great for bookmarkable state.
**Problem:** Library doesn't need SearchProvider (no real-time sync needed), but forcing it creates unnecessary context overhead.
**Solution:** Library stays with nuqs only. Search keeps SearchProvider + nuqs. Both legitimate patterns.

---

## Trade-Off Analysis

### Option A: Sidebar for Library (Desktop) — RECOMMENDED
**Pros:**
- Unified visual pattern across search and library
- Mobile tab pattern works identically (SidebarLayout handles both)
- Consistent product experience
- Higher screen real estate for content (sidebar can collapse)

**Cons:**
- Library filters redesigned from horizontal grid → vertical sidebar panels
- Loses responsive grid behavior (was adaptable to screen size)
- Sidebar width constraint might feel cramped for library view

**Build effort:** Medium (redesign filter grid, create LibraryFilterSidebar, update LibraryPageClient)

**Recommendation:** ✅ DO THIS — consistency across product is worth the UX tradeoff. Library sidebar can still use horizontal filter toggles within panels (like rating stars in a row).

### Option B: Keep Library Filters Inline, Only Sidebar for Mobile
**Pros:**
- Library desktop keeps current horizontal grid (good responsive behavior)
- Mobile gets tab-based interface without redesigning desktop

**Cons:**
- Two different responsive patterns (search has sidebar desktop + tabs mobile, library has grid desktop + sidebar mobile)
- SidebarLayout only used by search on desktop (low reuse)
- More complexity in component composition logic
- Inconsistent product experience

**Build effort:** High (conditional logic in page components, partial generalization)

**Recommendation:** ❌ DO NOT — architectural inconsistency creates maintenance burden.

### Option C: Generalize SearchSidebar Only (Parameterized)
**Pros:**
- Minimal code deletion
- One component to understand

**Cons:**
- 944-line component with complex conditional logic
- Hard to test individual filter panels
- Difficult to add new filters without understanding entire sidebar
- Creates technical debt

**Build effort:** Low initially, high long-term

**Recommendation:** ❌ DO NOT — creates technical debt that compounds over time.

---

## Suggested Build Order

### Phase 1: Foundation (Weeks 1-2)
Create generalized infrastructure without touching existing pages.

1. **Create SidebarLayout Component**
   - Location: `components/layout/sidebar-layout.tsx`
   - Handles: desktop two-column + mobile tabs + responsive switching
   - Depends on: TwoColumnLayout, Tabs, Framer Motion
   - Tests: Mobile/desktop rendering, tab switching, animation

2. **Create FilterSidebar Component**
   - Location: `components/layout/filter-sidebar.tsx`
   - Handles: header, collapse toggle, clear all button, motions
   - Depends on: FilterSection (reuse), Framer Motion, Button
   - Tests: Header rendering, collapse animation, clear button

### Phase 2: Search Page Refactor (Weeks 2-3)
Migrate search page to new architecture (safe because search is isolated).

3. **Create SearchFilterSidebar**
   - Location: `components/search/search-filter-sidebar.tsx`
   - Composes: FilterSidebar + 10 filter panels (date, rating, etc.)
   - Reuses: DateFilterPanel, RatingFilterPanel, etc. (already memoized)
   - Tests: Filter composition, active count calculation, state integration

4. **Update ResultsPageContent**
   - Replace: `<TwoColumnLayout>` with `<SidebarLayout>`
   - Replace: `<SearchSidebar mode="panel">` with `<SearchFilterSidebar>`
   - Update mobile: Use SidebarLayout's built-in tab logic (remove manual Tabs code)
   - Tests: Results page rendering, filters still work, mobile tabs work

5. **Delete/Deprecate SearchSidebar**
   - After search page migration, delete old SearchSidebar.tsx
   - Verify no other imports exist
   - Update imports in ResultsPageContent

### Phase 3: Library Page Overhaul (Weeks 3-4)
Implement library UI overhaul using new architecture.

6. **Create Library Filter Panels**
   - Reuse: FilterSection component (existing, reusable)
   - Create memoized panels:
     - LibraryRatingFilterPanel (star picker)
     - LibraryDateSavedFilterPanel (preset buttons)
     - LibraryYearRangeFilterPanel (from/to inputs)
     - LibraryCollectionFilterPanel (select dropdown)
   - Tests: Individual panel logic, state callbacks with nuqs

7. **Create LibraryFilterSidebar**
   - Location: `components/library/library-filter-sidebar.tsx`
   - Composes: FilterSidebar + library filter panels
   - State: Read from nuqs (librarySearchParams), call setParams callbacks
   - Tests: Filter composition, library-specific logic, active count calculation

8. **Redesign LibraryPageClient**
   - Wrap with SidebarLayout (new mobile behavior)
   - Replace: inline LibraryFilters with LibraryFilterSidebar
   - Move: sort/view controls into LibraryFilterSidebar footer
   - Tests: Full library page, responsive layout, filters work with Convex queries

### Phase 4: Polish & Bookmarks (Weeks 4-5)
Extend to other pages, finalize design.

9. **Update Bookmarks Page** (if exists and needed)
   - Apply SidebarLayout pattern
   - Create BookmarkFilterSidebar if needed

10. **Cross-Page E2E Testing**
    - Navigation: search ↔ library ↔ bookmarks
    - Mobile: Tab switching, filter state persistence
    - Desktop: Sidebar collapse, responsive grid
    - State isolation: Changes on one page don't affect others

---

## State Management Decision

**Recommendation: Keep current patterns, generalize layout only.**

**Search page:** SearchProvider + nuqs (reactive)
→ Use `useCurrentSearchFormState()` + `useUpdateSearchFilter()`
→ Keep for real-time filter feedback (instant UI update as user clicks)

**Library page:** nuqs only (bookmarkable)
→ Use `useQueryStates(librarySearchParams)` + `setParams()`
→ Keep for URL bookmarkability (no SearchProvider needed, adds no value)

**Why not unified context?**
- Library filters are persistence-driven (bookmarkable URLs), not reactivity-driven
- Adding SearchProvider to library adds no value (queries already keyed by URL state)
- Keeps library page simple and focused on its concern (URL-driven queries)
- SearchProvider is specific to search domain (manages multiple filter states, complex interactions)

**When context sharing might be needed:**
- Bookmarks page: If it needs real-time filter updates AND bookmarkable state, add BookmarkProvider
- Future shared filtering: If a new feature needs multi-page filter sync, create GenericFilterProvider

---

## Responsive Behavior

### Desktop (≥768px)
```
┌──────────────────────────────────────────────────────┐
│ FilterSidebar (w-80, sticky top-0 h-screen)  │ Content (flex-1) │
│ ┌────────────────────────────────────────────┤ ┌──────────────┤
│ │ [≡] Filters  [3]  [✕]                      │ │ Header       │
│ │ ┌──────────────────────────────────────────┤ │ SearchBar    │
│ │ │ ┌ Rating Filter                          │ │ ┌──────────┐ │
│ │ │ │ ★★★★★ (1-5 range selector)            │ │ │ Items    │ │
│ │ │ └─[Clear]                                │ │ │ Grid/   │ │
│ │ │                                          │ │ │ List    │ │
│ │ │ ┌ Date Saved Filter                     │ │ │        │ │
│ │ │ │ [Week] [Month] [Year]                 │ │ │        │ │
│ │ │ └─[Clear]                                │ │ └────────┘ │
│ │ │                                          │ │ [Load More] │
│ │ │ ... more filters ...                     │ │             │
│ │ └──────────────────────────────────────────┤ └─────────────┤
│ └────────────────────────────────────────────┤ Footer       │
└──────────────────────────────────────────────────────────┘
```

### Tablet (640px-767px)
```
Tabs: [Results] [Filters]
├─ Results tab:
│  ├─ Content (full width)
│  └─ Items in grid/list
│
└─ Filters tab:
   ├─ FilterSidebar (full width, scrollable)
   ├─ Rating / Date / Year filters
   └─ Clear all button
```

### Mobile (<640px)
Same as tablet, but with:
- Smaller font sizes
- Touch-optimized spacing (larger tap targets)
- Simplified filter layouts

---

## Integration Points with Existing Code

### 1. **SearchProvider Context (Search page)**
No changes. SearchFilterSidebar reads from context (useCurrentSearchFormState).
- Continues to drive reactive filter updates
- URL params still sync for bookmarkability

### 2. **nuqs URL Params (Library page)**
No changes. LibraryFilterSidebar reads/writes via librarySearchParams + useQueryStates.
- URL remains source of truth for library state
- Convex queries keyed by URL params

### 3. **Convex Queries**
No changes. Results component still subscribes to query functions.
- SearchProvider pages: Query results update when context changes
- Library page: Query results update when URL params change

### 4. **FilterSection Component**
Already generalized. Reuse as-is in all filter panels (search and library).
- No changes needed
- Consistent styling across all pages

### 5. **Existing CSS/Tailwind**
- TwoColumnLayout uses flex + sticky positioning (unchanged)
- SidebarLayout builds on TwoColumnLayout (compatible)
- Responsive widths (w-80 sidebar, flex-1 content) preserved

### 6. **i18n (next-intl)**
- SearchSidebar uses `useTranslations("searchFilters")`
- LibraryFilters uses `useTranslations("libraryPage")`
- Keep namespace isolation: FilterSidebar doesn't manage i18n, caller does
- Each domain (search, library) controls its own translation namespaces

---

## Scalability Considerations

| Concern | At 100 Users | At 10K Users | At 1M Users |
|---------|--------------|--------------|-------------|
| **Sidebar performance** | No issue (memoized panels) | No issue (React.memo optimization) | Monitor if filtering adds complexity |
| **Filter responsiveness** | Instant (local state) | Instant (context updates are synchronous) | May need debouncing for real-time searches |
| **Mobile tab switching** | Smooth (CSS transition) | Smooth (no state loss) | Consider virtualizing very large lists |
| **URL state size** | ~50 bytes typical | ~100 bytes with many filters | May exceed URL length limits (implement param compression if needed) |
| **Sidebar re-renders** | Minimal (memoized panels) | Minimal (FilterSection memoized) | Monitor with React DevTools Profiler |

**Recommendation:** Current approach (React.memo + Zustand + nuqs) scales well to 10K+ users. Monitor for:
- URL param length (nuqs can hit browser limits with many filters, ~2KB practical limit)
- Filter panel re-render frequency (check React DevTools Profiler)
- Convex query cost (with many simultaneous filters on library page)

---

## Summary Table

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Layout generalization** | SidebarLayout (desktop two-column + mobile tabs) | DRY, consistent responsive behavior, code reuse |
| **Sidebar chrome** | FilterSidebar component | Deduplicates SearchSidebar chrome (collapse, clear, header) |
| **Filter logic** | Separate SearchFilterSidebar + LibraryFilterSidebar | Domain-specific logic stays isolated, easier to maintain |
| **State management** | Keep SearchProvider (search) + nuqs (library) | Different purposes, both optimal for their domain |
| **Mobile pattern** | Tabs (Results/Filters with slide animation) | Consistent with search page, proven UX pattern |
| **Library desktop layout** | Sidebar (redesigned from inline grid) | Unified visual pattern, worth UX tradeoff |
| **Build order** | Foundation → Search refactor → Library overhaul → Polish | Risk mitigation (prove pattern on search first) |
| **Reusable primitives** | TwoColumnLayout, FilterSection, SidebarLayout, FilterSidebar | Build once, use by search + library + bookmarks |
| **Memoization strategy** | React.memo on all filter panels | Prevent unnecessary re-renders when parent updates |

---

## Implementation Checklist

### Phase 1: Foundation
- [ ] Create `components/layout/sidebar-layout.tsx`
- [ ] Create `components/layout/filter-sidebar.tsx`
- [ ] Write tests for responsive behavior (mobile/desktop)
- [ ] Verify Framer Motion animations work
- [ ] Document SidebarLayout props interface

### Phase 2: Search Refactor
- [ ] Create `components/search/search-filter-sidebar.tsx`
- [ ] Update `ResultsPageContent` to use new components
- [ ] Remove manual Tabs code from ResultsPageContent
- [ ] Update mobile tab pattern tests
- [ ] Verify search filters still work end-to-end
- [ ] Delete old SearchSidebar.tsx

### Phase 3: Library Overhaul
- [ ] Create library filter panels (Rating, DateSaved, YearRange, Collection)
- [ ] Create `components/library/library-filter-sidebar.tsx`
- [ ] Update `LibraryPageClient` to use SidebarLayout
- [ ] Update `LibraryPageClient` to use LibraryFilterSidebar
- [ ] Move sort/view controls into sidebar footer
- [ ] Test library filters with nuqs params
- [ ] Test Convex queries respond to filter changes
- [ ] Delete old LibraryFilters.tsx

### Phase 4: Polish
- [ ] Update Bookmarks page (if applicable)
- [ ] Cross-page E2E tests
- [ ] Mobile responsiveness tests
- [ ] Accessibility tests (tab navigation, ARIA labels)
- [ ] Performance profiling (Lighthouse, React DevTools)

---

## Sources

**Current codebase:**
- `/components/layout/two-column-layout.tsx` — Layout primitive (32 lines)
- `/components/search-sidebar.tsx` — 944-line sidebar with 10 filter panels
- `/components/library/library-page-client.tsx` — 381-line page component
- `/components/library/library-filters.tsx` — 407-line inline filter grid
- `/components/shared/filter-section.tsx` — Reusable filter panel wrapper (89 lines)
- `/components/results-page-content.tsx` — Search page composition (223 lines)

**State management:**
- `/lib/store.ts` — Zustand stores (FilterSidebarStore, RatingsStore)
- `/lib/search/provider.tsx` — SearchProvider context
- `/lib/library/search-params.ts` — nuqs parsers for library URL state

**Design patterns:**
- Framer Motion animations (`/lib/ui/sidebar-motion.ts`)
- next-intl translations (search: "searchFilters", library: "libraryPage")
- Shadcn UI components (Button, Select, Input, Tooltip, Tabs)
- React.memo pattern for filter panels
