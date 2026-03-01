# Roadmap: OpenAlex Count

## Milestones

- v1.0 Stripe Integration Audit -- Phases 1-3 (shipped 2026-02-27)
- v1.1 Upgrade Flow -- Phases 4-6 (shipped 2026-02-27)
- v1.2 E2E Billing Tests -- Phases 7-13 (shipped 2026-02-28)
- v2.0 TDD & Test Coverage -- Phases 14-21 (shipped 2026-02-28)
- v2.1 Library & Collections -- Phases 22-28 (in progress)

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

### v2.1 Library & Collections (In Progress)

**Milestone Goal:** Persistent server-side library where rating items auto-saves them, with collections and full filtering on a dedicated page.

- [x] **Phase 22: Schema & Rating Bridge** - Convex tables, indexes, trimPaperData utility, rating-to-save mutation, anonymous Zustand fallback (completed 2026-02-28)
- [x] **Phase 23: Core Library Page** - Dedicated /library route with auth gate, paginated item list, search, filter by rating, sort, remove, empty states (completed 2026-02-28)
- [x] **Phase 24: Advanced Filtering & URL State** - Date saved and publication year filters, nuqs URL persistence for all filter/sort state, view mode switching (completed 2026-02-28)
- [ ] **Phase 25: Collections** - Collection CRUD, junction table mutations, item-to-collection assignment, filter by collection, item count badges
- [ ] **Phase 26: Export & Polish** - CSV/JSON export, mobile responsiveness, i18n for 6 locales, toast feedback on destructive actions
- [ ] **Phase 28: Bug Fixes & Verification** - Focus-mode rating removal bug, Phase 24 verification, REQUIREMENTS.md traceability corrections

## Phase Details

### Phase 22: Schema & Rating Bridge
**Goal**: Users can rate papers and have them automatically saved to a persistent server-side library
**Depends on**: Nothing (first phase of v2.1)
**Requirements**: LIB-01, LIB-02, LIB-12
**Success Criteria** (what must be TRUE):
  1. Signed-in user rates a paper on search results and it appears in their Convex-backed library with slim normalized metadata (title, authors, DOI, abstract, year, journal, cited_by_count, open access status, OpenAlex ID)
  2. Rating the same paper again updates the existing library entry (upsert, not duplicate)
  3. Anonymous user can still rate papers using localStorage (existing Zustand behavior unchanged)
  4. Library item documents are 1-2 KB each (full OpenAlex blob fields stripped before storage)
**Plans**: 2 plans

Plans:
- [ ] 22-01-PLAN.md -- TDD: Schema, trimPaperData utility, saveToLibrary upsert mutation
- [ ] 22-02-PLAN.md -- Rating bridge: RatingSelector + FocusMode dual-path wiring

### Phase 23: Core Library Page
**Goal**: Users can browse, search, filter, sort, and manage their saved library items on a dedicated page
**Depends on**: Phase 22
**Requirements**: LIB-03, LIB-04, LIB-05, LIB-06, LIB-07, LIB-08, LIB-09, LIB-10, LIB-11
**Success Criteria** (what must be TRUE):
  1. User navigates to /library and sees all their saved items in a paginated list (server-side cursor-based pagination)
  2. User can type a search query and results filter to items matching by title, author, or abstract text
  3. User can filter items by rating value and sort by date saved, rating, or publication year
  4. User can remove an item from their library with a confirmation step
  5. Unauthenticated user visiting /library is redirected to sign-in, and an empty library shows a helpful empty state
**Plans**: 2 plans

Plans:
- [ ] 23-01-PLAN.md -- TDD: Library queries (browseLibrary, searchLibrary, getLibraryCount) and removeFromLibrary mutation
- [ ] 23-02-PLAN.md -- Library page UI: route, components, sidebar nav, i18n, human verification

### Phase 24: Advanced Filtering & URL State
**Goal**: Users can apply date and year filters, switch view modes, and bookmark/share filtered library views via URL
**Depends on**: Phase 23
**Requirements**: FILT-01, FILT-02, FILT-04, FILT-05
**Success Criteria** (what must be TRUE):
  1. User can filter library items by date saved (last week, last month, last year) and by publication year range
  2. All filter, sort, and search state is persisted in the URL -- refreshing the page or sharing the link restores the exact view
  3. User can switch between list-detail and grid view modes
**Plans**: 2 plans

Plans:
- [ ] 24-01-PLAN.md -- URL state foundation: nuqs parser module, Convex query date/year filter args, useState-to-useQueryStates migration
- [ ] 24-02-PLAN.md -- Filter UI and view modes: date preset buttons, year range inputs, list/grid toggle, grid card component, 6-locale i18n

### Phase 25: Collections
**Goal**: Users can organize library items into named collections with full CRUD and many-to-many assignment
**Depends on**: Phase 23
**Requirements**: COL-01, COL-02, COL-03, COL-04, COL-05, COL-06, COL-07, FILT-03
**Success Criteria** (what must be TRUE):
  1. User can create a new collection, rename it, and delete it (deletion removes assignment links but does not delete library items)
  2. User can assign a library item to one or more collections and remove it from a collection without deleting it from the library
  3. User can filter the library view by collection to see only items in that collection
  4. Each collection displays a badge showing its current item count
  5. Collection membership uses a junction table (libraryItemCollections) -- not array fields
**Plans**: 3 plans

Plans:
- [ ] 25-01-PLAN.md -- TDD: Schema tables (collections + junction), collection CRUD mutations, cascade delete
- [ ] 25-02-PLAN.md -- TDD: Collection assignment mutations, count/membership queries, collection-filtered browse/search, URL param
- [ ] 25-03-PLAN.md -- Collection UI: filter dropdown, management dialog, collection picker, i18n (6 locales), human verification

### Phase 26: Export & Polish
**Goal**: Library is production-ready with export, mobile support, full i18n, and polished feedback on all destructive actions
**Depends on**: Phase 24, Phase 25
**Requirements**: EXP-01, EXP-02, EXP-03, EXP-04
**Success Criteria** (what must be TRUE):
  1. User can export their library items (or a filtered subset) as CSV or JSON
  2. Library page and collection dialogs render correctly on mobile viewports
  3. All library and collection UI strings appear correctly in all 6 supported locales
  4. Removing an item from library, deleting a collection, and removing an item from a collection each show toast feedback
**Plans**: TBD

Plans:
- [ ] 26-01: TBD
- [ ] 26-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 22 -> 23 -> 24 -> 25 -> 26
(Note: Phase 24 and Phase 25 both depend on Phase 23 but are independent of each other. However, Phase 26 depends on both.)

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
| 22. Schema & Rating Bridge | 2/2 | Complete    | 2026-02-28 | - |
| 23. Core Library Page | 2/2 | Complete    | 2026-02-28 | - |
| 24. Advanced Filtering & URL State | 2/2 | Complete    | 2026-02-28 | - |
| 25. Collections | 1/3 | In Progress|  | - |
| 26. Export & Polish | v2.1 | 0/? | Not started | - |
| 27. Library UI Redesign | 2/2 | Complete    | 2026-03-01 | - |
| 28. Bug Fixes & Verification | v2.1 | 0/? | Not started | - |

### Phase 27: Library UI Redesign

**Goal:** Redesign all library page components (filters, item cards, grid view) to match the search results page's component patterns and visual quality. Extract shared components (FilterSection, view mode toggle, year range picker) to DRY up duplicate code between search and library pages.
**Requirements**: FILT-01, FILT-02, FILT-05
**Depends on:** Phase 24
**Plans:** 1/3 plans executed

Plans:
- [x] TBD (run /gsd:plan-phase 27 to break down) (completed 2026-03-01)

### Phase 28: Bug Fixes & Verification
**Goal:** Fix focus-mode rating removal integration bug, add missing Phase 24 verification, and correct REQUIREMENTS.md traceability for Phase 27 contributions
**Depends on:** Phase 27
**Requirements**: LIB-01 (integration fix), FILT-04 (verification)
**Gap Closure:** Closes integration, flow, and verification gaps from v2.1 audit
**Plans**: TBD

Plans:
- [ ] 28-01: TBD
- [ ] 28-02: TBD
