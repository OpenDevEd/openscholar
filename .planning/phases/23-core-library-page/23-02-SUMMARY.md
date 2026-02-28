---
phase: 23-core-library-page
plan: 02
subsystem: ui
tags: [next.js, react, convex, i18n, library, sidebar, motion, shadcn]

# Dependency graph
requires:
  - phase: 23-core-library-page
    plan: 01
    provides: browseLibrary, searchLibrary, getLibraryCount queries and removeFromLibrary mutation
  - phase: 22-schema-rating-bridge
    provides: libraryItems schema, saveToLibrary mutation, useRatingsStore, RatingSelector
provides:
  - /library route with auth gate (unauthenticated users blocked automatically)
  - LibraryPageClient orchestrator with dual-path query switching (browse vs search)
  - Search bar with 300ms debounced filtering
  - Interactive star filter for minimum rating
  - Sort dropdown (date saved, rating, publication year) with asc/desc toggle
  - Expandable item rows with abstract and DOI link
  - Three-dot menu removal with confirmation dialog
  - Skeleton loading and empty state components
  - Sidebar Library navigation item
  - i18n translations for 6 locales (en-US, en-GB, fr, zh, ja, hi)
  - removeFromLibraryByOpenalexId mutation for clearing ratings
  - Bidirectional sync: removing from library clears stars, clearing stars removes from library
affects: [24 (URL state for filters/sort), 25 (collections UI)]

# Tech tracking
tech-stack:
  added: []
  patterns: [dual-path query UI orchestrator, fire-and-forget removal with Zustand sync, expandable list rows with motion/react]

key-files:
  created:
    - app/library/page.tsx
    - components/library/library-page-client.tsx
    - components/library/library-search-bar.tsx
    - components/library/library-filters.tsx
    - components/library/library-item-row.tsx
    - components/library/library-item-skeleton.tsx
    - components/library/library-empty-state.tsx
  modified:
    - components/app-sidebar.tsx
    - components/rating-selector.tsx
    - convex/library/mutations.ts
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/zh.json
    - messages/ja.json
    - messages/hi.json

key-decisions:
  - "Bidirectional rating-library sync: removing from library clears Zustand stars; clearing stars removes from library"
  - "Added removeFromLibraryByOpenalexId mutation for rating-selector to delete by openalexId instead of _id"

patterns-established:
  - "Dual-path UI orchestrator: skip browse query when searching, skip search query when browsing"
  - "Expandable list row pattern with motion/react AnimatePresence for height animation"
  - "Three-dot overflow menu with stopPropagation to prevent row expand"

requirements-completed: [LIB-03, LIB-08, LIB-09]

# Metrics
duration: 32min
completed: 2026-02-28
---

# Phase 23 Plan 02: Library UI Page Summary

**Full /library page with dual-path search/browse, expandable item rows, star filter, sort dropdown, sidebar nav, 6-locale i18n, and bidirectional rating-library sync**

## Performance

- **Duration:** 32 min (including human verification)
- **Started:** 2026-02-28T22:26:00Z
- **Completed:** 2026-02-28T22:57:46Z
- **Tasks:** 3 (+ 1 verification fix commit)
- **Files modified:** 16

## Accomplishments
- Complete /library route with server component metadata and client-side orchestrator
- 7 library UI components: page client, search bar, rating filter, sort dropdown, item row (expandable), skeleton loading, empty states
- Dual-path query switching: browseLibrary (sorted) when no search text, searchLibrary (relevance) when searching, with sort disabled in search mode
- Sidebar Library navigation item positioned between Bookmarks and History
- Full i18n translations for all 6 locales with ICU plural rules
- Bidirectional sync between star ratings and library: removing from library clears stars, clearing stars removes from library

## Task Commits

Each task was committed atomically:

1. **Task 1: Create library UI components and page route** - `83c8d76` (feat)
2. **Task 2: Add sidebar navigation item and i18n translations** - `753535e` (feat)
3. **Task 3: Verify library page end-to-end** - APPROVED (checkpoint, no code commit)
4. **Verification fixes: Bidirectional rating-library sync** - `a00247b` (fix)

## Files Created/Modified
- `app/library/page.tsx` - Server component with metadata for /library route
- `components/library/library-page-client.tsx` - Main client orchestrator with dual-path queries, search, filters, sort, removal
- `components/library/library-search-bar.tsx` - Full-width debounced search input with clear button
- `components/library/library-filters.tsx` - Interactive star rating filter and sort dropdown with direction toggle
- `components/library/library-item-row.tsx` - Compact expandable row with stars, title, authors, year, journal, citations, OA badge, three-dot menu
- `components/library/library-item-skeleton.tsx` - Skeleton placeholder rows for loading state
- `components/library/library-empty-state.tsx` - Empty library and no-results states with CTAs
- `components/app-sidebar.tsx` - Added Library nav item between Bookmarks and History
- `components/rating-selector.tsx` - Added removeFromLibraryByOpenalexId call when clearing a rating
- `convex/library/mutations.ts` - Added removeFromLibraryByOpenalexId mutation
- `messages/en-US.json` - libraryPage, common.library, metadata keys
- `messages/en-GB.json` - British English translations
- `messages/fr.json` - French translations
- `messages/zh.json` - Chinese translations
- `messages/ja.json` - Japanese translations
- `messages/hi.json` - Hindi translations

## Decisions Made
- Bidirectional rating-library sync: when a user removes an item from the library page, the star rating is also cleared in the Zustand store; when a user clears a star rating via the RatingSelector, the item is also removed from the Convex library. This ensures the two systems stay consistent.
- Added `removeFromLibraryByOpenalexId` mutation because the RatingSelector knows the paper's openalexId but not the library item's Convex `_id`. The mutation uses the `by_user_openalexId` index for efficient lookup.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Bidirectional rating-library sync**
- **Found during:** Task 3 (human verification)
- **Issue:** Removing from library did not clear the star rating, and clearing a star rating did not remove from library. Users would see inconsistent state between the two interfaces.
- **Fix:** (a) Library removal now calls `setRating(openalexId, null)` to clear Zustand. (b) RatingSelector now calls `removeFromLibraryByOpenalexId` when clearing a rating. (c) Added new `removeFromLibraryByOpenalexId` mutation that looks up by openalexId + userId index.
- **Files modified:** components/library/library-page-client.tsx, components/rating-selector.tsx, convex/library/mutations.ts
- **Verification:** Verified manually during human verification -- removing and re-rating works correctly in both directions
- **Committed in:** a00247b

---

**Total deviations:** 1 auto-fixed (1 missing critical functionality)
**Impact on plan:** Essential for data consistency between library and rating interfaces. No scope creep.

### Deferred Items (User Feedback)

The user noted two items during verification to address in future phases:

1. **Pagination over load-more:** User prefers pagination controls instead of the current "Load more" button. Deferred to Phase 24 (URL state) where pagination can be done with URL params.
2. **UI visual improvements:** User wants visual refinements to the library page. Deferred to a future polish phase.

## Issues Encountered
None -- implementation followed plan specification. All components compiled and rendered correctly on first attempt.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Library page is fully functional with all LIB requirements implemented
- Phase 24 (URL state) can add URL-based filter/sort persistence and pagination
- Phase 25 (collections) can extend the library UI with collection grouping
- The removeFromLibraryByOpenalexId mutation is available for any future context needing openalexId-based removal

## Self-Check: PASSED

All 7 created files verified on disk. All 3 commits (83c8d76, 753535e, a00247b) verified in git log.

---
*Phase: 23-core-library-page*
*Completed: 2026-02-28*
