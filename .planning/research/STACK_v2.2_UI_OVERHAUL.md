# Technology Stack — Library UI Overhaul (v2.2)

**Project:** OpenAlex Count — Library Page UI Redesign
**Researched:** 2026-03-01
**Focus:** Stack additions/optimizations for two-column sidebar layout, responsive design, and filter UX
**Confidence:** HIGH

## Executive Summary

The library UI overhaul can be completed using the **existing validated stack** with **no major new dependencies required**. The project already has:
- **Tailwind CSS v4** with `@tailwindcss/postcss` (latest architecture)
- **Motion (formerly Framer Motion) v12.23** for performant animations
- **shadcn/ui** components with built-in responsiveness
- **nuqs** for URL state persistence
- **Zustand** for client state management
- **next-intl** for i18n (already supporting 6 locales)

The search page demonstrates the exact layout pattern needed (two-column layout with collapsible filters, tab-based mobile view), and all required component primitives are already in place. The research recommends **consolidating existing patterns** rather than adding new libraries.

## Key Findings

1. **No critical gaps** — The existing animation, layout, and component infrastructure is sufficient
2. **Reuse > add** — Apply the proven search page pattern to the library page; extract FilterSection component (already exists)
3. **Animation ready** — Motion v12 supports layout animations and collapsible panels with `layoutId` and `layout` props
4. **Responsive solid** — Tailwind v4 container queries eliminate the need for viewport-only breakpoints
5. **Mobile UX proven** — Search page's tab-based filter view (results/filters) is battle-tested on mobile

## Recommended Stack

### Core Framework (No Changes)
| Technology | Current Version | Purpose | Status |
|------------|-----------------|---------|--------|
| Next.js | 16.1.6 | App Router, SSR, optimized production builds | ✓ VALIDATED |
| React | 19.2.4 | Component library, server components | ✓ VALIDATED |
| TypeScript | 5.x | Type safety, refactoring confidence | ✓ VALIDATED |

### Styling & Layout (No Changes)
| Technology | Current Version | Purpose | Status |
|------------|-----------------|---------|--------|
| Tailwind CSS | v4 (via `@tailwindcss/postcss` v4) | Utility-first CSS, responsive design | ✓ VALIDATED |
| `tailwind-merge` | 3.4.1 | Merge conflicting Tailwind classes | ✓ VALIDATED |

**Why Tailwind v4:** Latest CSS engine (Lightning CSS) for 5-100x faster builds, built-in container queries (`@container`), native CSS variable support in `@theme`, and no PostCSS config needed beyond the plugin.

### Component Primitives (No Changes)
| Library | Current Version | Purpose | Status |
|---------|-----------------|---------|--------|
| shadcn/ui | via shadcn CLI | Pre-built Radix UI + Tailwind components | ✓ VALIDATED |
| Radix UI (base) | varies by component | Accessible primitives (Dialog, Collapsible, Tabs, etc.) | ✓ VALIDATED |
| `class-variance-authority` | 0.7.1 | Component variant management | ✓ VALIDATED |

**Key components available:**
- `Sidebar` (SidebarProvider, Sidebar, SidebarContent, SidebarTrigger) — via shadcn/ui blocks (Feb 2026 update includes both Radix and Base UI variants)
- `Collapsible` — Radix-backed, used for expandable filter sections
- `Tabs` — Radix-backed, used for mobile filter/results toggle
- `Dialog` / `Sheet` — For modal and drawer interactions
- `ScrollArea` — Smooth scrolling with custom scrollbar styling

**Why shadcn/ui:** Latest blocks (sidebar, application shells) added Feb 2026 with RTL support. No version bump needed; copy components into codebase. Use existing Radix UI dependencies already installed.

### Animation & Motion (No Changes)
| Library | Current Version | Purpose | Status |
|---------|-----------------|---------|--------|
| Motion | 12.23.12 | Framer Motion replacement, layout animations | ✓ VALIDATED |
| Tailwind `tw-animate-css` | 1.4.0 | CSS animation utilities (complementary) | ✓ VALIDATED |

**Why Motion v12:**
- Layout animations with `layout` prop for automatic height/position transitions
- Shared element animations via `layoutId`
- `layoutScroll` for scrollable containers
- 30.6K GitHub stars, 8.1M weekly NPM downloads
- `collapsible` pattern: measure actual height, animate to specific value
- Spring configs already defined in `/lib/animation-config.ts` and `/lib/ui/sidebar-motion.ts`

**Existing animation config (proven):**
```typescript
subtleSpring: {stiffness: 350, damping: 30, mass: 0.8}  // Cards, panels
commandCenterSpring: {stiffness: 400, damping: 35, mass: 0.9}  // Modals
```

### State Management (No Changes)
| Library | Current Version | Purpose | Status |
|---------|-----------------|---------|--------|
| nuqs | 2.6.0 | URL state synchronization (filters, sort, search) | ✓ VALIDATED |
| Zustand | 5.0.5 | Client-side UI state (expanded items, modal state) | ✓ VALIDATED |
| Convex (backend) | 1.31.7 | Database queries, mutations, real-time sync | ✓ VALIDATED |

**Why this combo:**
- `nuqs` → Bookmarkable filtered views, framework-native, no client-side state duplication
- `Zustand` → Lightweight UI state (sidebar collapsed, filter expanded), zero boilerplate
- See library-page-client.tsx: `const [params, setParams] = useQueryStates(librarySearchParams)` + local UI state for expanded items

### Internationalization (No Changes)
| Library | Current Version | Purpose | Status |
|---------|-----------------|---------|--------|
| `next-intl` | 4.8.2 | Multi-language support (6 locales) | ✓ VALIDATED |

**Scope:** Search page already uses `useTranslations("common")` for filter labels. Library page will reuse same translation keys. No new i18n setup needed.

### Accessibility & Icons (No Changes)
| Library | Current Version | Purpose | Status |
|---------|-----------------|---------|--------|
| `lucide-react` | 0.487.0 | Accessible icon set | ✓ VALIDATED |

## Integration Points

### 1. Sidebar Layout Pattern
**Source:** Search page (`results-page-content.tsx` uses `TwoColumnLayout`)

```typescript
// Use existing TwoColumnLayout component
<TwoColumnLayout
  leftColumn={<FilterSidebar />}
  rightColumn={<LibraryContent />}
/>
```

**Responsive behavior:**
- Desktop (lg+): Two-column flex, sidebar sticky top-0, left shrink-0
- Mobile: Tabs with AnimatePresence (direction-aware slide animation)

**No new component needed** — Already implemented at `/components/layout/two-column-layout.tsx`

### 2. Collapsible Filter Sections
**Source:** `FilterSection` component (already shared between search and library)

```typescript
// Existing FilterSection component reused
<FilterSection
  title="Year Range"
  icon={Calendar}
  isActive={isYearFilterActive}
  onClear={() => clearFilter('year')}
>
  {/* Child content: sliders, date pickers, etc. */}
</FilterSection>
```

**Animation:** Framer Motion `initial={false}`, left gradient bar scales on active state, clear button fades in.

### 3. Mobile Tab-Based Filter View
**Pattern:** Search page's `activeTab` state with Tabs + AnimatePresence

```typescript
// Mobile-only (isMobile check)
<Tabs value={activeTab} onValueChange={setActiveTab}>
  <TabsList>
    <TabsTrigger value="results">Results</TabsTrigger>
    <TabsTrigger value="filters">Filters</TabsTrigger>
  </TabsList>
  <TabsContent>
    <AnimatePresence mode="popLayout" custom={direction}>
      {/* Slide animation between tabs */}
    </AnimatePresence>
  </TabsContent>
</Tabs>
```

**Direction-aware animation:** Results → Filters = slide right (1), Filters → Results = slide left (-1). See `slideVariants` in results-page-content.tsx.

### 4. Responsive Utilities (CSS)
**Existing custom utilities in globals.css:**
- `glass-sidebar` — Backdrop blur + saturation for sidebar (light/dark variants)
- `scrollbar-hover` — Hidden by default, visible on hover
- `sidebar-scrollbar` — Thin custom scrollbar with primary color

**Why no additional plugins needed:**
- Tailwind v4's `@container` replaces third-party container query plugins
- Built-in responsive variants (`sm:`, `md:`, `lg:`, `xl:`)
- CSS variables (`--sidebar-width`, `--sidebar-width-mobile`) can be toggled via JavaScript

## NOT Recommended (Why Not)

| Technology | Reason |
|------------|--------|
| `@headlessui/react` | Redundant; Radix UI is already the primitives layer. shadcn/ui wraps Radix. |
| `react-resizable-panels` | Over-engineered for this use case; CSS Grid/Flexbox + Zustand sufficient. Only add if drag-to-resize becomes a requirement. |
| `dnd-kit` | Not needed; library filters are static, no drag-and-drop required. |
| `react-spring` | Framer Motion (Motion) is more performant and feature-complete. |
| Custom sidebar library (e.g., `salimi-my/shadcn-ui-sidebar`) | Overkill; shadcn/ui blocks already provide sidebar. Extract when needed. |
| `clsx` vs `tailwind-merge` | Already using `cn()` utility which wraps tailwind-merge. No additional class merging lib needed. |

## Implementation Strategy

### Phase 1: Layout Foundation
1. **Reuse TwoColumnLayout** — No changes needed
2. **Copy library filters to sidebar** — Use FilterSection component (already shared)
3. **Test desktop view** — Two-column layout with sticky sidebar

### Phase 2: Mobile Responsiveness
1. **Wrap library page in Tabs** (mobile only, via `useIsMobile()`)
2. **Copy tab navigation from search page** (results/filters toggle)
3. **Copy AnimatePresence slide animation** — Direction-aware, subtleSpring config

### Phase 3: Polish & Animation
1. **Add collapsible filter groups** (optional) — Radix Collapsible + Motion layout animations
2. **Refine scrollbar styling** — Apply `sidebar-scrollbar` utility class
3. **Test dark mode** — CSS variables already support light/dark

### Phase 4: i18n & Accessibility
1. **Translate filter labels** — Use `useTranslations("libraryFilters")` (existing key namespace)
2. **Verify Radix accessibility** — All primitives ship with ARIA attributes
3. **Test keyboard navigation** — Tabs, buttons, form controls

## Versions & Compatibility

| Dependency | Current Version | Min Required | Locked? | Why |
|------------|-----------------|--------------|---------|-----|
| Next.js | 16.1.6 | 14.0+ | Yes | App Router essential; no downgrade |
| React | 19.2.4 | 18.2+ | Yes | Hooks, Server Components required |
| Motion | 12.23.12 | 12.0+ | No | Minor updates safe |
| Tailwind CSS | v4 | v4 | Yes | Lightning CSS engine essential |
| shadcn/ui | via shadcn CLI | — | No | Copy components, no package dep |
| Convex | 1.31.7 | 1.30+ | No | Minor updates safe |
| nuqs | 2.6.0 | 2.0+ | No | Minor updates safe |

**Action:** No version updates recommended. Existing versions are current (as of 2026-03-01).

## Dependencies Summary

### What's Already Installed (use as-is)
```json
{
  "@radix-ui/react-collapsible": "^1.1.12",
  "@radix-ui/react-dialog": "^1.1.15",
  "@radix-ui/react-tabs": "^1.1.12",
  "@radix-ui/react-scroll-area": "^1.2.9",
  "motion": "^12.23.12",
  "tailwind-merge": "^3.4.1",
  "nuqs": "^2.6.0",
  "zustand": "^5.0.5",
  "next-intl": "^4.8.2"
}
```

### What NOT to Install
- Don't add `framer-motion` (already using Motion which is the replacement)
- Don't add layout/animation plugins (Motion + Tailwind v4 handle all cases)
- Don't add custom sidebar libraries (shadcn/ui blocks available via CLI)

## Performance Considerations

### Animation Performance
- **Motion layout prop** — Uses `transform` + `opacity` (GPU-accelerated), never layout thrashing
- **Spring configs** — Tuned for snappiness without jank (stiffness 300-400, damping 25-35)
- **AnimatePresence** — `mode="popLayout"` prevents layout shift during tab transitions

### Bundle Impact
- **Motion** — Already imported (no change)
- **Tailwind v4** — Smaller CSS output than v3 (better compression)
- **shadcn/ui** — Copy-paste components into codebase (tree-shakeable)

### Responsive without JS
- **CSS media queries** — Tailwind breakpoints (no layout shift on hydration)
- **CSS Grid/Flexbox** — Mobile-first with `md:`, `lg:` overrides
- **Tab state management** — Zustand (minimal, synchronous updates)

## Architecture Diagram

```
LibraryPageClient (Client Component)
├── useQueryStates(librarySearchParams) ← nuqs for URL state
├── useState(expandedItemId) ← Zustand for UI local state
├── useIsMobile() ← Media query hook
│
├─── Desktop (lg+): TwoColumnLayout
│    ├── Left: LibraryFilterSidebar
│    │   ├── FilterSection (search field)
│    │   ├── FilterSection (date saved)
│    │   ├── FilterSection (year range)
│    │   ├── FilterSection (rating)
│    │   ├── FilterSection (collection picker)
│    │   └── Motion animations (spring configs)
│    │
│    └── Right: LibraryResults
│        ├── Sort toolbar
│        └── Item grid/list with pagination
│
└─── Mobile (< lg): Tabs (results/filters)
     ├── TabsList (results/filters toggle)
     ├── AnimatePresence + direction-aware slide
     ├── Results tab → LibraryResults
     └── Filters tab → LibraryFilterSidebar (full screen)
```

## Testing Strategy

### Unit Tests (Vitest)
- FilterSection component renders correctly with icon, title, clear button
- nuqs params sync correctly when filters change
- Zustand state updates for expanded items

### E2E Tests (Playwright)
- Mobile: Tab toggle switches between results/filters with animation
- Desktop: Sidebar sticky, resize doesn't scroll content
- Dark mode: CSS variables apply correctly
- i18n: Filter labels display in correct locale

### Manual Testing Checklist
- [ ] Desktop: Two-column layout, sidebar sticky on scroll
- [ ] Tablet: Sidebar collapses to drawer/sheet
- [ ] Mobile: Tab-based view, smooth slide animation
- [ ] Dark mode: Colors, shadows, scrollbar styling correct
- [ ] Accessibility: Tab order, keyboard navigation, screen readers
- [ ] Performance: No jank on filter toggle, animation smooth 60fps
- [ ] i18n: All filter labels translated (6 locales)

## Sources

- [Tailwind CSS v4 Guide](https://devtoolbox.dedyn.io/blog/tailwind-css-v4-complete-guide)
- [shadcn/ui Sidebar Blocks](https://ui.shadcn.com/docs/components/radix/sidebar)
- [shadcn/ui Feb 2026 Update](https://ui.shadcn.com/docs/changelog)
- [Motion Layout Animations](https://www.framer.com/motion/layout-animations/)
- [Motion Advanced Patterns](https://blog.maximeheckel.com/posts/advanced-animation-patterns-with-framer-motion/)
- [Next.js 14+ App Router](https://nextjs.org/docs/pages/building-your-application/routing/pages-and-layouts)
- [Radix UI Tabs](https://www.radix-ui.com/docs/primitives/components/tabs)
- [Radix UI Collapsible](https://www.radix-ui.com/docs/primitives/components/collapsible)

---

**Last Updated:** 2026-03-01
**Status:** Ready for implementation. No blocker dependencies. Use existing patterns from search page.
