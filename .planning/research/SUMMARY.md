# Project Research Summary

**Project:** OpenAlex Count — v2.2 Library UI Overhaul
**Domain:** Academic paper library management with sidebar filtering, collections, and mobile-responsive layout
**Researched:** 2026-03-01
**Confidence:** HIGH

## Executive Summary

The v2.2 milestone is a UI overhaul of the existing `/library` page to match the search page's two-column sidebar layout pattern. The existing Convex backend (schema, queries, mutations) built in v2.1 is complete and solid — library items, collections, junction tables, dual-path queries, and auth-gated pagination hooks are all in place. The v2.2 work is almost entirely a frontend refactoring job: extract the search page's sidebar and responsive layout into generalized primitives (`SidebarLayout`, `FilterSidebar`), then apply them to the library page with library-specific filter panels. Zero new npm packages are required.

The recommended approach follows a clear dependency chain: build generalized layout infrastructure first, prove the pattern on the existing search page by migrating its monolithic 944-line `SearchSidebar` to use the new primitives, then apply those proven components to the library page. Academic paper management tools (Zotero 7, Mendeley 2025, Semantic Scholar) converge on a consistent pattern — left sidebar for filters, center content, mobile tab-based interface — that users now expect as table stakes. The library page must match this baseline or feel incomplete relative to the search page.

The two key risks are: (1) state management confusion between the search page's `SearchProvider` context and the library page's `nuqs` URL params — these patterns must never bleed into each other, and filter components must be designed with callbacks rather than context reads; and (2) i18n hardcoded strings in new shared components — the app has 6 locales and any English literal in a shared component creates translation debt that is expensive to fix after release. Both risks are well-understood and have concrete prevention strategies.

---

## Key Findings

### Recommended Stack

No new dependencies are required for v2.2. All required capabilities are available in the current stack: Next.js 16.1.6, Convex 1.32.0, convex-helpers 0.1.112, nuqs 2.8.8, Zustand 5.0.5, Framer Motion, shadcn/Radix UI.

**Core technologies:**
- **Convex** (1.32.0): Backend data — library items, collections, junction table, full-text search index, compound indexes, cursor-based pagination. All built in v2.1. Dual-path queries already implemented: `withSearchIndex` for text search (relevance-ordered), `withIndex` for sort/filter-based browsing (custom order). `useProtectedPaginatedQuery` auth-gated wrapper already exists.
- **convex-helpers** (0.1.112): `getManyVia` for junction table traversal (items → collections and vice versa). Installed but not yet imported — ready to use.
- **nuqs** (2.8.8): URL-driven filter and sort state on `/library`. `NuqsAdapter` already in root layout. Extend `librarySearchParams` with `parseAsString`, `parseAsStringLiteral` for new filter params. The URL is the source of truth for library page state (bookmarkable, survives reload).
- **Framer Motion**: Sidebar collapse animations, mobile tab slide transitions. Already in use via `lib/ui/sidebar-motion.ts` — reuse existing animation variants.
- **shadcn/Radix**: Tabs, Select, Input, Button, Sheet, Tooltip all available. No new component installations needed.

**Critical Convex constraint to respect:** Search index queries always return results in relevance order — no custom sort after `withSearchIndex`. Library page requires a two-code-path strategy client-side: use search path when user types a query, switch to index path when browsing with a sort preference. The UI must not expose sort options that conflict with the active query path.

### Expected Features

Academic paper management tools converge on a pattern users now expect as baseline. Missing these features makes the product feel incomplete; including anti-features creates UX problems that compound over time.

**Must have (table stakes) for v2.2:**
- Two-column layout (sidebar + content) — matches search page and all major academic tools; non-negotiable for product consistency
- Collapsible filter sidebar on desktop — Zotero 7, Mendeley, Semantic Scholar all use this; reuse existing `TwoColumnLayout` and `SearchSidebar` chrome
- Mobile-responsive tabs for filters — sidebar collapses to tab-based interface on small screens; reuse search page pattern exactly
- Filter state persistence via URL (nuqs) — bookmarkable, survives refresh, shareable links
- Full-text search within saved papers — all academic tools provide this; Convex `searchIndex` on `searchableText` field is already built
- Collections filter — junction table and CRUD already exist from v2.1; expose as sidebar filter
- Sort options (date saved desc, year desc, rating desc, title asc) — standard expectation
- Pagination with result counts — "1-50 of 342 papers" with prev/next; users need total count
- Rating display on each library item — data already saved from v2.1; surface it visually

**Should have (v2.3 after validation):**
- Bulk actions — multi-select checkboxes, export selected, add to collection, remove from library
- Inline contextual quick actions — hover state: "Add to collection" dropdown on each row
- Tag filter sidebar section — optional enhancement once core filtering is proven
- Citation format preview — requires formatter integration; lower priority

**Defer to v3+:**
- AI-powered search or tagging
- Smart collections (auto-grouping by tag combinations)
- Shared reading lists with permissions
- Related papers discovery (embedding similarity)
- Keyboard shortcuts for power users

**Anti-features to explicitly avoid in v2.2:**
- Hierarchical/nested collections — flat collections are more maintainable; nested trees confuse navigation and export
- Infinite scroll — pagination wins on predictability, accessibility, and mobile (users want to know "how many total")
- Complex AND/OR/NOT filter logic — all selected filters apply as AND; advanced syntax deferred until demand materializes
- Real-time multi-user sync — page refresh is sufficient for personal library; adds hidden complexity

### Architecture Approach

The overhaul generalizes the existing two-column + mobile-tabs pattern from the search page into reusable infrastructure, then composes library-specific filter panels on top. The critical design decision is a three-layer abstraction that keeps shared chrome separate from domain-specific filter logic.

**Major components:**
1. **`SidebarLayout`** (NEW — `components/layout/sidebar-layout.tsx`) — High-level responsive container. Desktop: wraps `TwoColumnLayout` with sticky sidebar. Mobile: `Tabs` + `AnimatePresence` slide animation between Results and Filters tabs. Absorbs the manual tab logic currently duplicated inside `ResultsPageContent`. Used by search, library, and future pages.
2. **`FilterSidebar`** (NEW — `components/layout/filter-sidebar.tsx`) — Generic sidebar chrome: title, active filter count badge, collapse toggle with Framer Motion, clear-all button, content slot (render prop). Extracts the repeated UI chrome from `SearchSidebar`. Does not contain any filter logic.
3. **`SearchFilterSidebar`** (NEW — `components/search/search-filter-sidebar.tsx`) — Composes `FilterSidebar` + existing memoized search filter panels (DateFilterPanel, RatingFilterPanel, etc.) with `SearchProvider` context wiring. Replaces the monolithic 944-line `SearchSidebar`.
4. **`LibraryFilterSidebar`** (NEW — `components/library/library-filter-sidebar.tsx`) — Composes `FilterSidebar` + new library filter panels with nuqs `useQueryStates` wiring.
5. **Library filter panels** (NEW) — Four memoized panels: `LibraryRatingFilterPanel`, `LibraryDateSavedFilterPanel`, `LibraryYearRangeFilterPanel`, `LibraryCollectionFilterPanel`. Each uses `FilterSection` (existing) as wrapper. Each accepts value + `onChange` callback; library page wires them to nuqs.
6. **`SearchSidebar`** (DEPRECATED) — Deleted after search page migration to `SearchFilterSidebar` is validated.
7. **`LibraryFilters`** (REPLACED) — Existing inline horizontal filter grid replaced by `LibraryFilterSidebar`.

**State management stays intentionally split:**
- Search page: `SearchProvider` context (reactive, real-time feedback) + nuqs URL sync (bookmarkable)
- Library page: nuqs URL params only (bookmarkable, no context overhead needed)
- These patterns serve different purposes and must not bleed into each other.

**Build order follows dependency graph:** Foundation (`SidebarLayout`, `FilterSidebar`) → Search refactor (prove pattern) → Library overhaul (primary goal) → Polish and E2E.

### Critical Pitfalls

1. **State source-of-truth confusion (nuqs vs. SearchProvider context)** — Never wrap the library page in `SearchProvider`. Filter components must accept `onFilterChange` callbacks, not read from context. Verification: apply filter, check URL param updates immediately, reload page, verify sidebar reflects the URL state. Address in Phase 1 by establishing the callback pattern before any domain-specific code is written.

2. **i18n hardcoded strings in shared components** — The app has 6 locales (next-intl). Every string in `FilterSidebar`, `SidebarLayout`, or library filter panels must use `useTranslations`. No English literals. Test by rendering new components in all 6 locales before considering them done. Cost to fix after release is HIGH.

3. **Pagination cursor not reset on filter change** — Library uses cursor-based pagination. When any filter changes, cursor must be set to `null` in the URL. Not doing this causes skipped results or "no results on page 2 after filtering." Centralize in a single `handleFilterChange` function — never scatter reset logic across filter panels. Test: apply filter while on page 3, verify cursor is null in URL.

4. **Dual query path filter mismatch** — The Convex `withSearchIndex` path and `withIndex` browse path support different filter combinations. The UI must not expose sort options incompatible with the active query path. Build a filter availability matrix documenting which filters are valid for each path; validate before querying. Address before Phase 3 implementation begins.

5. **Collection CRUD bleeding into filter state** — Collection create/edit/delete dialogs must use local component state (`useState`), not nuqs. A collection mutation must never trigger a filter reset. Test: apply filters, open collection create dialog, create collection, close dialog, verify all filters unchanged.

---

## Implications for Roadmap

### Phase 1: Generalized Layout Infrastructure
**Rationale:** `SidebarLayout` and `FilterSidebar` are hard prerequisites for all subsequent phases. Building them first in isolation (no changes to production pages) allows testing independently. This phase also establishes the correct state and i18n architecture before any domain-specific code is written — preventing the highest-cost pitfalls from being baked in.
**Delivers:** `SidebarLayout` (desktop two-column + mobile tabs), `FilterSidebar` (chrome with collapse/clear), both with full test coverage.
**Addresses:** Two-column layout, mobile tab-based filter interface (table stakes), i18n compliance for shared components
**Avoids:** State source-of-truth confusion, hardcoded English strings, mobile UX inconsistency — must be addressed here before downstream code inherits them
**Research flag:** Standard patterns — Framer Motion, shadcn Tabs, `TwoColumnLayout` wrapping all well-documented with codebase examples. No additional research needed.

### Phase 2: Search Page Sidebar Refactor
**Rationale:** Migrate the search page to use the new infrastructure as a low-risk proving ground before touching the library. The search page is simpler to migrate (no filter layout redesign needed, just rewiring existing panels). Validates the new components under real production conditions. Also cleans up the 944-line `SearchSidebar` monolith, removing a significant source of technical debt.
**Delivers:** `SearchFilterSidebar` (composed from `FilterSidebar` + existing memoized panels), `ResultsPageContent` updated to use `SidebarLayout`, old `SearchSidebar.tsx` deleted.
**Uses:** All existing search filter panels (DateFilterPanel, RatingFilterPanel, etc. — already memoized, no changes needed)
**Implements:** Phase 1 infrastructure on its first real consumer
**Avoids:** Mobile tab logic duplication (manual Tabs code in `ResultsPageContent` moves to `SidebarLayout`)
**Research flag:** Standard patterns — direct codebase rewiring. No additional research needed.

### Phase 3: Library Page UI Overhaul
**Rationale:** Apply proven components to the primary milestone goal. The Convex backend (schema, indexes, dual-path queries, auth-gated pagination) is complete from v2.1. This phase is pure frontend: create library-specific filter panels, compose via `LibraryFilterSidebar`, wire to nuqs params, update `LibraryPageClient` to use `SidebarLayout`. All table stakes features for v2.2 land in this phase.
**Delivers:** Library page with two-column sidebar layout, collapsible desktop sidebar, mobile tabs (Results/Filters), full filter suite (rating, date saved, year range, collection, text search), sort options, rating display on each item, pagination with result counts.
**Uses:** `SidebarLayout`, `FilterSidebar`, `FilterSection`, `useProtectedPaginatedQuery`, `librarySearchParams` nuqs parsers, `convex-helpers` `getManyVia` for collection queries (all existing)
**Implements:** `LibraryFilterSidebar`, four library filter panels, `LibraryPageClient` redesigned to sidebar-based layout
**Avoids:** Cursor reset on filter change, collection CRUD isolation, dual query path validation
**Research flag:** NEEDS DEEPER REVIEW before planning — build the filter availability matrix documenting which Convex query path supports which filter/sort combinations. This decision shapes the entire library filter UX and must be resolved before implementation begins.

### Phase 4: Display Polish and Validation
**Rationale:** After core layout and filtering works, add display details that complete the v2.2 scope. Also the right time for cross-page E2E tests (dependent on both search and library migration completing) and accessibility audit.
**Delivers:** Rating display on each library item (stars or label), sort dropdown wired to nuqs + Convex, pagination "X-Y of Z papers" count display, cross-page E2E test suite, accessibility compliance (ARIA labels, tab navigation), performance profile.
**Addresses:** Rating visual indicator, sort options (table stakes features); also keyboard navigation, responsive edge cases
**Avoids:** Responsive design breaks at odd viewports — test at 375px, 480px, 768px, 1024px; mobile touch targets minimum 44×44px
**Research flag:** Standard patterns — no additional research needed.

### Phase Ordering Rationale

- Infrastructure before application: `SidebarLayout` and `FilterSidebar` must exist and be tested before any page uses them. Building them standalone eliminates risk of parallel divergence (library and search implementing different responsive patterns).
- Search before library: Search migration is lower risk (no filter layout redesign, just rewiring existing panels). It validates the new component architecture under production conditions before the library overhaul — which has a larger surface area — depends on it.
- Backend before frontend polish: Convex schema and queries from v2.1 are complete. Library phase can start immediately without backend blockage.
- Do not merge Phase 1 and 3 directly: skipping the search refactor means the library page becomes the first consumer of untested new components, significantly increasing risk. The search refactor is the right proving ground.

### Research Flags

Needs deeper research/analysis during planning:
- **Phase 3 (Library Overhaul):** Build a filter availability matrix before planning — document which of the library filters (rating, date saved, year range, collection ID, text search) are compatible with the Convex `withSearchIndex` path vs. the `withIndex` browse path, and what happens when a user has both a text query and an incompatible sort preference active. This shapes the query switching logic and the UX for surfacing/hiding incompatible filter options.

Standard patterns (skip research-phase):
- **Phase 1 (Infrastructure):** Framer Motion animations, shadcn Tabs, `TwoColumnLayout` wrapping — well-documented. Codebase already has `sidebar-motion.ts` with animation variants.
- **Phase 2 (Search Refactor):** Pure component extraction and rewiring. ARCHITECTURE.md documents exact component boundaries and build order with specific file paths.
- **Phase 4 (Polish):** Rating display, sort dropdown, pagination controls — standard UI with no unknowns.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies confirmed. All capabilities verified in current `package.json`. Convex dual-path query patterns verified against official docs and direct codebase inspection. |
| Features | HIGH | Based on competitive analysis of Zotero 7, Mendeley 2025, Semantic Scholar, Google Scholar with multiple cross-referencing sources. Prioritization validated against PROJECT.md scope and v2.1 implementation state. |
| Architecture | HIGH | Based on direct codebase inspection of every relevant component with line counts. Component boundaries are specific to actual files (`SearchSidebar` at 944 lines, `LibraryPageClient` at 381 lines, etc.). State management patterns verified against `nuqs` and `SearchProvider` usage. |
| Pitfalls | HIGH | Every pitfall is grounded in a specific codebase pattern (the monolithic `SearchSidebar`, dual Convex query paths, cursor pagination semantics, 6-locale requirement). Each has a concrete prevention strategy and a specific verification test. |

**Overall confidence:** HIGH

### Gaps to Address

- **Filter availability matrix (Phase 3 prerequisite):** The exact set of filter/sort combinations that are valid for each Convex query path needs to be written down as a code-level decision table before Phase 3 implementation begins. This is not blocking roadmap creation but is a required pre-implementation artifact. Recommended: create this as a code comment block in the library filter handler file on the first day of Phase 3.

- **Sidebar collapse state persistence (Phase 1):** PITFALLS research notes that collapse state in `React.useState` is lost on re-render. The existing `FilterSidebarStore` in `lib/store.ts` (Zustand, persisted) is the right location. Validate this pattern works for both search and library before `FilterSidebar` is considered done.

- **Mobile touch target validation (Phase 4):** PITFALLS specifies 44×44px minimum touch targets for mobile filter controls. Verify via real device or accurate mobile viewport testing, not just by inspecting CSS. Add to Phase 4 acceptance criteria explicitly.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `components/search-sidebar.tsx` (944 lines), `components/layout/two-column-layout.tsx`, `components/library/library-page-client.tsx` (381 lines), `components/library/library-filters.tsx` (407 lines), `components/shared/filter-section.tsx` (89 lines), `components/results-page-content.tsx` (223 lines), `lib/store.ts` (FilterSidebarStore, RatingsStore), `lib/search/provider.tsx` (SearchProvider context), `lib/library/search-params.ts` (nuqs parsers), `package.json` (all versions), `convex/schema.ts`
- [Convex Full Text Search docs](https://docs.convex.dev/search/text-search) — searchIndex definition, filterFields, 1024 result limit, relevance ordering, 1 searchField per index
- [Convex Indexes docs](https://docs.convex.dev/database/reading-data/indexes/) — compound indexes, 32 per table limit, ordering rules
- [Convex Pagination docs](https://docs.convex.dev/database/pagination) — cursor-based pagination, `usePaginatedQuery`
- [Convex Relationship Structures](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas) — junction table pattern for M:N, indexing strategies
- [convex-helpers Relationship Helpers](https://stack.convex.dev/functional-relationships-helpers) — `getManyVia`, import paths
- [convex-helpers filter + pagination issue #864](https://github.com/get-convex/convex-helpers/issues/864) — variable page sizes with `filter()` + `paginate()` confirmed as expected behavior

### Secondary (MEDIUM confidence)
- [Zotero 7 redesign blog](https://www.zotero.org/blog/zotero-7/) — sidebar filter patterns, mobile behavior reference
- [Paperpile: Zotero vs. Mendeley 2025](https://paperpile.com/r/zotero-vs-mendeley/) — feature comparison baseline for competitive analysis
- [Pencil & Paper: Filter UX Design Patterns](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-filtering) — sidebar filter UX conventions
- [nuqs GitHub](https://github.com/47ng/nuqs) — URL state management for Next.js, immediate-update pattern
- [React State Management 2025 (DeveloperWay)](https://www.developerway.com/posts/react-state-management-2025) — context vs. URL state tradeoffs

### Supporting (context)
- [Smashing Magazine: Frustrating Design Patterns — Broken Filters](https://www.smashingmagazine.com/2021/07/frustrating-design-patterns-broken-frozen-filters/) — filter reset UX expectations
- [ContentSquare: 5 Major Mobile Filtering Pitfalls](https://contentsquare.com/blog/5-major-mobile-filtering-pitfalls-and-how-to-fix-them/) — mobile filter validation guidance
- [Offset vs Cursor-Based Pagination (DEV Community)](https://dev.to/rahul_ramfort/understanding-offset-vs-cursor-based-pagination-1582) — cursor reset semantics on filter change

---

*Research completed: 2026-03-01*
*Ready for roadmap: yes*
