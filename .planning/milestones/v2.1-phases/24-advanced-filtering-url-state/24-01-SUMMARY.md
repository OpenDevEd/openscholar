---
phase: 24-advanced-filtering-url-state
plan: 01
subsystem: ui, api
tags: [nuqs, useQueryStates, url-state, convex, date-fns, filtering]

requires:
  - phase: 23-core-library-page
    provides: library page with useState-based filter/sort, browseLibrary/searchLibrary queries
provides:
  - librarySearchParams nuqs parser map with 8 URL state parameters
  - savedPresetToTimestamp utility for date preset to timestamp conversion
  - Extended browseLibrary query with savedAfter, yearFrom, yearTo filter args
  - Extended searchLibrary query with savedAfter, yearFrom, yearTo filter args
  - URL-driven library page state via useQueryStates (replaces all useState filter/sort)
affects: [24-02-filter-ui-controls, library-page, library-filters]

tech-stack:
  added: []
  patterns: [nuqs useQueryStates for page-level URL state, debounce bridge pattern for search input, composed multi-predicate Convex filter]

key-files:
  created: [lib/library/search-params.ts]
  modified: [convex/library/queries.ts, components/library/library-page-client.tsx]

key-decisions:
  - "Debounce bridge pattern: rawSearch (local useState) syncs to URL param q via useEffect after 300ms debounce"
  - "null vs undefined convention: nuqs uses null to clear params, Convex uses undefined for optional args -- conversion happens at query arg derivation"

patterns-established:
  - "Library URL state: useQueryStates(librarySearchParams) as single source of truth for filter/sort/search"
  - "Composed filter predicate: needsFilter guard with multi-condition filter() for Convex queries"

requirements-completed: [FILT-01, FILT-02, FILT-04]

duration: 2min
completed: 2026-02-28
---

# Phase 24 Plan 01: URL State Foundation Summary

**nuqs parser map with 8 URL params, Convex query date/year filtering, and useQueryStates migration replacing all useState filter state**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-28T23:22:39Z
- **Completed:** 2026-02-28T23:25:26Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Created lib/library/search-params.ts with 8-param nuqs parser map (q, sort, order, rating, saved, yf, yt, view), savedPresetToTimestamp utility, 4 const arrays, and 4 type aliases
- Extended browseLibrary and searchLibrary Convex queries with savedAfter, yearFrom, yearTo optional arguments using composed multi-predicate filter
- Migrated library-page-client.tsx from 4 separate useState calls to single useQueryStates source of truth with debounce bridge for search text

## Task Commits

Each task was committed atomically:

1. **Task 1: Create library URL parsers module and date preset converter** - `1009013` (feat)
2. **Task 2: Extend Convex queries with date and year filter arguments** - `46249db` (feat)
3. **Task 3: Migrate library-page-client.tsx from useState to useQueryStates** - `3119150` (feat)

## Files Created/Modified
- `lib/library/search-params.ts` - nuqs parser map for all library URL state (8 params), savedPresetToTimestamp converter, const arrays and type exports
- `convex/library/queries.ts` - Extended browseLibrary and searchLibrary with savedAfter/yearFrom/yearTo args and composed filter predicate
- `components/library/library-page-client.tsx` - Replaced useState with useQueryStates, added debounce bridge, wired new filter args to queries

## Decisions Made
- **Debounce bridge pattern:** Search input kept as local rawSearch state, synced to URL q param only after 300ms debounce via useEffect. This prevents creating browser history entries on every keystroke while keeping URL as source of truth.
- **null/undefined convention:** nuqs represents "no value" as null (clearing a param removes it from URL), while Convex validators use undefined for optional args. Conversion happens at the derivation point (`params.rating ?? undefined`).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- URL state backbone is complete -- Plan 02 can build filter UI controls (date saved dropdown, year range inputs, view mode toggle) that read/write to the existing URL params
- Convex queries already accept all filter arguments -- Plan 02 only needs to wire UI to setParams
- LibraryFilters component props interface unchanged -- Plan 02 extends it with new controls

## Self-Check: PASSED

All 3 created/modified files verified present. All 3 task commits verified in git log.

---
*Phase: 24-advanced-filtering-url-state*
*Completed: 2026-02-28*
