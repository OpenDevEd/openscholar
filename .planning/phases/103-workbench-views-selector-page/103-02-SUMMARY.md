---
phase: 103-workbench-views-selector-page
plan: 02
subsystem: extraction-selector
tags: [ui, selector, tabs, basket, extraction]
dependency_graph:
  requires: [extraction-basket-store, use-add-to-basket, extraction-counter, extraction-dialog, add-to-extraction-button]
  provides: [selector-page, library-tab, collections-tab, search-results-tab, manual-ids-tab]
  affects: [extraction-flow, i18n]
tech_stack:
  added: []
  patterns: [per-collection-query, search-history-replay, zustand-selector, cap-aware-bulk-add]
key_files:
  created:
    - app/extraction/new/page.tsx
    - app/extraction/new/selector-page-client.tsx
    - app/extraction/new/library-tab.tsx
    - app/extraction/new/collections-tab.tsx
    - app/extraction/new/search-results-tab.tsx
    - app/extraction/new/manual-ids-tab.tsx
  modified:
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/hi.json
    - messages/ja.json
    - messages/zh.json
    - convex/_generated/api.d.ts
decisions:
  - "CollectionRow uses per-collection useProtectedQuery(listLibrary, {collectionId}) instead of dynamic fetch in callback -- React hooks cannot be called conditionally"
  - "SearchResultsTab uses SearchPaper minimal interface instead of PaperResult to avoid Work/PaperResult sustainable_development_goals type mismatch"
  - "SearchResultsTab re-executes search via getSearchResultsWithFilters rather than caching results -- search results are transient OpenAlex API data not stored in Convex"
metrics:
  duration: 9m
  completed: "2026-04-16T12:54:00Z"
  tasks: 2
  files_created: 6
  files_modified: 7
---

# Phase 103 Plan 02: Selector Page with Source Tabs Summary

Unified cross-source paper selector page at /extraction/new with 4 active tabs, disabled Zotero placeholder, sticky header/footer, and ExtractionDialog wiring to basket store.

## What Was Built

### Task 1: Server Component + SelectorPageClient
- Server component at `app/extraction/new/page.tsx` with i18n metadata
- Client component `selector-page-client.tsx` with 5 tabs (Library, Collections, Search Results, Manual IDs, Zotero disabled)
- Sticky header with Beaker icon, page title, description, and ExtractionCounter
- Sticky footer with ExtractionCounter, Review Basket button, and Start Extraction CTA
- Start Extraction CTA disabled when basket is empty, with tooltip explanation
- ExtractionDialog receives `papersForDialog` mapped from basket store with `openAlexId` -> `openalexId` casing conversion
- ExtractionBasketDrawer wired for basket review
- i18n keys added across all 6 locale files under `extraction.selector`

### Task 2: Four Source Tab Components
- **LibraryTab**: Fetches library items via `useProtectedQuery(listLibrary)`, renders list with checkboxes for bulk select, "Select all" toggle, "Add selected to basket" button, and per-item `AddToExtractionButton`. Items already in basket shown with muted opacity.
- **CollectionsTab**: Fetches collections via `getCollectionsWithCounts`. Each collection renders as a card with name, paper count badge, and "Add entire collection" button. Collection items fetched per-row via `useProtectedQuery(listLibrary, {collectionId})`.
- **SearchResultsTab**: Reads search history from Zustand store. User picks a recent search via Select dropdown, papers re-fetched from OpenAlex via `getSearchResultsWithFilters`. Supports bulk select with checkboxes.
- **ManualIdsTab**: Monospace textarea for pasting OpenAlex IDs (one per line). "Resolve & Add" button calls `resolveManualIds` Convex action. Pre-validates IDs via `normalizeOpenAlexId`. Shows error toast for unresolvable IDs. Clears textarea on success.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Convex codegen missing openalex/actions module**
- **Found during:** Task 2
- **Issue:** `convex/_generated/api.d.ts` did not include the `openalex/actions` module (created in Phase 100 Plan 03) because codegen cannot run without a deployment connection
- **Fix:** Manually added `openalex_actions` import and module registration to `api.d.ts`
- **Files modified:** `convex/_generated/api.d.ts`
- **Commit:** d2af5cb

**2. [Rule 1 - Bug] Work/PaperResult type incompatibility in SearchResultsTab**
- **Found during:** Task 2
- **Issue:** `getSearchResultsWithFilters` returns `Work[]` from the OpenAlex SDK, but `PaperResult` extends `Work` with an incompatible `sustainable_development_goals` override
- **Fix:** Introduced `SearchPaper` minimal interface and map raw results to it, avoiding the type mismatch
- **Files modified:** `app/extraction/new/search-results-tab.tsx`
- **Commit:** d2af5cb

**3. [Rule 1 - Bug] Dead code in CollectionsTab**
- **Found during:** Post-task stub scan
- **Issue:** `handleExtractCollection` callback contained placeholder comments and error toast -- was never called because `CollectionRow` handles extraction via its own hook
- **Fix:** Removed dead `handleExtractCollection` callback and `loadingId` state
- **Files modified:** `app/extraction/new/collections-tab.tsx`
- **Commit:** d2af5cb

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 192721a | Server component, SelectorPageClient with tabs/footer/dialog, i18n keys |
| 2 | d2af5cb | Four source tab components with data fetching and basket integration |

## Self-Check: PASSED

All 6 created files verified present. Both commits exist in git log. TypeScript compiles cleanly (`tsc --noEmit` exits 0, excluding pre-existing test regex flag issue).
