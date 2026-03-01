# Roadmap: OpenAlex Count

## Milestones

- v1.0 Stripe Integration Audit -- Phases 1-3 (shipped 2026-02-27)
- v1.1 Upgrade Flow -- Phases 4-6 (shipped 2026-02-27)
- v1.2 E2E Billing Tests -- Phases 7-13 (shipped 2026-02-28)
- v2.0 TDD & Test Coverage -- Phases 14-21 (shipped 2026-02-28)
- v2.1 Library & Collections -- Phases 22-30 (shipped 2026-03-01)
- v2.2 Library UI Overhaul -- Phases 31-34 (in progress)

## Phases

<details>
<summary>v1.0 Stripe Integration Audit (Phases 1-3) -- SHIPPED 2026-02-27</summary>

- [x] Phase 1: Subscription Lifecycle Correctness (3/3 plans) -- completed 2026-02-27
- [x] Phase 2: Credit System Correctness (2/2 plans) -- completed 2026-02-27
- [x] Phase 3: Operational Hardening (2/2 plans) -- completed 2026-02-27

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>v1.1 Upgrade Flow (Phases 4-6) -- SHIPPED 2026-02-27</summary>

- [x] Phase 4: Upgrade Correctness (2/2 plans) -- completed 2026-02-27
- [x] Phase 5: Upgrade Resilience (2/2 plans) -- completed 2026-02-27
- [x] Phase 6: UX Polish (2/2 plans) -- completed 2026-02-27

Full details: `.planning/milestones/v1.1-ROADMAP.md`

</details>

<details>
<summary>v1.2 E2E Billing Tests (Phases 7-13) -- SHIPPED 2026-02-28</summary>

- [x] Phase 7: Test Infrastructure Foundation (3/3 plans) -- completed 2026-02-28
- [x] Phase 8: Subscription and Upgrade Specs (2/2 plans) -- completed 2026-02-28
- [x] Phase 9: Lifecycle and Credit Specs (2/2 plans) -- completed 2026-02-28
- [x] Phase 10: Fix Credits Spec Auth Wiring (1/1 plan) -- completed 2026-02-28
- [x] Phase 11: Tech Debt Cleanup (1/1 plan) -- completed 2026-02-28
- [x] Phase 12: Billing E2E CI Wiring (1/1 plan) -- completed 2026-02-28
- [x] Phase 13: CI Env Hardening & CRED-02 Regression (1/1 plan) -- completed 2026-02-28

Full details: `.planning/milestones/v1.2-ROADMAP.md`

</details>

<details>
<summary>v2.0 TDD & Test Coverage (Phases 14-21) -- SHIPPED 2026-02-28</summary>

- [x] Phase 14: Test Infrastructure (1/1 plan) -- completed 2026-02-28
- [x] Phase 15: AI Prompts & Schema Tests (2/2 plans) -- completed 2026-02-28
- [x] Phase 16: AI Batch Processing Tests (2/2 plans) -- completed 2026-02-28
- [x] Phase 17: AI Cost & Billing Tests (2/2 plans) -- completed 2026-02-28
- [x] Phase 18: Search & Filter Tests (3/3 plans) -- completed 2026-02-28
- [x] Phase 19: Data Export Tests (3/3 plans) -- completed 2026-02-28
- [x] Phase 20: User Auth & State Machine Tests (2/2 plans) -- completed 2026-02-28
- [x] Phase 21: Plan Enforcement & Feature Gating Tests (2/2 plans) -- completed 2026-02-28

Full details: `.planning/milestones/v2.0-ROADMAP.md`

</details>

<details>
<summary>v2.1 Library & Collections (Phases 22-30) -- SHIPPED 2026-03-01</summary>

- [x] Phase 22: Schema & Rating Bridge (2/2 plans) -- completed 2026-02-28
- [x] Phase 23: Core Library Page (2/2 plans) -- completed 2026-02-28
- [x] Phase 24: Advanced Filtering & URL State (2/2 plans) -- completed 2026-02-28
- [x] Phase 25: Collections (3/3 plans) -- completed 2026-03-01
- ~~Phase 26: Export & Polish~~ -- Superseded by Phases 29-30
- [x] Phase 27: Library UI Redesign (2/2 plans) -- completed 2026-03-01
- [x] Phase 28: Bug Fixes & Verification (2/2 plans) -- completed 2026-03-01
- [x] Phase 29: Library Export (1/1 plan) -- completed 2026-03-01
- [x] Phase 30: Library Polish (1/1 plan) -- completed 2026-03-01

Full details: `.planning/milestones/v2.1-ROADMAP.md`

</details>

### v2.2 Library UI Overhaul (In Progress)

**Milestone Goal:** Complete UI overhaul of the library page -- adopt the search page's two-column sidebar layout, extract reusable layout infrastructure (DRY), and align design language across search and library pages.

- [ ] **Phase 31: Generalized Layout Infrastructure** - Build SidebarLayout and FilterSidebar as reusable primitives with i18n and animation support
- [ ] **Phase 32: Search Page Sidebar Refactor** - Prove new layout components on the search page by replacing the monolithic SearchSidebar
- [ ] **Phase 33: Library Page UI Overhaul** - Apply proven components to the library page with full filter sidebar and two-column layout
- [ ] **Phase 34: Display Polish and Validation** - Complete display features: sort controls, pagination counts, rating display, view toggle

## Phase Details

### Phase 31: Generalized Layout Infrastructure
**Goal**: Reusable layout primitives exist that any page can compose into a two-column sidebar pattern with responsive mobile tabs
**Depends on**: Nothing (first phase of v2.2; v2.1 backend is complete)
**Requirements**: DRY-01, DRY-02, DRY-05, DRY-06
**Success Criteria** (what must be TRUE):
  1. A test page using SidebarLayout renders a two-column layout on desktop (sidebar left, content right) and tab-based interface on mobile (Results/Filters tabs)
  2. FilterSidebar renders generic chrome (title, collapse toggle, active count badge, clear button) and accepts arbitrary filter content via render prop
  3. FilterSidebar collapse toggle animates smoothly via Framer Motion and persists collapse state across re-renders (Zustand store)
  4. Both SidebarLayout and FilterSidebar render correctly in all 6 locales with zero hardcoded English strings
  5. FilterSection component is importable by both search and library pages from a shared location with no duplication
**Plans**: TBD

### Phase 32: Search Page Sidebar Refactor
**Goal**: Search page uses the new SidebarLayout and FilterSidebar components, validating the infrastructure under real production conditions
**Depends on**: Phase 31
**Requirements**: DRY-03
**Success Criteria** (what must be TRUE):
  1. Search page renders identically to its current production state (no visual or behavioral regressions) using SidebarLayout + SearchFilterSidebar instead of the monolithic SearchSidebar
  2. Mobile search page uses tab-based Results/Filters interface via SidebarLayout (replacing manual tab logic in ResultsPageContent)
  3. All existing search filters (date, rating, type, language, region, open access) continue to work through the new component composition
**Plans**: TBD

### Phase 33: Library Page UI Overhaul
**Goal**: Library page uses the same two-column sidebar layout as the search page, with a full filter sidebar replacing the inline filter grid
**Depends on**: Phase 32
**Requirements**: LAYOUT-01, LAYOUT-02, LAYOUT-03, LAYOUT-04, FLTR-01, FLTR-02, FLTR-03, FLTR-04, FLTR-05, FLTR-06, FLTR-07, FLTR-08, DRY-04
**Success Criteria** (what must be TRUE):
  1. Library page displays a two-column layout with a collapsible filter sidebar on the left and content area on the right, with the sidebar sticky on desktop scroll
  2. User can filter library items by rating, date saved, publication year range, collection, and text search -- all within the sidebar -- with active filter count badge updating in real time
  3. User can clear all active filters with a single button and all filter state persists in the URL via nuqs (bookmarkable, survives page reload)
  4. Library page switches to tab-based Results/Filters interface on mobile viewports, matching the search page pattern exactly
  5. Library page composes SidebarLayout + LibraryFilterSidebar using the same pattern as the search page (DRY composition, not copy-paste)
**Plans**: TBD

### Phase 34: Display Polish and Validation
**Goal**: Library display features are complete -- sorting, pagination counts, rating indicators, and view modes work correctly across all viewports
**Depends on**: Phase 33
**Requirements**: DISP-01, DISP-02, DISP-03, DISP-04, DISP-05
**Success Criteria** (what must be TRUE):
  1. User can sort library items via dropdown (date saved, year, rating, title) and sort options are automatically disabled when text search is active (relevance ordering takes precedence)
  2. Pagination displays result counts ("X-Y of Z papers") with prev/next navigation that updates correctly as filters change
  3. Each library item row and card visually displays its rating (stars or equivalent indicator)
  4. User can toggle between list and grid view modes for library items
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 31 -> 32 -> 33 -> 34

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Subscription Lifecycle Correctness | v1.0 | 3/3 | Complete | 2026-02-27 |
| 2. Credit System Correctness | v1.0 | 2/2 | Complete | 2026-02-27 |
| 3. Operational Hardening | v1.0 | 2/2 | Complete | 2026-02-27 |
| 4. Upgrade Correctness | v1.1 | 2/2 | Complete | 2026-02-27 |
| 5. Upgrade Resilience | v1.1 | 2/2 | Complete | 2026-02-27 |
| 6. UX Polish | v1.1 | 2/2 | Complete | 2026-02-27 |
| 7. Test Infrastructure Foundation | v1.2 | 3/3 | Complete | 2026-02-28 |
| 8. Subscription and Upgrade Specs | v1.2 | 2/2 | Complete | 2026-02-28 |
| 9. Lifecycle and Credit Specs | v1.2 | 2/2 | Complete | 2026-02-28 |
| 10. Fix Credits Spec Auth Wiring | v1.2 | 1/1 | Complete | 2026-02-28 |
| 11. Tech Debt Cleanup | v1.2 | 1/1 | Complete | 2026-02-28 |
| 12. Billing E2E CI Wiring | v1.2 | 1/1 | Complete | 2026-02-28 |
| 13. CI Env Hardening & CRED-02 Regression | v1.2 | 1/1 | Complete | 2026-02-28 |
| 14. Test Infrastructure | v2.0 | 1/1 | Complete | 2026-02-28 |
| 15. AI Prompts & Schema Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 16. AI Batch Processing Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 17. AI Cost & Billing Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 18. Search & Filter Tests | v2.0 | 3/3 | Complete | 2026-02-28 |
| 19. Data Export Tests | v2.0 | 3/3 | Complete | 2026-02-28 |
| 20. User Auth & State Machine Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 21. Plan Enforcement & Feature Gating Tests | v2.0 | 2/2 | Complete | 2026-02-28 |
| 22. Schema & Rating Bridge | v2.1 | 2/2 | Complete | 2026-02-28 |
| 23. Core Library Page | v2.1 | 2/2 | Complete | 2026-02-28 |
| 24. Advanced Filtering & URL State | v2.1 | 2/2 | Complete | 2026-02-28 |
| 25. Collections | v2.1 | 3/3 | Complete | 2026-03-01 |
| 26. Export & Polish | v2.1 | -- | Superseded | - |
| 27. Library UI Redesign | v2.1 | 2/2 | Complete | 2026-03-01 |
| 28. Bug Fixes & Verification | v2.1 | 2/2 | Complete | 2026-03-01 |
| 29. Library Export | v2.1 | 1/1 | Complete | 2026-03-01 |
| 30. Library Polish | v2.1 | 1/1 | Complete | 2026-03-01 |
| 31. Generalized Layout Infrastructure | v2.2 | 0/? | Not started | - |
| 32. Search Page Sidebar Refactor | v2.2 | 0/? | Not started | - |
| 33. Library Page UI Overhaul | v2.2 | 0/? | Not started | - |
| 34. Display Polish and Validation | v2.2 | 0/? | Not started | - |
