# Research Summary: Library UI Overhaul (v2.2)

**Domain:** Academic search app — library page UI redesign to match search page patterns
**Researched:** 2026-03-01
**Overall Confidence:** HIGH

## Executive Summary

The library UI overhaul is a **layout consolidation project**, not a technology migration. The goal is to adopt the search page's proven two-column layout (sidebar + results) with matching mobile responsiveness (tab-based filter view).

**The entire overhaul can be accomplished with existing dependencies.** No new npm packages required. The project already has all necessary primitives:
- **Motion v12.23** for animations (layout props, spring configs already tuned)
- **Tailwind CSS v4** for responsive design (container queries, utilities)
- **shadcn/ui** components (Tabs, Collapsible, ScrollArea, Dialog — all installed)
- **nuqs** for URL state (filters/sort/search are already bookmarkable)
- **Zustand** for UI state (expanded items, sidebar collapse state)

The research identifies three strategic decisions:

1. **Copy the search page pattern verbatim** — Two-column layout (TwoColumnLayout component), FilterSection components, tab-based mobile view
2. **No new animation libraries needed** — Motion v12 with existing spring configs handles collapsible panels and transitions
3. **Reuse i18n & accessibility infrastructure** — next-intl (6 locales) + Radix primitives already support this

## Key Findings

### Stack
- **No dependencies to add** — All required technologies are installed and version-current (as of 2026-03-01)
- **Tailwind v4 is sufficient** — Container queries, custom properties, responsive utilities cover all mobile/tablet/desktop scenarios
- **Animation config is proven** — Existing spring configs in `/lib/animation-config.ts` (subtleSpring, commandCenterSpring) tested in search page
- **Component library is complete** — shadcn/ui blocks (sidebar, collapsible, tabs) all available via CLI; no breaking changes on Feb 2026 update

### Architecture
- **Two-column layout exists** — `/components/layout/two-column-layout.tsx` (flex, sticky left, scrollable right)
- **Filter sections are shared** — `/components/shared/filter-section.tsx` already used by both search and library
- **Mobile pattern is battle-tested** — Search page's Tabs + AnimatePresence (results/filters toggle) proven on mobile
- **State management is clean** — nuqs for URL params, Zustand for UI-only state (no duplication)

### Features
- **Table stakes:** Two-column layout, responsive filters, sort/pagination controls, collection picker
- **Differentiators:** Smooth animations on tab switch, sticky filter sidebar, dark mode support (CSS variables ready)
- **Anti-features:** Avoid drag-to-resize sidebar, avoid nested/hierarchical collections, avoid custom sidebar libraries

### Pitfalls
1. **Mobile layout shift** — Use CSS media queries, not JS-based responsiveness. AnimatePresence `mode="popLayout"` prevents jank.
2. **Filter sidebar getting too tall** — ScrollArea component solves this; existing sidebar has `overflow-hidden` with scroll inside.
3. **Animation performance** — Use Motion's `layout` prop (GPU-accelerated), never direct height animation. Spring configs already optimized.
4. **URL state sync lag** — nuqs is designed for this; no debouncing needed if using `setParams` correctly.
5. **Dark mode cascading** — All CSS variables already defined in globals.css. Just apply tailwind dark: classes, they'll work.

## Implications for Roadmap

### Recommended Phase Structure

**Phase 1: Layout Migration (1-2 days)**
- Wrap library page in TwoColumnLayout
- Move existing filter bar to left column
- Test desktop layout (sticky sidebar, scrollable results)
- Acceptance: Desktop view renders correctly, sidebar stays sticky on scroll

**Phase 2: Mobile Responsiveness (2-3 days)**
- Add isMobile check, wrap in Tabs component (results/filters)
- Copy tab toggle logic from search page (activeTab state)
- Add AnimatePresence with direction-aware slide animation
- Test on mobile viewport, ensure smooth tab switch
- Acceptance: Mobile view shows tabs, animation is 60fps, no layout shift

**Phase 3: Animation Polish (1-2 days)**
- Add collapsible filter groups (optional, using Radix Collapsible)
- Refine scrollbar styling (apply sidebar-scrollbar utility)
- Test dark mode (CSS variables + tailwind dark: prefix)
- Acceptance: Animations are snappy, scrollbars match search page, dark mode looks good

**Phase 4: i18n & Accessibility (1 day)**
- Translate filter labels (use existing translation keys from search page)
- Run a11y audit (Tab order, ARIA labels, screen reader testing)
- Test keyboard navigation (all buttons accessible, no missing focus states)
- Acceptance: 6 locales render correctly, accessibility report passes, keyboard nav works

**Phase 5: E2E Tests (1 day)**
- Add Playwright tests for mobile tab toggle, desktop sticky sidebar
- Add dark mode snapshot test
- Acceptance: CI passes, no regressions in existing tests

**Total Estimated Effort:** 6-9 days (if parallel work available: 4-6 days)

### Why This Order

1. **Layout first** — Everything else depends on correct two-column structure
2. **Mobile before animations** — Responsiveness is functional, animations are polish
3. **i18n last** — Only needed once layout is stable (translation keys already exist)
4. **Tests after implementation** — Unit tests for state, E2E for interaction patterns

### Research Flags for Phases

| Phase | Likely Needs Research? | Why |
|-------|------------------------|-----|
| Phase 1 (Layout) | NO | Pattern copied from search page; no new technology |
| Phase 2 (Mobile) | NO | Tab logic + AnimatePresence already in search page; just copy |
| Phase 3 (Animation) | NO | Spring configs proven; Motion v12 is stable |
| Phase 4 (i18n) | NO | next-intl usage identical to search page |
| Phase 5 (E2E) | MAYBE | Playwright setup identical; only if custom snapshots needed |

**Conclusion:** This milestone requires **zero deep research** during implementation. All decisions are proven patterns, existing libraries, known configs.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack (no new dependencies needed) | HIGH | Verified all required libraries installed, current versions as of 2026-03-01 |
| Layout pattern (TwoColumnLayout exists) | HIGH | Component exists in codebase, used by search page, battle-tested |
| Animation capability (Motion v12) | HIGH | Layout animations, spring configs documented, used in search page |
| Mobile responsiveness (Tabs + AnimatePresence) | HIGH | Exact pattern exists in search page; just copy code |
| i18n & accessibility (next-intl + Radix) | HIGH | Same libraries, same patterns as search page |
| Performance (no jank, 60fps) | HIGH | Motion + Tailwind proven in search page; no new technology risk |

**Overall:** This is a low-risk, high-confidence implementation. It's pattern consolidation, not innovation.

## Gaps to Address (During Implementation)

- **Sidebar width constants** — Decide on fixed width (e.g., 280px desktop, 100% mobile) or use CSS variables
- **Filter group collapse state** — Decide if filter groups should be collapsible by default (affects UX on mobile)
- **Pagination component** — Library page uses Convex pagination; decide if "Load More" button or infinite scroll (copy search pattern)
- **Empty state messaging** — Library page has LibraryEmptyState component; ensure it matches search page empty states
- **Sort options consistency** — Verify library sort options (date saved, alphabetical, rating) map to search page's sort options

**Action:** These are implementation details, not blockers. All have working examples in search page code.

## Roadmap Impact

This research validates the Phase structure in PROJECT.md:

**Validated Goals:**
- ✓ Two-column layout with collapsible filter sidebar (TwoColumnLayout + FilterSection exist)
- ✓ Reuse SearchSidebar / FilterSection components (FilterSection already shared)
- ✓ Mobile responsive with tab-based filters (Tabs + AnimatePresence pattern exists)
- ✓ Unified design language (Tailwind + Motion + shadcn/ui already unified)
- ✓ Command center toolbar pattern (CommandCenter components exist for library actions)

**No Surprises:** All features are achievable with existing tech stack. No architectural changes needed.

**Estimated Timeline:** 1 milestone (v2.2), 6-9 days of development, split into 5 phases

---

## Sources

Research conducted via:
1. **WebSearch** — Tailwind v4 best practices, shadcn/ui latest updates, Motion layout animations (Feb 2026 ecosystem)
2. **Context7 / Official docs** — Motion v12 API, Radix UI primitives, shadcn/ui changelog
3. **Codebase analysis** — Existing components (search-sidebar, filter-section, two-column-layout, animation-config)
4. **Package.json verification** — All required libraries present, versions current

**Key References:**
- [Tailwind CSS v4 Complete Guide](https://devtoolbox.dedyn.io/blog/tailwind-css-v4-complete-guide)
- [shadcn/ui Sidebar Documentation](https://ui.shadcn.com/docs/components/radix/sidebar)
- [shadcn/ui Changelog (Feb 2026)](https://ui.shadcn.com/docs/changelog)
- [Motion Layout Animations](https://www.framer.com/motion/layout-animations/)
- [Codebase: /components/results-page-content.tsx (mobile tab pattern)](../../../components/results-page-content.tsx)
- [Codebase: /components/search-sidebar.tsx (animation examples)](../../../components/search-sidebar.tsx)
- [Codebase: /components/shared/filter-section.tsx (reusable component)](../../../components/shared/filter-section.tsx)

---

**Last Updated:** 2026-03-01
**Status:** Ready for roadmap. No blockers, no new dependencies, low implementation risk.
