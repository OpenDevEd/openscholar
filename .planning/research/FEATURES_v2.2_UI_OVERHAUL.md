# Feature Landscape — Library UI Overhaul (v2.2)

**Domain:** Academic search app — library page UI redesign
**Researched:** 2026-03-01
**Context:** Migrate library page from current single-column layout to two-column layout matching search page patterns

## Table Stakes

Features users expect from a modern library interface. Missing = feels unpolished.

| Feature | Why Expected | Complexity | Notes | Status |
|---------|--------------|------------|-------|--------|
| Two-column layout (desktop) | Standard for filter + results UI; every modern search app does this | Low | Copy TwoColumnLayout from search page | ✓ EXISTS |
| Sticky filter sidebar | Filters should stay visible while scrolling results | Low | CSS `sticky top-0` + Tailwind, already in search page | ✓ EXISTS |
| Mobile responsive filters | Can't show full sidebar on mobile; need tabs or drawer | Medium | Tab-based view (results/filters toggle) proven in search page | ✓ EXISTS |
| Smooth animations | Tab switch, filter section collapse, clear button fade-in | Low | Motion v12 spring configs already tuned | ✓ IMPLEMENTED |
| Dark mode support | Users toggle dark mode; must look good in both | Low | CSS variables defined, tailwind `dark:` prefix ready | ✓ EXISTS |
| Pagination or infinite scroll | Library can grow large; need way to load more items | Low | Convex pagination already in LibraryPageClient | ✓ EXISTS |
| Filter visibility | Show which filters are active (badge, highlight, clear button) | Low | FilterSection component shows active state with gradient bar | ✓ EXISTS |
| i18n support | All text in user's language (6 locales) | Low | next-intl already wired; just use translation keys | ✓ EXISTS |
| Accessible (a11y) | Keyboard navigation, ARIA labels, screen reader support | Low | Radix primitives ship with a11y; no manual work needed | ✓ EXISTS |

## Differentiators

Features that set this product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes | Status |
|---------|-------------------|------------|-------|--------|
| Direction-aware tab animation | Tab switch direction (left/right) based on which tab you're switching to — feels intelligent | Low | AnimatePresence with custom direction variable; search page example exists | ✓ REUSABLE |
| Collapsible filter groups | Organize filters into expandable sections (Date, Rating, Collections) to reduce visual clutter | Medium | Radix Collapsible + Motion layout prop; optional enhancement | OPTIONAL |
| Filter preset quick-access | "Saved recently", "High-rated", "This month" buttons to apply common filter combos | Medium | Buttons that set multiple params via nuqs; nice-to-have | DEFER |
| Library stats dashboard | Show count of items, avg rating, last saved date at top of sidebar | Low | Already have data; just display it. Polish feature | OPTIONAL |
| Smart filter suggestions | "You haven't filtered by rating" hints when browsing all items | Medium | Requires analytics; nice-to-have | DEFER |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Drag-to-resize sidebar | Complex, rarely used. Users don't want to fuss with sidebar width. | Fixed width (280px desktop) or use CSS variables if users request it later |
| Nested/hierarchical collections | "Work" > "Projects" > "Q1-2026" structure confuses UX. Flat collections sufficient. | Keep collections flat; if needed, implement tags (separate from collections) in v3+ |
| Sidebar collapse animation on desktop | Collapsing sidebar in search results view is disorienting. Keep it visible. | Only collapse on mobile (< lg breakpoint) via tab switch |
| Custom sidebar library (3rd-party) | Unnecessary complexity. shadcn/ui blocks handle all cases. | Use TwoColumnLayout + FilterSection (existing components) |
| Infinite scroll in library (JS-only) | Can cause performance issues with large libraries. Pagination is simpler. | Keep Convex pagination ("Load More" button or infinite scroll with cursor) |
| PDF preview in sidebar | PDF is a separate concern; users have Zotero for this. | Don't add; stay focused on library UX |

## Feature Dependencies

```
Two-column layout
├── Filter sidebar (left column)
│   ├── FilterSection component (reusable across all filters)
│   ├── Search input (nuqs sync)
│   ├── Date saved filter (uses existing DateRangePicker)
│   ├── Year range filter (uses existing YearRangePicker)
│   ├── Rating filter (uses existing RatingRangePicker)
│   ├── Collection picker (uses existing CollectionManager)
│   └── Clear all button
│
└── Results view (right column)
    ├── Toolbar (sort, view mode, export)
    ├── Item list/grid (LibraryItemRow / LibraryItemCard)
    ├── Pagination (Convex cursor-based)
    └── Empty state (LibraryEmptyState)

Mobile responsiveness
├── useIsMobile() hook check
├── Tabs component (results/filters toggle)
└── AnimatePresence with direction-aware slide

Animation/Polish
├── Motion spring configs (existing)
├── Collapsible filter groups (optional, Radix + Motion)
└── Dark mode (CSS variables + tailwind dark:)

i18n & Accessibility
├── next-intl translations (existing keys)
├── Radix primitive a11y (built-in)
└── Keyboard navigation (tested in search page)
```

## MVP Recommendation

**Prioritize in order:**

1. **Two-column layout (Phase 1)** — Table stakes. Required for "overhaul" claim.
   - TwoColumnLayout component
   - Move library filters to left column
   - Test desktop rendering, scrolling, sidebar sticky

2. **Mobile responsiveness (Phase 2)** — Table stakes. Can't launch without mobile UX.
   - useIsMobile() check
   - Tabs + AnimatePresence pattern
   - Direction-aware slide animation

3. **Animation polish (Phase 3)** — Table stakes. Motion is already integrated.
   - Clear button fade-in (FilterSection component)
   - Sidebar collapse on mobile (natural from Tabs)
   - Collapsible filter groups (optional; test user feedback first)

4. **i18n & a11y (Phase 4)** — Table stakes. Already wired.
   - Verify translation keys work
   - Run a11y audit

5. **E2E tests (Phase 5)** — Validation, not feature.
   - Mobile tab toggle
   - Dark mode rendering
   - Filter state sync

**Defer:**
- Filter presets (nice-to-have for power users)
- Library stats dashboard (polish feature)
- Collapsible filter groups (optional; depends on filter count feedback)
- Smart filter hints (requires analytics integration)

## Feature Priority Matrix

```
         ┌─────────────────────────────────────┐
         │     HIGH IMPACT, LOW EFFORT        │
         │                                     │
    H    │ • Two-column layout (table stakes) │
    I    │ • Mobile responsive (table stakes) │
    G    │ • Direction-aware animation       │
    H    │ • Dark mode (CSS vars ready)      │
         │                                     │
         ├─────────────────────────────────────┤
         │  HIGH IMPACT, MEDIUM EFFORT        │
         │                                     │
    I    │ • Collapsible filter groups        │
    M    │ • Filter preset quick-access       │
    P    │ • Stats dashboard                  │
    A    │                                     │
    C    ├─────────────────────────────────────┤
    T    │  LOW IMPACT, LOW EFFORT            │
         │                                     │
         │ • Scrollbar styling (utility)      │
         │ • Refined tooltips                 │
         │                                     │
         ├─────────────────────────────────────┤
         │  LOW IMPACT, MEDIUM+ EFFORT        │
         │                                     │
    L    │ • Smart filter suggestions         │
    O    │ • Custom sidebar library (3rd-prt) │
    W    │ • Drag-to-resize sidebar           │
    |    │ • Nested collections               │
    E    │ • PDF preview in sidebar           │
    F    │                                     │
    F    └─────────────────────────────────────┘
    O       LOW            EFFORT            HIGH
    R
    T
```

## Feature Rollout Plan

**MVP (v2.2.0):** Phases 1-5 (all table stakes)
- Two-column layout
- Mobile tabs
- Animation (built-in to existing components)
- i18n + a11y
- E2E tests

**v2.3 (future):** Optional enhancements based on user feedback
- Collapsible filter groups (if filters feel cluttered)
- Filter presets (if power users request)
- Stats dashboard (if library feature is popular)

**v3+ (much later):** Considered, not blocking
- Tags (separate from collections)
- Collaborative libraries (permission model)
- Smart suggestions (requires analytics)

## Sources

Research based on:
1. **Codebase analysis** — SearchSidebar, FilterSection, TwoColumnLayout, LibraryPageClient components
2. **Feature parity** — What search page has that library page needs
3. **USER expectations** — Standard patterns in modern search apps (Google Scholar, SSRN, ResearchGate)
4. **OUT OF SCOPE** — Aligned with PROJECT.md constraints (no PDF storage, no collaborative libraries, no smart collections)

---

**Last Updated:** 2026-03-01
**Status:** Feature set is clear, ordered, and achievable with existing stack.
