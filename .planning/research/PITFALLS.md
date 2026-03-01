# Pitfalls: UI Overhaul with Sidebar Integration

**Domain:** Refactoring a list page to adopt a sidebar layout from an existing page, filter state generalization, and component reuse across pages with different pagination and query strategies

**Researched:** 2026-03-01

**Confidence:** HIGH (verified against React/Next.js best practices, UI migration patterns, and state management research)

## Critical Pitfalls

### Pitfall 1: State Inconsistency Between URL (nuqs) and Context Providers

**What goes wrong:**
The library currently uses `nuqs` for URL-driven state (filters, pagination, sort). The search page uses `SearchProvider` context for state. When you try to reuse components like `FilterSection` or `SearchSidebar` on the library page, you create a source-of-truth conflict: changes in context don't sync to URL params, filters set via context appear to vanish on refresh, and URL bookmarks become stale when context state diverges.

**Why it happens:**
Developers see working filter components in search and try to drop them into library without realizing the search page flows: User action → Context update → URL sync (if wired). The library needs: User action → URL update via nuqs (which is the source of truth). Different architectures trying to coexist on the same page leads to data duplication and silent failures.

**How to avoid:**
- **Decision**: Pick ONE source of truth for library page filters. Keep `nuqs` (URL-driven) since the project already uses it successfully for library filters.
- **Component Design**: When reusing `FilterSection` or sidebar components, ensure they accept `onFilterChange(filterName, value)` callbacks, not context providers. Library: use nuqs to update URL on callback. Search: use SearchProvider.
- **No Context on Library**: Do NOT wrap library page or its sidebar in `SearchProvider`. Create library-specific filter state (or keep using nuqs directly) instead.
- **Type Safety**: Add JSDoc types to filter components indicating "takes callbacks, not context" to prevent misuse.

**Warning signs:**
- Filters persist across page reloads on search but reset on library (or vice versa)
- URL params don't change when you adjust filters in sidebar
- Components ignore `onFilterChange` props and directly mutate context
- Tests pass locally but fail after `?filter=value` bookmark is opened

**Phase to address:**
**Phase 1 (Sidebar Layout)** — Establish state architecture before implementing sidebar. Create a test: navigate library with filters, set URL params manually, verify sidebar reflects them. Add tests for "filter state round-trip": filter → URL → reload → sidebar updated.

---

### Pitfall 2: Over-Generalizing FilterSection Component Across Incompatible Query Architectures

**What goes wrong:**
Library uses "dual-path" queries: search-optimized (full-text search index) vs. regular indexes (for custom sorts, cursor pagination). Search uses a different index/API. When you extract `FilterSection` into a shared component, you assume all filters work the same way. Reality: some filters only exist on search (e.g., "contains AI") because they use full-text index; library's cursor pagination breaks if you apply filters that require offset-based position. UI shows options that don't work, or queries fail silently.

**Why it happens:**
Developers see "filter button" and assume all filters are equivalent. They generalize prematurely without mapping which filters exist on which query path. Each page has different backend constraints, but the component hides this.

**How to avoid:**
- **Document Filter Availability**: Create a matrix in code comments showing which filters work with which query paths:
  ```typescript
  // FILTER AVAILABILITY MATRIX
  // Filter          | Search Page | Library (index) | Library (custom-sort)
  // ===================================================================
  // full-text       | ✓           | ✓               | ✗ (no index)
  // year range      | ✓           | ✓               | ✓
  // date saved      | N/A         | ✓               | ✓
  // custom sort     | Limited     | N/A             | ✓
  ```
- **Component Contracts**: FilterSection should accept `availableFilters: FilterDef[]` prop, not hardcode filter options. Library and search pass different arrays.
- **Query Path Validation**: In library filter handler, validate that the filter + current query path combination is legal. If not, either remove filter from UI or switch query path silently.
- **Test Both Paths**: Run identical filter tests on both "search-enabled" and "browse" library queries. Catch mismatches.

**Warning signs:**
- Library sidebar shows filters that return empty results or cause 400 errors
- Some filters work on search page but not library (or vice versa)
- "Filter availability" logic scattered across components instead of centralized
- New filter added to search but library still shows old behavior

**Phase to address:**
**Phase 1 (Sidebar Layout)** — Map available filters for each query path before writing sidebar. Create test fixtures for both paths, verify FilterSection respects `availableFilters` prop.

---

### Pitfall 3: Pagination Model Mismatch (Cursor vs. Offset)

**What goes wrong:**
Library uses cursor-based pagination (because it scales with Convex and handles concurrent updates). Search uses offset-based pagination (simpler client-side). When you add sidebar to library and users switch filters, the cursor becomes invalid: "current page pointer doesn't exist in filtered results." OR you try to make pagination state generic and accidentally mix cursor/offset logic, causing skipped results, duplicates, or "page not found" errors on filter changes.

**Why it happens:**
Developers see "pagination component" and think it's page-number-independent. They don't realize cursor pagination requires resetting to cursor = null on filter change, while offset needs currentPage = 1. Different reset semantics, different URL param shapes (`cursor` vs. `page`).

**How to avoid:**
- **Reset on Filter Change**: When any filter changes, ALWAYS reset pagination state. For cursor: set cursor = null (starts fresh). For offset: set page = 1. Enforce this in filter handlers, not in components.
  ```typescript
  const handleFilterChange = (filterName, value) => {
    setSearchParams({ [filterName]: value, cursor: null }); // Reset cursor
  };
  ```
- **Document Model in Component**: Add comment to pagination component indicating which model it uses.
- **No Mixing**: Never allow the same page to switch between cursor and offset models. Library stays cursor, search stays offset.
- **Test Filter + Pagination Combos**: Create tests that apply filters, navigate pages, then change filters and verify pagination reset occurs.

**Warning signs:**
- Users apply filter, get results, navigate to page 2, change filter, then see "no results" or duplicates on page 2
- Pagination component shows "page 3 of 2"
- URL has both `cursor` and `page` params (mixing models)
- Tests pass on first page but fail after filter + pagination combination

**Phase to address:**
**Phase 1 (Sidebar Layout)** — Add integration test for "filter changes reset pagination." Verify cursor is cleared in URL when any filter updates.

---

### Pitfall 4: Collection Management UI State Not Isolated From Filter State

**What goes wrong:**
You add a sidebar with filters, but the library also has collection CRUD (create, read, update, delete collections and associate items). When filter state lives in context or URL params, you have no isolated space for collection edit forms or dialogs. Closing a "Create Collection" dialog triggers a filter change (state cleanup), or moving a paper to a collection updates filters unexpectedly. Collection associations and filter state bleed into each other.

**Why it happens:**
Developers treat all URL state as "filter state" and dump everything into nuqs. Or they put collection editing in a modal that shares the page's context. Collection changes shouldn't affect filters, but if they share state management, changes propagate.

**How to avoid:**
- **Separate State Trees**: Keep filters in `nuqs` (URL state). Keep collection UI state (dialog open/close, editing form, selected collection ID) in component local state or a separate context.
  ```typescript
  // Good separation:
  const [filters] = useQueryState(...); // From nuqs (URL)
  const [editingCollectionId, setEditingCollectionId] = useState(null); // Local state
  ```
- **No Filter Resets on Collection Changes**: When user creates/updates/deletes a collection, do NOT reset filters. The collection action is orthogonal.
- **Test Independence**: Write tests that update filters AND update collections in the same test session. Verify both work without interference.

**Warning signs:**
- Collection create dialog closes, filters unexpectedly reset
- Adding item to collection also clears the search query
- Collection edit form shows/hides filters based on state

**Phase to address:**
**Phase 1 (Sidebar Layout)** — Add test: user applies filter, opens collection dialog, creates collection, dialog closes, filters are still applied. Verify collection state doesn't bleed into filter state.

---

### Pitfall 5: Mobile Responsive Design Pattern Inconsistency (Sidebar Collapse vs. Tabs)

**What goes wrong:**
Search page uses tab-based mobile filters (horizontal tabs at top, swappable panels). Library currently has no sidebar. When you port sidebar to library with a collapsible/hamburger menu (common desktop pattern), it looks different from search's tab pattern. Users see inconsistent filtering UX across the app. OR you try to reuse the search tab pattern on library and it breaks because the tab navigation state isn't wired to nuqs, causing filter state to reset on mobile navigation.

**Why it happens:**
Developers copy the desktop sidebar component to mobile without adapting for mobile patterns. Mobile sidebar as a slide-out drawer is standard, but it conflicts with the tab-based approach used elsewhere in the app. No single "responsive FilterSection" exists, so two different implementations emerge.

**How to avoid:**
- **Define Mobile First**: Decide: does library use tabs (like search) or collapsible sidebar (hamburger)?
  - **Recommendation**: Use tabs on mobile (matching search page) to unify user experience. Update library mobile design to match search.
  - **Implementation**: Create a `ResponsiveFilterSection` that renders tabs on mobile (`md` breakpoint below), sidebar on desktop. Share between search and library.
- **Tab State in URL**: If using tabs, ensure selected tab is reflected in URL (`?filterTab=date-range`), so state survives reloads.
- **Touch Targets**: Ensure all filter buttons on mobile are at least 44px × 44px. Test with actual touch, not mouse.
- **Test Across Breakpoints**: Run your filter tests at both desktop and mobile viewport sizes. Verify same filters work in both.

**Warning signs:**
- Search page shows horizontal tabs on mobile, library shows slide-out drawer
- Clicking mobile filter tabs doesn't update URL, so closing and reopening app loses filter state
- Filter buttons on mobile are small and hard to tap
- Filters show on desktop but disappear on mobile

**Phase to address:**
**Phase 2 (Mobile Responsive Filters)** — Create `ResponsiveFilterSection` component that unifies mobile filter UX with search page. Test on real mobile devices or realistic mobile viewports.

---

### Pitfall 6: Hardcoded Strings in Shared Components Break i18n (6 Locales)

**What goes wrong:**
You refactor `FilterSection` into a shared component and hardcode English strings like "Apply Filters", "Date Range", "Year". The library page is translated into 6 locales (via next-intl). When the shared component has hardcoded strings, translations are missing for those strings in the sidebar. Users see English filter labels on non-English library pages. OR new filters are added to the sidebar and developers forget to add translations, leading to English labels appearing randomly.

**Why it happens:**
Developers extract components without moving translatable strings to locale files. Hardcoded strings seem fine in a one-off component, but when generalized, they create translation debt. i18n string extraction tools don't catch strings in shared components if they're not wrapped in translation calls.

**How to avoid:**
- **All Strings in i18n Files**: Every filter label, button text, and placeholder in FilterSection must be in next-intl locale files. No hardcoded English strings.
  ```typescript
  // Good:
  import { useTranslations } from 'next-intl';
  const t = useTranslations('filters');
  return <label>{t('dateRange')}</label>;

  // Bad:
  return <label>Date Range</label>;
  ```
- **Shared Filter Definitions**: Define all available filters in a centralized file with i18n keys:
  ```typescript
  export const FILTERS = {
    dateRange: { label: 'filters.dateRange', type: 'date-range' },
    yearRange: { label: 'filters.yearRange', type: 'number-range' },
  };
  ```
- **Test All Locales**: Run your sidebar tests with different locale settings. Verify translations load correctly.
- **Pseudo-Localization**: Use a test locale with extra characters (e.g., "Date Range" → "ÐàtéRange+") to catch untranslated strings.

**Warning signs:**
- English text appears in sidebar on French/German/Chinese pages
- New filters added, but no translation files updated
- Sidebar component has mixed English and translated text
- Locale switcher doesn't apply to sidebar

**Phase to address:**
**Phase 1 (Sidebar Layout)** — Before writing any filter UI, extract all strings to i18n. Create test that renders sidebar in all 6 locales and verifies no English text appears.

---

### Pitfall 7: Filter Reset Logic Creates Silent Data Inconsistency

**What goes wrong:**
When you apply a filter on the library, users expect certain behaviors: filtering is applied, pagination resets to page 1 (or cursor = null), and the URL updates. If filter reset logic is incomplete, stale filters remain in URL after navigation, or old sorts persist even though filter changed. User clicks a filter, gets confused why results don't match, tries same filter again, then it works (cache behavior or race condition).

**Why it happens:**
Reset logic is scattered: filter handler resets pagination but forgets to reset sort. Or mutations to collection state trigger filter resets. Or filter state lives in two places (URL + context), and only one gets reset. Developers assume filters are independent and don't coordinate resets.

**How to avoid:**
- **Document Reset Semantics**: When filter X changes, what else resets? Create a decision table:
  ```
  | User Action       | URL Param Reset | Sort Reset | Pagination Reset |
  | ================= | =============== | ========== | ================ |
  | Filter change     | Update filter   | Keep sort  | Reset to page 1  |
  | Sort change       | Keep filters    | Update     | Reset to page 1  |
  | Collection change | Keep all        | Keep all   | NO reset         |
  ```
- **Centralized Reset Handler**: Create a single function that handles all resets, ensuring consistency:
  ```typescript
  const handleFilterChange = (filterName, value) => {
    setSearchParams({
      [filterName]: value,
      cursor: null,  // Always reset pagination
      // sort: keep it
    });
  };
  ```
- **Test Reset Chains**: Write integration tests that verify reset behavior. E.g., "apply filter A, apply filter B, verify pagination is page 1 both times."

**Warning signs:**
- URL shows old filters even after changing new filter
- Sorting works, then filter is applied, and sort reverts unexpectedly
- Tests pass in isolation but fail when run together (state pollution)
- Users report "filter doesn't work if I also sort"

**Phase to address:**
**Phase 1 (Sidebar Layout)** — Before implementing sidebar, document reset semantics in a test file. All reset logic must go through a single handler.

---

### Pitfall 8: Mobile Filter Dialog Doesn't Persist State (Tabs Closed, Selections Lost)

**What goes wrong:**
On mobile, you implement a "Filter" button that opens a bottom sheet or modal dialog with filter options. User opens dialog, selects 3 filters, closes dialog, then opens dialog again — all 3 filters are gone. OR user applies filters, navigates away (back to home), returns to library, and sidebar is now empty. Mobile filter state isn't persisted correctly because filter changes inside the dialog don't update URL until dialog closes.

**Why it happens:**
Dialog state (whether it's open/closed) is often local to the dialog component. Filter changes inside the dialog are buffered in local state until "Apply" button is clicked. But URL state lives elsewhere. If the dialog resets on every open, local state is lost. If URL only updates on "Apply" click and user navigates before clicking it, changes are lost.

**How to avoid:**
- **Update URL Immediately**: Filter changes in dialog should update URL/nuqs immediately, not on "Apply". This way, any navigation preserves state.
  ```typescript
  const handleFilterChange = (filterName, value) => {
    setSearchParams({ [filterName]: value }); // Update URL immediately
  };
  ```
- **Dialog State in URL**: If the dialog is open/closed state is relevant, include it in URL (`?filterOpen=true`) so reopening browser/page brings user back to the open dialog.
- **Test Dialog Lifecycle**: Write tests that open dialog, change filters, close, reopen, and verify filters persisted.

**Warning signs:**
- Mobile users apply filters, dialog closes, they reopen it and filters are cleared
- Filter selections work on desktop but reset on mobile
- Navigating away and back to library loses mobile filter state

**Phase to address:**
**Phase 2 (Mobile Responsive Filters)** — Test dialog state lifecycle on mobile. Ensure all filter changes update URL immediately, not on dialog close.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode filter options in sidebar | Fast to build | 6 locales missing translations; hard to add/remove filters later | Never — strings must be i18n from day 1 |
| Copy FilterSection component from search to library | Reuse component; avoid duplication | Two incompatible versions diverge; bugs fixed in one don't apply to both | Only if you extract to shared component immediately after copy |
| Use URL-driven state (nuqs) for all sidebar state | Bookmarkable filters; no context prop drilling | Collection edit dialogs become complex; unrelated UI state pollutes URL | Good practice; context should be minimal |
| Assume all filter combinations work | Simpler logic; don't validate | Silent failures or bad queries when incompatible filters combine | Never — test all combos, document constraints |
| Reset pagination on every filter change | Simple rule; fewer edge cases | Edge case: user sorts, then filters, and expects to stay on sort column | Good trade-off; resetting pagination is safer |
| Keep mobile and desktop filter UI separate | Each can be optimized independently | Inconsistent UX; translations duplicated; bugs in one don't trigger in other | Never — create responsive component that works on both |

---

## Integration Gotchas

Common mistakes when connecting components and pages with different architectures.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| FilterSection (from search) → library page | Wrapping in SearchProvider; assuming context syncs to URL | Accept `onFilterChange` callback; let parent (library) decide if it updates nuqs or context |
| Sidebar collapsing | Storing collapse state in React.useState in sidebar; loses state on re-render | Store collapse state in URL or persistent localStorage, or lift to page level |
| Collection CRUD ↔ Filter state | Treating collection mutations as triggering filter resets | Keep collection state completely separate; collection changes should not affect filters |
| URL query params ↔ Mobile filter dialog | Dialog state is local; URL only updates on "Apply" | Update URL immediately on every filter change; dialog state follows URL |
| Dual query paths (search index vs. regular) | Assuming all filters work on both paths | Document which filters are valid for each path; validate before querying |
| Pagination (cursor) ↔ Filter changes | Not resetting cursor when filters change | Always set cursor = null in filter handler; ensure tests catch missing resets |
| Translate filter labels | Hardcoding English in FilterSection; forgetting locale files | All labels from i18n files; test with all 6 locales; use pseudo-localization to catch strings |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Querying without filter constraints on dual-path setup | First page is fast; second page is slow or times out | Always enforce filter constraints before querying; document max result set size | ~1000 items without filters; 10K+ with poor filters |
| Unindexed junction table (libraryItemCollections) | Collection filtering works, then slows dramatically | Ensure composite index on (libraryItemId, collectionId); test with 1000+ items | 100+ items in many collections; grows quadratically |
| Sidebar re-renders on every filter change | Smooth with 5 filters; laggy with 20+ | Memoize filter sections; use React.memo or useMemo | 15+ filter sections; mobile becomes unusable |
| Loading all filter options upfront | Initial library page load is fast | Lazy-load filter options or paginate (e.g., year range computed on demand) | 1000+ unique values for any filter |
| Context provider re-renders all children on state change | One filter changes, entire sidebar re-renders | Split contexts by concern; use useCallback to memoize handlers | 20+ filters; mobile performance drops 50%+ |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trusting filter values from URL without validation | User crafts URL with malicious filter values; could cause DB DoS or data exposure | Validate all filter values against allowed options before querying; use enums/allowlists |
| Exposing collection ownership via filter results | User queries `?collectionId=other-user-id` and sees private collections | Always filter library queries by current user ID; never rely on client-side filtering alone |
| Allowing filter combinations that expose hidden fields | Complex filter + sort combo returns fields user shouldn't see | Test filter combinations with non-admin users; audit Convex queries to ensure auth checks |
| Storing filter state in localStorage without encryption | Browser localStorage can be read by XSS or other tabs | Don't store sensitive filter state in localStorage; use URL (which is public-safe) for bookmarkable state |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No visual feedback when filter is applied | Users unsure if filter "stuck"; apply same filter twice | Show applied filters as chips or badges; highlight active filters in sidebar |
| Mobile filter dialog closes without "Apply" button feedback | User taps to filter, doesn't know if it worked | Keep dialog open until user explicitly closes; provide visual confirmation (toast or chip) |
| Sidebar filters don't match available data | User selects filter, gets 0 results; no explanation | Show result counts per filter option; disable filters that would return 0 results |
| Too many filters crowd the sidebar | Mobile sidebar is 90% filter UI; scrolling becomes tedious | Group related filters (e.g., date filters into "Date" group); use accordion/collapsible sections |
| Filter reset destroys user's work | User applies 5 filters, changes sort, pagination resets unexpectedly | Only reset pagination and cursor on filter change; preserve sort and other state if possible |
| Mobile filter dialog can't fit on small screens | iPhone SE users see filter dialog that's too tall | Use bottom sheet that scrolls internally; keep filter controls compact; avoid full-screen modals |
| Responsive design breaks between breakpoints | Filters look good at 768px and 769px, but terrible at 767px | Test at odd viewport sizes (375px, 480px, 768px, 1024px); use CSS grid with auto-fit |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Filter Sidebar:** Filters appear in sidebar, but they're hardcoded in English. Verify all filter labels are in i18n locale files for all 6 locales.
- [ ] **Filter Sidebar:** Sidebar filters work on search page, but library shows different available filters. Verify FilterSection accepts `availableFilters` prop and respects it.
- [ ] **Mobile Responsive:** Sidebar collapses on mobile, but doesn't match search page's tab pattern. Verify mobile uses same filter UX (tabs) as search page for consistency.
- [ ] **State Management:** Filters persist in URL and survive refresh. Verify by manually editing URL, refreshing, and checking sidebar reflects params.
- [ ] **Pagination + Filters:** User applies filter, pagination resets. Verify cursor is set to null in URL when filter changes; test by applying filter on page 3.
- [ ] **Collection CRUD:** Creating a collection works without resetting filters. Verify collection mutations don't trigger filter state resets.
- [ ] **Cursor Pagination:** Cursor pagination works with filters applied. Verify cursor becomes invalid after filter change, query returns to first page, cursor is null in URL.
- [ ] **Dual Query Paths:** Library filters work with both "search-enabled" and "custom sort" query paths. Verify by testing filters on both paths; document which filters work where.
- [ ] **Dialog State:** Mobile filter dialog retains state after close/reopen. Verify by opening dialog, applying filters, closing, reopening; filters should still be visible.
- [ ] **Integration Tests:** Filter + pagination, filter + sort, filter + collection CRUD all tested together. Verify no state interference when combining operations.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Context state diverges from URL state on library page | HIGH | 1. Identify which component is source of truth (likely URL/nuqs). 2. Remove context from library page. 3. Retest all filter combos. 4. Update integration tests to verify single source of truth. |
| Hardcoded English strings in sidebar discovered after release | HIGH | 1. Extract all strings to i18n files. 2. Create locale files for missing translations. 3. Deploy translations. 4. Add pseudo-localization test to catch future hardcoded strings. |
| Pagination cursor becomes invalid after filter change | MEDIUM | 1. Update filter handler to set cursor = null. 2. Add integration test for "filter → pagination reset". 3. If users affected, document in changelog. |
| Mobile filter UI inconsistent with search page tabs | MEDIUM | 1. Create ResponsiveFilterSection that unifies both. 2. Update library to use new component. 3. Update mobile tests to run against both pages. |
| Junction table (collections) shows duplicates or slow queries | HIGH | 1. Audit unique constraints on junction table; add composite primary key if missing. 2. Check indexes on foreign key columns. 3. Run performance tests with 1000+ items. 4. If data corrupted, write migration to deduplicate. |
| Filters disappear after mobile app restart | MEDIUM | 1. Verify filter changes update URL immediately (not on dialog close). 2. Add test that opens dialog, changes filters, closes app, relaunches. 3. Ensure URL persistence is working. |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| State inconsistency (nuqs vs. context) | Phase 1: Sidebar Layout | Test filter → URL param → reload → sidebar reflects param. Verify nuqs is source of truth. |
| Over-generalized FilterSection | Phase 1: Sidebar Layout | Create filter availability matrix. Test both "search-enabled" and "custom-sort" library queries with all filters. |
| Pagination cursor mismatch | Phase 1: Sidebar Layout | Test filter change resets cursor to null. Verify pagination state in URL updates correctly. |
| Collection CRUD ↔ filter interference | Phase 1: Sidebar Layout | Test: apply filter, create collection, close dialog, verify filter still applied. |
| Mobile responsive inconsistency | Phase 2: Mobile Responsive Filters | Compare mobile filter UI between search and library. Both should use same tab or drawer pattern. Test on real mobile viewports. |
| i18n hardcoded strings | Phase 1: Sidebar Layout | Render sidebar in all 6 locales. Use pseudo-localization to detect untranslated strings. Verify locale files have entries for all filter labels. |
| Filter reset logic scattered | Phase 1: Sidebar Layout | Document reset semantics in decision table. Implement centralized reset handler. Write integration tests for reset chains. |
| Mobile filter dialog state lost | Phase 2: Mobile Responsive Filters | Test mobile dialog: apply filters, close dialog, navigate away, return, reopen dialog. All filters should persist. |

---

## Sources

### State Management & Context
- [Avoiding State Inconsistencies: The Pitfall of Multiple React Context Providers - DEV Community](https://dev.to/rakshyak/avoiding-state-inconsistencies-the-pitfall-of-multiple-react-context-providers-4e29)
- [React State Management in 2025: What You Actually Need - DeveloperWay](https://www.developerway.com/posts/react-state-management-2025)
- [React patterns to avoid common pitfalls in local state management - LogRocket](https://blog.logrocket.com/react-patterns-common-pitfalls-local-state-management/)
- [How to use React Context effectively - Kent C. Dodds](https://kentcdodds.com/blog/how-to-use-react-context-effectively)
- [Blogged Answers: Why React Context is Not a "State Management" Tool - Mark's Dev Blog](https://blog.isquaredsoftware.com/2021/01/context-redux-differences/)

### URL State Management & nuqs
- [Type-safe search params state manager for React frameworks - nuqs GitHub](https://github.com/47ng/nuqs)
- [Why You Should Use nuqs: Smarter URL State Management - Medium](https://medium.com/@ruverd/why-you-should-use-nuqs-smarter-url-state-management-for-react-next-js-26a8b51ca1ac)
- [Managing search parameters in Next.js with nuqs - LogRocket](https://blog.logrocket.com/managing-search-parameters-next-js-nuqs/)

### Component Reuse & Composition
- [Most components should NOT be reused - Medium](https://medium.com/@tomaszmularczyk89/most-components-should-not-be-reused-d8187c6f0360)
- [A Guide to Building Reusable React Components - Medium](https://medium.com/@rashmipatil24/reusable-react-components-7b025f232ca4)
- [Building Reusable UI Components with React: Best Practices - Medium](https://medium.com/cstech/building-reusable-ui-components-with-react-best-practices-and-patterns-24b6fe921347)

### Pagination & Filtering
- [Complete guide to pagination UI design template - SetProduct](https://www.setproduct.com/blog/pagination-ui-design)
- [Mobile: Filtering And Pagination Of Posts - Comprehensive Guide](https://tossthecoin.tcl.com/blog/mobile-filtering-and-pagination-of)
- [Client Side vs Server Side Pagination - ThatSoftwareDude.com](https://www.thatsoftwaredude.com/content/10386/server-side-pagination-vs-client-side-pagination)
- [Offset vs Cursor-Based Pagination: Choosing the Best Approach - Medium](https://medium.com/@eminasian/filtering-and-search-client-side-vs-server-side-a9084bbcbf74)
- [Cursor-based pagination vs Offset-based pagination - DEV Community](https://dev.to/rahul_ramfort/understanding-offset-vs-cursor-based-pagination-1582)

### Mobile Responsive Filter Design
- [Filter UX Design Patterns & Best Practices - Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-filtering)
- [Mobile Filter UX Design Patterns & Best Practices - Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-mobile-filters)
- [5 Major Mobile Filtering Pitfalls to Avoid and How to Fix Them - ContentSquare](https://contentsquare.com/blog/5-major-mobile-filtering-pitfalls-and-how-to-fix-them/)
- [Designing Filters That Work: Best Practices and Guidelines - Smashing Magazine](https://www.smashingmagazine.com/2021/07/frustrating-design-patterns-broken-frozen-filters/)
- [Responsive Design: Getting Advanced Filtering Right - Medium](https://medium.com/@mibosc/responsive-design-getting-advanced-filtering-right-bbd6c04f09e1)

### Internationalization (i18n)
- [Internationalization beyond code: A developer's guide - Phrase](https://phrase.com/blog/posts/internationalization-beyond-code-a-developers-guide-to-real-world-language-challenges/)
- [Avoid String Concatenation: A Must for i18n-Friendly Code - Julia Diez Lopez](https://www.juliadiezlopez.com/blog/avoid-string-concatenation-a-must-for-i18n-friendly-code)

### Database & Junction Tables
- [Many-to-Many Database Relationships: Complete Implementation Guide - Beekeeper Studio](https://www.beekeeperstudio.io/blog/many-to-many-database-relationships-complete-guide)
- [Challenges in Managing Many-to-Many Relationships in SQL - Hypermode](https://hypermode.com/blog/sql-many-to-many-relationship)
- [Boost Query Performance with Database Indexing - AccelData](https://www.acceldata.io/blog/mastering-database-indexing-strategies-for-peak-performance)

### UI Refactoring & Design
- [18 Common UI Design Mistakes and How to Fix Them (2026) - MockFlow](https://mockflow.com/blog/ui-design-mistakes)
- [Be Careful with Horizontal Filtering Toolbars – Baymard](https://baymard.com/blog/horizontal-filtering-sorting-design)

---

*Pitfalls research for: Library Page UI Overhaul with Sidebar Integration*

*Researched: 2026-03-01*
