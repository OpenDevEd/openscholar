# Requirements: OpenAlex Count v2.1 Library & Collections

**Defined:** 2026-02-28
**Core Value:** Reliable, well-tested academic search and AI extraction -- with persistent library for organizing rated papers

## v2.1 Requirements

Requirements for v2.1 milestone. Each maps to roadmap phases.

### Library Core

- [x] **LIB-01**: Rating a paper (signed-in user) saves/upserts it to the user's Convex-backed library with slim normalized metadata
- [x] **LIB-02**: Library stores trimmed paper data (title, authors, DOI, abstract, year, journal, cited_by_count, open access status, OpenAlex ID) -- not the full Work blob
- [x] **LIB-03**: User can view all saved items on a dedicated `/library` page
- [x] **LIB-04**: User can search within their library by title, author, or abstract text via Convex search index
- [x] **LIB-05**: User can filter library items by rating value
- [x] **LIB-06**: User can sort library by date saved, rating, or publication year
- [x] **LIB-07**: User can remove items from their library with confirmation
- [x] **LIB-08**: Library page is auth-gated -- unauthenticated users are redirected to sign-in
- [x] **LIB-09**: Library page shows helpful empty state when no items are saved
- [x] **LIB-10**: Library items are paginated server-side via Convex `.paginate()`
- [x] **LIB-11**: Dual-path query strategy: search mode (relevance order via searchIndex) vs browse mode (custom sort via regular index)
- [x] **LIB-12**: Anonymous users retain existing localStorage rating behavior (Zustand fallback)

### Collections

- [ ] **COL-01**: User can create a new collection with a name
- [ ] **COL-02**: User can rename an existing collection
- [ ] **COL-03**: User can delete a collection (cascade deletes junction table rows, does not delete library items)
- [ ] **COL-04**: User can assign a library item to one or more collections
- [ ] **COL-05**: User can remove an item from a collection without deleting it from the library
- [ ] **COL-06**: Collections use a junction table (`libraryItemCollections`) for many-to-many, not array fields
- [ ] **COL-07**: Each collection displays an item count badge

### Filtering & URL State

- [x] **FILT-01**: User can filter library items by date saved (e.g., last week, last month, last year)
- [x] **FILT-02**: User can filter library items by publication year range
- [ ] **FILT-03**: User can filter library items by collection
- [x] **FILT-04**: All filter and sort state is persisted in the URL via `nuqs` (bookmarkable views)
- [x] **FILT-05**: User can switch between view modes (list-detail / grid)

### Export & Polish

- [ ] **EXP-01**: User can export library items as CSV or JSON (reuse existing export utilities)
- [ ] **EXP-02**: Library page and collection dialogs are mobile responsive
- [ ] **EXP-03**: All library and collection UI strings are translated for 6 locales via next-intl
- [ ] **EXP-04**: Destructive actions (remove from library, delete collection, remove from collection) show toast with feedback

## v2.2+ Requirements

Deferred to future release. Tracked but not in current roadmap.

### Enhanced Features

- **BULK-01**: User can select multiple items and bulk-add/remove from collections or bulk-delete
- **BRIDGE-01**: User can launch extraction workflow directly from selected library items
- **SYNC-01**: Ratings sync bidirectionally between search results and library (Convex replaces localStorage for signed-in users)
- **INDIC-01**: Search result cards show "already saved" indicator for items in user's library
- **REFRESH-01**: User can refresh a library item to fetch latest OpenAlex metadata

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Nested/hierarchical collections | Tree views, drag-drop, breadcrumbs -- significant complexity for minimal MVP value; flat collections sufficient |
| Tags (separate from collections) | Parallel organizational system confuses users; collections serve the same purpose |
| Smart collections / saved searches | Requires continuous query engine; too complex for v2.1 |
| PDF storage and annotation | Scope expansion; users have Zotero for this |
| Citation formatting / BibTeX export | Entire product category; Zotero already integrated |
| Collaborative/shared libraries | Requires permission models; v3+ at earliest |
| Import from reference managers | Papers enter library by rating during search; import can be added later |
| Full paper metadata editing | OpenAlex data is read-only; avoids divergence |
| localStorage migration on first sign-in | Nice-to-have; not blocking for v2.1 launch |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LIB-01 | Phase 22 | Complete |
| LIB-02 | Phase 22 | Complete |
| LIB-03 | Phase 23 | Complete |
| LIB-04 | Phase 23 | Complete |
| LIB-05 | Phase 23 | Complete |
| LIB-06 | Phase 23 | Complete |
| LIB-07 | Phase 23 | Complete |
| LIB-08 | Phase 23 | Complete |
| LIB-09 | Phase 23 | Complete |
| LIB-10 | Phase 23 | Complete |
| LIB-11 | Phase 23 | Complete |
| LIB-12 | Phase 22 | Complete |
| COL-01 | Phase 25 | Pending |
| COL-02 | Phase 25 | Pending |
| COL-03 | Phase 25 | Pending |
| COL-04 | Phase 25 | Pending |
| COL-05 | Phase 25 | Pending |
| COL-06 | Phase 25 | Pending |
| COL-07 | Phase 25 | Pending |
| FILT-01 | Phase 24 | Complete |
| FILT-02 | Phase 24 | Complete |
| FILT-03 | Phase 25 | Pending |
| FILT-04 | Phase 24 | Complete |
| FILT-05 | Phase 24 | Complete |
| EXP-01 | Phase 26 | Pending |
| EXP-02 | Phase 26 | Pending |
| EXP-03 | Phase 26 | Pending |
| EXP-04 | Phase 26 | Pending |

**Coverage:**
- v2.1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 after roadmap creation*
