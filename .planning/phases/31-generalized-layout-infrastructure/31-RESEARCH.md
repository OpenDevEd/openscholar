# Phase 31: Generalized Layout Infrastructure - Research

**Researched:** 2026-03-01
**Domain:** React component architecture, responsive layout composition, Framer Motion animation, Zustand state persistence, next-intl i18n
**Confidence:** HIGH

## Summary

Phase 31 extracts reusable layout primitives from the existing search page's two-column sidebar pattern. The project already has working implementations of every piece needed: `TwoColumnLayout` (desktop two-column), `SearchSidebar` in `mode="panel"` (collapsible sidebar with Framer Motion + Zustand persistence), mobile tab-based Results/Filters switching (in `ResultsPageContent`), and `FilterSection` (shared individual filter chrome). The task is purely **extraction and generalization** -- no new technology, no new libraries, no new patterns.

The existing `SearchSidebar` component (944 lines) conflates two concerns: (1) generic sidebar chrome (collapse toggle, active count badge, clear button, animation) and (2) search-specific filter content (10 filter panels). Phase 31 separates these into a reusable `FilterSidebar` shell that accepts arbitrary filter content via render prop/children, and a `SidebarLayout` that orchestrates the desktop two-column + mobile tab pattern. The existing `FilterSection` in `components/shared/filter-section.tsx` is already shared and needs no changes.

**Primary recommendation:** Extract the generic sidebar chrome from `SearchSidebar`'s `mode="panel"` branch into a new `FilterSidebar` component, and extract the mobile tab logic from `ResultsPageContent` into the generalized `SidebarLayout`. Use the existing Zustand store pattern, `motion/react` animations, and `next-intl` i18n conventions with zero new dependencies.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DRY-01 | SidebarLayout component generalizes two-column desktop + mobile tabs pattern for reuse across pages | Extract from `TwoColumnLayout` + `ResultsPageContent` mobile tab logic. Both already work in production. SidebarLayout composes them into one component with `useIsMobile()` branching. |
| DRY-02 | FilterSidebar component provides generic sidebar chrome (title, collapse toggle, active count badge, clear button, content slot) | Extract from `SearchSidebar` mode="panel" branch (lines 729-921). The chrome (collapse animation, badge, clear button, toggle) is already generic -- only the `SidebarContent` children are search-specific. |
| DRY-05 | All new shared components have full i18n support across 6 locales | Use existing `next-intl` pattern with `useTranslations()`. New keys go in a new `sidebarLayout` namespace in all 6 message files. Existing `common.results`, `common.filters`, `common.clear` keys can be reused. |
| DRY-06 | FilterSection component reused by both search and library filter panels (no duplication) | Already done. `FilterSection` lives in `components/shared/filter-section.tsx` and is imported by both `SearchSidebar` and `LibraryFilters`. No changes needed -- just verify importability from the new components. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.2.4 | Component framework | Already in project |
| Next.js | ^16.1.6 | App router, SSR framework | Already in project |
| motion | ^12.23.12 | Sidebar collapse/expand animation | Already used for SearchSidebar panel animation via `motion/react` |
| zustand | ^5.0.5 | Sidebar collapse state persistence | Already used for `useFilterSidebarStore` with localStorage |
| next-intl | ^4.8.2 | i18n across 6 locales | Already used throughout entire app |
| @radix-ui/react-tabs | ^1.1.12 | Mobile tab interface | Already used in `ResultsPageContent` for Results/Filters tabs |
| nuqs | ^2.6.0 | URL state persistence for filters | Already used by library page; layout components pass through |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | ^0.487.0 | Icons (Filter, X, FileText, ListFilter) | Already in SearchSidebar panel chrome |
| tailwind-merge / clsx | ^3.4.1 / ^2.1.1 | Class composition via `cn()` | Already standard pattern |
| @radix-ui/react-tooltip | ^1.2.8 | Collapse toggle tooltip | Already in SearchSidebar panel chrome |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zustand for sidebar state | React Context | Zustand already has the localStorage persist middleware wired up; Context would lose persistence across page navigations |
| motion/react for animation | CSS transitions | motion/react already used for sidebar spring physics; CSS would lose the consistent spring feel |
| Render prop/children for content slot | Compound component pattern | Children/render prop is simpler and matches existing project patterns (PageWrapper, TwoColumnLayout all use children) |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
components/
  shared/
    filter-section.tsx          # EXISTING - no changes needed
    sidebar-layout.tsx          # NEW - SidebarLayout (desktop two-column + mobile tabs)
    filter-sidebar.tsx          # NEW - FilterSidebar (generic chrome shell)
  layout/
    two-column-layout.tsx       # EXISTING - keep as internal primitive (used by SidebarLayout)
lib/
  store.ts                      # EXISTING - add generalized sidebar store factory or namespace stores
  ui/
    sidebar-motion.ts           # EXISTING - no changes needed (sidebarSpring, hoverSpring)
  animation-config.ts           # EXISTING - no changes needed (subtleSpring for mobile tabs)
messages/
  en-US.json (+ 5 locales)     # ADD new "sidebarLayout" namespace keys
```

### Pattern 1: SidebarLayout - Responsive Two-Column + Mobile Tabs

**What:** Single component that renders a two-column layout on desktop and tab-based interface on mobile, with the sidebar content in one slot and main content in another.

**When to use:** Any page that needs a filter sidebar pattern (search, library, future pages).

**Example:**
```typescript
// Source: Extracted from components/results-page-content.tsx + components/layout/two-column-layout.tsx
interface SidebarLayoutProps {
  sidebar: React.ReactNode;         // The FilterSidebar component
  children: React.ReactNode;         // Main content area
  sidebarTabLabel?: string;          // Mobile tab label for sidebar (default: i18n "Filters")
  contentTabLabel?: string;          // Mobile tab label for content (default: i18n "Results")
}

export function SidebarLayout({ sidebar, children, sidebarTabLabel, contentTabLabel }: SidebarLayoutProps) {
  const isMobile = useIsMobile();
  const tc = useTranslations("common");

  if (isMobile) {
    // Tab-based interface matching existing ResultsPageContent mobile pattern
    return (
      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">{contentTabLabel ?? tc("results")}</TabsTrigger>
          <TabsTrigger value="sidebar">{sidebarTabLabel ?? tc("filters")}</TabsTrigger>
        </TabsList>
        <TabsContent value="content">{children}</TabsContent>
        <TabsContent value="sidebar">{sidebar}</TabsContent>
      </Tabs>
    );
  }

  // Desktop: two-column with sticky sidebar
  return (
    <TwoColumnLayout leftColumn={sidebar} rightColumn={children} />
  );
}
```

### Pattern 2: FilterSidebar - Generic Chrome Shell

**What:** Renders the sidebar visual chrome (glassmorphic background, collapse toggle button, active filter count badge, clear-all button) and accepts arbitrary filter content via children/render prop. Does NOT know about specific filters.

**When to use:** Wrap page-specific filter content (SearchFilterContent, LibraryFilterContent) inside this shell.

**Example:**
```typescript
// Source: Extracted from components/search-sidebar.tsx mode="panel" (lines 729-921)
interface FilterSidebarProps {
  children: React.ReactNode;           // Filter content (page-specific)
  activeFilterCount: number;           // Badge count
  onClearAll: () => void;              // Clear button handler
  storeKey?: string;                   // Zustand persist key (default: 'openalex-filter-sidebar')
}

export function FilterSidebar({ children, activeFilterCount, onClearAll, storeKey }: FilterSidebarProps) {
  // Uses Zustand store for collapse state + persistence
  // Renders: glassmorphic aside, floating controls (badge + clear + toggle), scrollable content area
  // Animation: motion/react with sidebarSpring for collapse/expand
  // Keyboard shortcut: Ctrl+Shift+F to toggle
}
```

### Pattern 3: Zustand Store per Sidebar Instance

**What:** Each sidebar instance (search, library) gets its own Zustand store with localStorage persistence, following the existing `useFilterSidebarStore` pattern.

**When to use:** When multiple pages have independent sidebar collapse states.

**Approach options (recommend Option A):**

**Option A - Store factory:** Create a `createSidebarStore(persistKey: string)` factory function that returns a typed Zustand store. Each page calls the factory once at module level.

```typescript
// Source: Pattern from lib/store.ts lines 1112-1149
export function createSidebarStore(persistKey: string) {
  return create<FilterSidebarState>()(
    persist(
      (set) => ({
        isCollapsed: false,
        _hasHydrated: false,
        setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
        toggle: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
        setHasHydrated: (state) => set({ _hasHydrated: state }),
      }),
      {
        name: persistKey,
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({ isCollapsed: state.isCollapsed }),
        onRehydrateStorage: () => (state) => {
          state?.setHasHydrated(true);
        },
      }
    )
  );
}

// Usage:
const useSearchSidebarStore = createSidebarStore('openalex-filter-sidebar');
const useLibrarySidebarStore = createSidebarStore('openalex-library-sidebar');
```

**Option B - Pass store as prop:** FilterSidebar accepts a `useStore` hook as a prop. More flexible but more complex API surface.

### Anti-Patterns to Avoid

- **Hardcoding SearchSidebar modes into the generic component:** The existing SearchSidebar has 4 modes (sidebar, sheet, page, panel). The generic FilterSidebar should only implement the "panel" mode. Sheet and page modes are search-specific legacy patterns that Phase 32 will handle.
- **Copying the entire SearchSidebar:** Do NOT fork SearchSidebar. Extract the generic chrome, then refactor SearchSidebar to compose FilterSidebar + SearchFilterContent.
- **Putting page-specific filter logic in shared components:** FilterSidebar must know nothing about individual filters (date, rating, etc.). It only knows about count, clear, collapse.
- **Creating a single global sidebar store:** Search page and library page may have different collapse preferences. Use separate Zustand stores with different persist keys.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sidebar collapse animation | CSS transitions or custom JS | `motion/react` with existing `sidebarSpring` config | Already tuned for the project's physics feel; spring animation handles interrupted transitions |
| Collapse state persistence | useState + localStorage manually | Zustand `persist` middleware | Already proven pattern in `useFilterSidebarStore`; handles SSR hydration edge cases |
| Mobile breakpoint detection | Manual `window.innerWidth` | `useIsMobile()` from `@/lib/hooks` | Already handles SSR (returns `false` initially), consistent 768px breakpoint |
| Tab-based mobile interface | Custom tab implementation | `@radix-ui/react-tabs` via shadcn `Tabs` component | Already used in ResultsPageContent; accessible, keyboard-navigable |
| i18n string management | Inline strings or template literals | `next-intl` with `useTranslations()` | Already standard; ICU MessageFormat for plurals/interpolation |

**Key insight:** Every single piece of technology needed for Phase 31 is already in production use within the project. The work is purely extraction and reorganization, not implementation from scratch.

## Common Pitfalls

### Pitfall 1: SSR Hydration Mismatch with Zustand Persist
**What goes wrong:** Zustand stores using `persist` middleware initialize with default values on the server, then hydrate from localStorage on the client. If the component renders differently based on `isCollapsed`, you get a hydration mismatch flash.
**Why it happens:** Server has no access to localStorage; client-side value may differ from default.
**How to avoid:** The existing `_hasHydrated` flag pattern is already correct. FilterSidebar should not render until `_hasHydrated` is `true`, exactly like the current SearchSidebar does (line 734: `if (!_hasHydrated || isMobileView) return null;`).
**Warning signs:** Layout shift on page load where sidebar briefly shows expanded then collapses (or vice versa).

### Pitfall 2: Mobile Detection Returns `false` on First Render
**What goes wrong:** `useIsMobile()` returns `false` during SSR and on the first client render before the effect fires. SidebarLayout could flash the desktop layout on mobile.
**Why it happens:** `useMediaQuery` uses `useState(false)` as initial state, sets true value in `useEffect`.
**How to avoid:** Accept a brief flash as unavoidable with the current approach (this is the existing behavior across the app). Do not try to "fix" this in Phase 31 -- it would require Next.js middleware or CSS-only approaches that are out of scope.
**Warning signs:** Mobile users seeing a brief flash of desktop layout.

### Pitfall 3: Breaking the Existing SearchSidebar During Extraction
**What goes wrong:** Extracting chrome from SearchSidebar into FilterSidebar could break the search page if not done carefully.
**Why it happens:** SearchSidebar is 944 lines with 4 modes and tight coupling between chrome and content.
**How to avoid:** Phase 31 only CREATES the new shared components (FilterSidebar, SidebarLayout). Phase 32 refactors SearchSidebar to USE them. In Phase 31, the SearchSidebar remains untouched. The new components should be buildable and testable independently.
**Warning signs:** Temptation to "also refactor SearchSidebar while we're at it."

### Pitfall 4: Over-Generalizing the Component API
**What goes wrong:** Making FilterSidebar accept too many configuration props (custom widths, custom animations, custom keyboard shortcuts) before there's a second consumer.
**Why it happens:** Premature abstraction anticipating future needs.
**How to avoid:** Build for exactly two consumers (search page in Phase 32, library page in Phase 33). If the search page needs `320px` width and the library page also needs `320px`, hardcode it. Generalize only when Phase 33 reveals a concrete difference.
**Warning signs:** Props like `expandedWidth`, `collapsedWidth`, `animationConfig` on the first version.

### Pitfall 5: Forgetting i18n in All 6 Locales
**What goes wrong:** Adding keys to `en-US.json` but forgetting the other 5 locale files (en-GB, fr, zh, hi, ja).
**Why it happens:** Easy to add English keys and forget to propagate.
**How to avoid:** Add new keys to ALL 6 message files in the same commit. The project uses 6 locales: en-US, en-GB, zh, fr, hi, ja. Most new keys can reuse existing translations from `common` namespace (e.g., `common.filters`, `common.results`, `common.clear` already exist in all locales).
**Warning signs:** Missing key errors in non-English locales.

## Code Examples

Verified patterns from the existing codebase:

### Existing TwoColumnLayout (to be composed inside SidebarLayout)
```typescript
// Source: components/layout/two-column-layout.tsx
export function TwoColumnLayout({ leftColumn, rightColumn, rightColumnClassName, className }: TwoColumnLayoutProps) {
  return (
    <div className={cn("flex min-h-full", className)}>
      <div className="shrink-0 sticky top-0 h-screen overflow-hidden">
        {leftColumn}
      </div>
      <div className={cn("flex-1 min-w-0 flex flex-col", rightColumnClassName)}>
        {rightColumn}
      </div>
    </div>
  );
}
```

### Existing Mobile Tab Pattern (to be extracted into SidebarLayout)
```typescript
// Source: components/results-page-content.tsx lines 92-181
// Key elements to extract:
// - Tabs/TabsList/TabsTrigger/TabsContent from @radix-ui/react-tabs
// - AnimatePresence with slideVariants for tab transition
// - Icons: FileText for content tab, ListFilter for filters tab
// - Full-height flex layout with tabs at top
```

### Existing Sidebar Panel Chrome (to be extracted into FilterSidebar)
```typescript
// Source: components/search-sidebar.tsx lines 729-921 (mode="panel" branch)
// Key elements to extract:
// - Zustand store (isCollapsed, _hasHydrated, toggle)
// - getFilterSidebarDimensions(isCollapsed) for width calculation
// - motion.aside with sidebarSpring transition
// - Floating controls: badge (gradient oklch), clear button (X icon), toggle button (Filter icon)
// - AnimatePresence for collapsed state controls
// - Glassmorphic background classes: "bg-background/80 dark:bg-background/60 backdrop-blur-xl backdrop-saturate-150 border-l border-border/50"
// - Scrollable content: "flex-1 min-h-0 overflow-y-auto scrollbar-hide"
```

### Existing Zustand Store Pattern with Persist
```typescript
// Source: lib/store.ts lines 1112-1149
const useFilterSidebarStore = create<FilterSidebarState>()(
  persist(
    (set) => ({
      isCollapsed: false,
      _hasHydrated: false,
      setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
      toggle: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'openalex-filter-sidebar',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ isCollapsed: state.isCollapsed }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
```

### Existing FilterSection (already shared, no changes needed)
```typescript
// Source: components/shared/filter-section.tsx
// Already imported by both:
//   - components/search-sidebar.tsx (line 74)
//   - components/library/library-filters.tsx (line 30)
// Props: title, icon, isActive, children, onClear
```

### Existing i18n Keys That Can Be Reused
```json
// Source: messages/en-US.json
// common namespace (already translated in all 6 locales):
"results": "Results",
"filters": "Filters",
"clear": "Clear",
"close": "Close",

// searchFilters namespace (existing, search-specific):
"clearAllCount": "Clear All ({count})",
"expandCollapseFilters": "Expand/Collapse filters (Ctrl+Shift+F)",
"expandFilters": "Expand filters (Ctrl+Shift+F)",
"clearAllFilters": "Clear All Filters"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `framer-motion` package | `motion` package (v12+) | 2024 rename | Project already uses `motion/react` imports throughout |
| Zustand v4 `create()` | Zustand v5 `create()` | 2024 | Project already on v5; no migration needed |
| React.forwardRef | React 19 ref as prop | 2024 | Project on React 19; no forwardRef needed for new components |
| next-intl v3 flat messages | next-intl v4 nested namespaces | 2024 | Project uses v4 with nested namespaces (common, searchFilters, libraryPage, etc.) |

**Deprecated/outdated:**
- `framer-motion` import path: Use `motion/react` instead (project already does this)
- Zustand v4 `StateCreator` type: v5 simplified the type API (project already uses v5 patterns)

## Open Questions

1. **Should FilterSidebar accept the Zustand store as a prop or create its own internally?**
   - What we know: The existing SearchSidebar creates its own store (`useFilterSidebarStore`). The library page will need a separate store instance. Option A (store factory) and Option B (store as prop) both work.
   - What's unclear: Whether the store should be created inside FilterSidebar (more encapsulated) or passed in (more flexible).
   - Recommendation: Use Option A (store factory). Create the store at module level in each page's filter component (SearchFilterSidebar, LibraryFilterSidebar). Pass the store hook to FilterSidebar as a prop. This keeps FilterSidebar truly generic while letting each page own its persistence key.

2. **Should SidebarLayout include the AnimatePresence slide animation for mobile tabs?**
   - What we know: The current ResultsPageContent has custom slide variants with direction-aware animation for tab switching. This adds visual polish but complexity.
   - What's unclear: Whether this animation is worth keeping in the generic component or if plain tab switching is sufficient.
   - Recommendation: Include the animation. It is already proven, small (15 lines of variant config), and provides a premium feel. Use the existing `subtleSpring` from `lib/animation-config.ts`.

3. **What i18n namespace should new keys go in?**
   - What we know: Existing keys are split across `common`, `searchFilters`, and `libraryPage` namespaces. Most needed keys (`results`, `filters`, `clear`) already exist in `common`.
   - What's unclear: Whether to create a new namespace or reuse existing ones.
   - Recommendation: Create a minimal `sidebarLayout` namespace for sidebar-specific keys (e.g., `expandFilters`, `collapseFilters`, `activeFiltersBadge`). Reuse `common.results` and `common.filters` for the mobile tab labels.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** - Direct reading of all relevant source files:
  - `components/search-sidebar.tsx` (944 lines) - Existing sidebar with all modes
  - `components/results-page-content.tsx` (223 lines) - Existing mobile tab pattern
  - `components/layout/two-column-layout.tsx` (32 lines) - Existing desktop layout
  - `components/shared/filter-section.tsx` (88 lines) - Already shared filter chrome
  - `components/library/library-page-client.tsx` (381 lines) - Library page to receive sidebar
  - `components/library/library-filters.tsx` (407 lines) - Library filters using FilterSection
  - `lib/store.ts` (lines 1112-1149) - Zustand sidebar store pattern
  - `lib/ui/sidebar-motion.ts` (13 lines) - Spring animation configs
  - `lib/animation-config.ts` (75 lines) - Shared animation configs
  - `messages/en-US.json` - i18n structure and existing keys
  - `package.json` - All dependencies already present

### Secondary (MEDIUM confidence)
- `motion` v12 API: Import from `motion/react` confirmed by all project imports
- Zustand v5 persist middleware: Pattern confirmed by existing stores in `lib/store.ts`
- next-intl v4 `useTranslations`: Pattern confirmed by all component imports

### Tertiary (LOW confidence)
- None. All findings are from direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Every library is already installed and in production use
- Architecture: HIGH - Every pattern is already implemented in the codebase; this is pure extraction
- Pitfalls: HIGH - All pitfalls are based on patterns observed in the existing code and known React/Zustand behaviors

**Research date:** 2026-03-01
**Valid until:** 2026-03-31 (stable; no external dependencies to go stale)
