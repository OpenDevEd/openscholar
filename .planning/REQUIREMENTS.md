# Requirements: OpenAlex Count

**Defined:** 2026-03-01
**Core Value:** Reliable, well-tested academic search and AI extraction

## v2.2 Requirements

Requirements for Library UI Overhaul milestone. Each maps to roadmap phases.

### Layout & Responsive Design

- [ ] **LAYOUT-01**: Library page uses two-column layout with filter sidebar on left and content area on right
- [ ] **LAYOUT-02**: Filter sidebar is collapsible on desktop with toggle button and smooth animation
- [ ] **LAYOUT-03**: Library page uses tab-based interface on mobile (Results/Filters tabs) matching search page pattern
- [ ] **LAYOUT-04**: Sidebar is sticky on desktop so filters remain visible while scrolling content

### Filter Sidebar

- [ ] **FLTR-01**: User can filter library items by rating using star buttons in sidebar
- [ ] **FLTR-02**: User can filter library items by date saved (week/month/year presets) in sidebar
- [ ] **FLTR-03**: User can filter library items by publication year range in sidebar
- [ ] **FLTR-04**: User can filter library items by collection using dropdown in sidebar
- [ ] **FLTR-05**: User can search within library items using text search in sidebar
- [ ] **FLTR-06**: Active filter count badge displays on sidebar header
- [ ] **FLTR-07**: User can clear all active filters with a single button
- [ ] **FLTR-08**: All filter state persists in URL via nuqs (bookmarkable, survives reload)

### Display & Navigation

- [ ] **DISP-01**: User can sort library items via dropdown (date saved, year, rating, title)
- [ ] **DISP-02**: Sort options are disabled/hidden when text search is active (relevance ordering from search index)
- [ ] **DISP-03**: Pagination displays result counts ("X-Y of Z papers") with prev/next navigation
- [ ] **DISP-04**: Rating is visually displayed on each library item row and card
- [ ] **DISP-05**: User can toggle between list and grid view modes

### Component Architecture (DRY)

- [x] **DRY-01**: SidebarLayout component generalizes two-column desktop + mobile tabs pattern for reuse across pages
- [x] **DRY-02**: FilterSidebar component provides generic sidebar chrome (title, collapse toggle, active count badge, clear button, content slot)
- [ ] **DRY-03**: Search page refactored to use SidebarLayout + SearchFilterSidebar (replacing monolithic SearchSidebar)
- [ ] **DRY-04**: Library page uses same SidebarLayout + LibraryFilterSidebar composition
- [x] **DRY-05**: All new shared components have full i18n support across 6 locales
- [x] **DRY-06**: FilterSection component reused by both search and library filter panels (no duplication)

## Future Requirements

Deferred to v2.3+. Tracked but not in current roadmap.

### Bulk Actions

- **BULK-01**: User can multi-select library items with checkboxes
- **BULK-02**: User can export selected items to CSV/JSON
- **BULK-03**: User can add selected items to a collection
- **BULK-04**: User can remove selected items from library

### Enhanced Interactions

- **INTX-01**: Inline quick actions on hover (add to collection dropdown)
- **INTX-02**: Tag filter sidebar section
- **INTX-03**: Keyboard shortcuts for power users

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Nested/hierarchical collections | Flat collections more maintainable; nested trees confuse navigation and export |
| Infinite scroll | Pagination wins on predictability, accessibility, and mobile |
| Complex AND/OR/NOT filter logic | All filters apply as AND; advanced syntax deferred until demand materializes |
| Real-time multi-user sync | Page refresh sufficient for personal library; adds hidden complexity |
| AI-powered search or tagging | Requires LLM integration; v3+ scope |
| Smart collections (auto-grouping) | Requires continuous query engine; v3+ scope |
| Shared reading lists | Requires permission models; v3+ scope |
| Related papers discovery | Requires embedding similarity; v3+ scope |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LAYOUT-01 | Phase 33 | Pending |
| LAYOUT-02 | Phase 33 | Pending |
| LAYOUT-03 | Phase 33 | Pending |
| LAYOUT-04 | Phase 33 | Pending |
| FLTR-01 | Phase 33 | Pending |
| FLTR-02 | Phase 33 | Pending |
| FLTR-03 | Phase 33 | Pending |
| FLTR-04 | Phase 33 | Pending |
| FLTR-05 | Phase 33 | Pending |
| FLTR-06 | Phase 33 | Pending |
| FLTR-07 | Phase 33 | Pending |
| FLTR-08 | Phase 33 | Pending |
| DISP-01 | Phase 34 | Pending |
| DISP-02 | Phase 34 | Pending |
| DISP-03 | Phase 34 | Pending |
| DISP-04 | Phase 34 | Pending |
| DISP-05 | Phase 34 | Pending |
| DRY-01 | Phase 31 | Complete |
| DRY-02 | Phase 31 | Complete |
| DRY-03 | Phase 32 | Pending |
| DRY-04 | Phase 33 | Pending |
| DRY-05 | Phase 31 | Complete |
| DRY-06 | Phase 31 | Complete |

**Coverage:**
- v2.2 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0

---
*Requirements defined: 2026-03-01*
*Last updated: 2026-03-01 after roadmap creation*
