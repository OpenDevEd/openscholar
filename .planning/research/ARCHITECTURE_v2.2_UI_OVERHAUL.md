# Architecture Patterns — Library UI Overhaul (v2.2)

**Domain:** Academic search app — library page UI redesign
**Researched:** 2026-03-01
**Goal:** Two-column layout with sidebar filters matching search page patterns

## Recommended Architecture

### High-Level Component Structure

```
LibraryPage (Server Component)
└── PageWrapper (client boundary)
    └── LibraryPageClient (Client Component)
        ├── useQueryStates(librarySearchParams) — URL state
        ├── useState(expandedItemId, collectionPickerOpen) — UI state
        ├── useIsMobile() — Responsive logic
        │
        ├─── Desktop (lg+): TwoColumnLayout
        │    ├── LeftColumn: LibraryFilterSidebar
        │    │   ├── LibrarySearchBar (search input + nuqs sync)
        │    │   ├── FilterSection (Date Saved)
        │    │   │   └── DateRangePicker / preset buttons
        │    │   ├── FilterSection (Year Range)
        │    │   │   └── YearRangePicker
        │    │   ├── FilterSection (Rating)
        │    │   │   └── RatingRangePicker
        │    │   ├── FilterSection (Collection)
        │    │   │   └── CollectionPicker (dropdown)
        │    │   └── "Clear All" Button
        │    │
        │    └── RightColumn: LibraryResults
        │        ├── LibraryToolbar (sort dropdown, export, view mode)
        │        ├── LibraryItemRow[] OR LibraryItemCard[] (grid)
        │        ├── Pagination (Convex cursor-based)
        │        └── LibraryEmptyState (when no results)
        │
        └─── Mobile (< lg): Tabs[results|filters]
             ├── TabsList (results/filters trigger)
             ├── TabsContent (AnimatePresence + slide)
             ├── Results tab
             │   ├── LibraryToolbar
             │   ├── LibraryItemCard[] (mobile grid)
             │   └── Pagination
             │
             └── Filters tab (full screen)
                 └── LibraryFilterSidebar
```

### Component Boundaries

| Component | Responsibility | Props | Communicates With |
|-----------|--------------|-------|-------------------|
| **LibraryPageClient** | Orchestrates state, responsive logic, query orchestration | none | nuqs, Zustand, Convex queries, child components |
| **TwoColumnLayout** | Layout: flex, sticky left, scrollable right | leftColumn, rightColumn, className | CSS only (Tailwind) |
| **LibraryFilterSidebar** | Container for all filter sections; manages ScrollArea | — | Child filters, FilterSection |
| **FilterSection** | Reusable filter group with header, icon, active state, clear button | title, icon, isActive, children, onClear | Motion (animation), child content |
| **LibrarySearchBar** | Search input + debounce + nuqs sync | — | nuqs (setParams), icon from lucide-react |
| **DateRangePicker** | Calendar picker for date saved filter | — | Radix UI (Dialog, Calendar), Popover |
| **YearRangePicker** | Dual slider for year range | — | Radix UI (Slider) |
| **RatingRangePicker** | Dual slider for rating (0-5) | — | Radix UI (Slider) |
| **CollectionPicker** | Dropdown to select/multiselect collections | — | Radix UI (Select), Convex queries |
| **LibraryToolbar** | Sort dropdown, export, view mode buttons | onSort, onExport | Dropdown (Radix), Download action |
| **LibraryItemRow** | Single item in list view; rating, expand, remove, add to collection | item, onRate, onRemove, onAddToCollection | Rating store (Zustand), Convex mutations |
| **LibraryItemCard** | Single item in grid view; visual card layout | item, onRate, onRemove, onAddToCollection | Same as Row |
| **Pagination** | Load More button or infinite scroll | onLoadMore | Convex pagination state |
| **Tabs** | Mobile-only: results/filters toggle | activeTab, onValueChange | Radix UI Tabs |
| **AnimatePresence** | Mobile tab slide animation | mode, custom, direction | Motion v12 library |

## Data Flow

### State Management Pattern

```
URL State (nuqs) ← Source of truth for filters
├── q (search text)
├── saved (date preset: "today", "week", "month")
├── rating (min rating)
├── yf / yt (year from/to)
├── col (collection ID)
├── sort (field: "saved", "rating", "title")
└── order (direction: "asc", "desc")

↓ (setParams when filter changes)

UI State (Zustand) ← Client-only, not URL-persisted
├── expandedItemId (which item shows expanded view)
├── collectionPickerItemId (which item has collection picker open)
└── [Ratingsstore] ratings (optimistic rating state)

↓ (read params + state to construct query)

Convex Query State ← Server state
├── searchLibrary (dual-path: text search if q present)
├── browseLibrary (regular sort if no search)
├── getLibraryCount (total count for pagination)
├── getCollectionsWithCounts (for filter dropdown)
└── exportLibrary (for CSV/JSON export)
```

### Filter Flow

```
User clicks "Year: 2020-2023"
    ↓
YearRangePicker onChange fires
    ↓
setParams({ yf: 2020, yt: 2023 })  ← Updates URL + nuqs state
    ↓
URL changes to ?yf=2020&yt=2023&...
    ↓
LibraryPageClient re-renders with new params
    ↓
browseLibrary query re-runs with yearFrom/yearTo
    ↓
Results update reactively (Convex real-time sync)
    ↓
No Zustand state touched (this is NOT a UI toggle, it's a filter)
```

### Mobile Tab Flow

```
User on mobile, browsing results
    ↓
User clicks "Filters" tab
    ↓
activeTab state changes "results" → "filters"
    ↓
AnimatePresence picks up direction = 1 (slide right)
    ↓
Results content slides out/left, Filters content slides in/right
    ↓
User adjusts a filter (same as above, params update)
    ↓
User clicks "Results" tab
    ↓
activeTab state changes "filters" → "results"
    ↓
AnimatePresence picks up direction = -1 (slide left)
    ↓
Filters content slides out/right, Results content slides in/left
```

## Patterns to Follow

### 1. Shared FilterSection Component

**What:** Reusable container for any filter type (date, rating, collections, custom)

**When:** Every filter in sidebar uses this

**Example:**
```typescript
<FilterSection
  title="Year Range"
  icon={Calendar}
  isActive={isYearFilterActive}
  onClear={() => setParams({ yf: undefined, yt: undefined })}
>
  <YearRangePicker
    from={params.yf}
    to={params.yt}
    onChange={(from, to) => setParams({ yf: from, yt: to })}
  />
</FilterSection>
```

**Implementation details:**
- Icon changes color on active (sidebar-primary)
- Title becomes bold on active
- Clear button fades in when active (Motion initial={false})
- Left gradient bar animates in when active
- Child content remains static (no animation)

### 2. nuqs for URL State

**What:** Query string state synchronization using `useQueryStates`

**When:** Any filter change or sort change must update URL

**Example:**
```typescript
const [params, setParams] = useQueryStates(librarySearchParams);

// Reading
const yearFrom = params.yf;
const yearTo = params.yt;

// Writing
setParams({ yf: 2020, yt: 2023 });  // Shallow merge, other params preserved

// Clearing
setParams({ yf: undefined, yt: undefined });  // Remove from URL
```

**Why:** Bookmarkable filtered views, refresh preserves state, back button works

### 3. Motion Layout Animations

**What:** Automatic height/position animations using Motion's `layout` prop

**When:** Filter sections collapse/expand, tab slide animation

**Example (tab slide):**
```typescript
const slideVariants = {
  enter: (direction) => ({ x: direction > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction) => ({ x: direction > 0 ? -40 : 40, opacity: 0 }),
};

<AnimatePresence mode="popLayout" custom={direction}>
  {activeTab === "results" ? (
    <motion.div
      key="results"
      custom={direction}
      variants={slideVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={subtleSpring}
    >
      {/* Results content */}
    </motion.div>
  ) : (
    <motion.div key="filters" /* ... */>
      {/* Filters content */}
    </motion.div>
  )}
</AnimatePresence>
```

**Why:** GPU-accelerated transform + opacity, no layout thrashing, `popLayout` prevents jank

### 4. Responsive without JavaScript

**What:** CSS media queries + Tailwind breakpoints for responsive layout

**When:** Always prefer CSS for layout, JS for state management

**Example:**
```typescript
// Good: CSS-based responsiveness
<div className="flex lg:flex-row flex-col">
  <div className="lg:shrink-0 lg:sticky lg:top-0">Sidebar</div>
  <div className="flex-1">Content</div>
</div>

// Bad: JS-based visibility
{isMobile ? <MobileSidebar /> : <DesktopSidebar />}
```

**Why:** No layout shift on hydration, mobile-first, Tailwind handles all breakpoints

### 5. Zustand for UI-Only State

**What:** Lightweight, synchronous state for non-URL state (expanded items, picker open, etc.)

**When:** UI state that doesn't need to be persisted in URL

**Example:**
```typescript
// Define
const useLibraryUIStore = create((set) => ({
  expandedItemId: null,
  setExpandedItemId: (id) => set({ expandedItemId: id }),
}));

// Use
const { expandedItemId, setExpandedItemId } = useLibraryUIStore();
```

**Why:** No URL pollution, instant updates, zero boilerplate vs. useState + useEffect

## Anti-Patterns to Avoid

### 1. JavaScript-Based Responsiveness

**What goes wrong:**
```typescript
// BAD: Layout shift on hydration
const isMobile = useMediaQuery("(max-width: 640px)");
if (isMobile) return <MobileLayout />;
return <DesktopLayout />;
```

**Why bad:** Server renders desktop, client renders mobile → jank, CLS metric fails

**Instead:** Use CSS media queries via Tailwind (`flex-col lg:flex-row`)

### 2. Storing Filter State in Zustand

**What goes wrong:**
```typescript
// BAD: Filter state + URL duplication
const [yearFrom, setYearFrom] = useState();
useEffect(() => {
  setParams({ yf: yearFrom });
}, [yearFrom]);
```

**Why bad:** Duplication, sync lag, back button doesn't restore state, not bookmarkable

**Instead:** Store filters ONLY in URL via `nuqs`

### 3. Direct Height Animation

**What goes wrong:**
```typescript
// BAD: Animating height directly
animate={{ height: isOpen ? 300 : 0 }}
```

**Why bad:** Height is layout property, causes thrashing, not GPU-accelerated, janky

**Instead:** Use Motion's `layout` prop with `overflow: hidden` on container

### 4. Nested Component Trees for Responsive

**What goes wrong:**
```typescript
// BAD: Duplicate content in DOM
<div className="hidden md:block"><DesktopSidebar /></div>
<div className="md:hidden"><MobileSidebar /></div>
```

**Why bad:** Double markup, harder to sync state, more JS to ship

**Instead:** One component, use CSS to hide/show or use single Tabs with CSS breakpoints

### 5. Polling for Filter Changes

**What goes wrong:**
```typescript
// BAD: Manual state syncing
useEffect(() => {
  const timer = setInterval(() => {
    setResults(/* re-query */);
  }, 1000);
}, [params]);
```

**Why bad:** Lag, unnecessary requests, polling can miss changes, Convex handles this reactively

**Instead:** Let Convex queries re-run automatically when params change (useProtectedPaginatedQuery does this)

## Scalability Considerations

| Concern | At 100 items | At 10K items | At 100K+ items |
|---------|--------------|--------------|----------------|
| **Pagination strategy** | Load all at once OK | "Load More" button with Convex cursor | Mandatory cursor-based pagination with limit (20-50) |
| **Search index performance** | Indexes are overkill, but safe | Full-text search indexes essential | Search indexes + compound indexes on userId + filters required |
| **Mobile performance** | All animations smooth | Tab animation still smooth (Motion GPU) | Monitor Motion performance, consider reducing animation duration |
| **Sidebar rendering** | All filters visible, no scroll | Add ScrollArea to sidebar | Collapsible filter groups to reduce clutter |
| **Filter combinations** | Simple OR/AND logic OK | Complex query builder needed? | Use Convex `filter()` helper or indexed queries only |
| **i18n bundle size** | Single locale loaded | All 6 locales loaded | Consider code splitting by locale (next-intl supports this) |

**Recommendation:** Start simple (current plan), add complexity only when needed. All technologies support scaling up.

## Testing Strategy

### Unit Tests (Vitest)

```typescript
// FilterSection.test.tsx
describe("FilterSection", () => {
  it("renders with icon and title", () => { /* ... */ });
  it("shows clear button when active", () => { /* ... */ });
  it("calls onClear when button clicked", () => { /* ... */ });
  it("renders children correctly", () => { /* ... */ });
});

// librarySearchParams.test.ts
describe("librarySearchParams", () => {
  it("parses query string to params", () => { /* ... */ });
  it("serializes params to query string", () => { /* ... */ });
  it("preserves other params when updating one", () => { /* ... */ });
});
```

### Integration Tests (Vitest + React Testing Library)

```typescript
// LibraryPageClient.test.tsx
describe("LibraryPageClient", () => {
  it("syncs filter changes to URL", () => {
    // Click year filter, verify URL changed
  });
  it("loads more items when "Load More" clicked", () => {
    // Verify pagination cursor updated
  });
  it("shows correct collection in dropdown", () => {
    // Verify collection list fetched
  });
});
```

### E2E Tests (Playwright)

```typescript
// library.spec.ts
test("desktop: sidebar sticky, content scrolls", () => {
  // Desktop viewport
  // Scroll results, verify sidebar stays at top
});

test("mobile: tab toggle switches views", () => {
  // Mobile viewport
  // Click filters tab, verify animation smooth, results tab hidden
  // Click results tab, verify animation smooth, filters tab hidden
});

test("mobile: filter changes apply to results", () => {
  // Mobile: on Filters tab, adjust year slider
  // Switch to Results tab
  // Verify results updated
});

test("dark mode: CSS variables apply", () => {
  // Toggle dark mode
  // Take snapshot
  // Verify sidebar, scrollbar, text colors correct
});
```

### Accessibility (Manual + Automated)

```
Keyboard navigation:
- Tab through all form controls (filters, buttons)
- Enter/Space triggers buttons
- Arrow keys work in sliders
- Escape closes dropdowns

Screen reader:
- Filter headings are h3 or labeled with aria-label
- Active state announced ("Year filter is active")
- Button labels clear ("Clear year filter", not just "Clear")

Color contrast:
- All text meets WCAG AA (4.5:1 foreground/background)
- Icons have alt text or aria-label
```

## Sources

Research based on:
1. **Codebase patterns** — Existing SearchSidebar, FilterSection, TwoColumnLayout, results-page-content
2. **Convex documentation** — Query reactivity, pagination, full-text search
3. **Motion v12 docs** — Layout animations, spring configs
4. **Tailwind v4 docs** — Responsive design, custom utilities
5. **Radix UI** — Accessible primitives (Tabs, Collapsible, Dialog)

---

**Last Updated:** 2026-03-01
**Status:** Architecture is clear, battle-tested (exists in search page), ready for implementation.
