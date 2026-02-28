---
phase: 22-schema-rating-bridge
plan: 02
subsystem: ui
tags: [react, convex, mutation, zustand, rating, library, auth, fire-and-forget]

# Dependency graph
requires:
  - phase: 22-schema-rating-bridge
    provides: "saveToLibrary mutation, trimPaperData utility, TrimmedPaperData type"
provides:
  - "Dual-path rating bridge: Zustand (always) + Convex saveToLibrary (signed-in)"
  - "All rating entry points (search cards, focus mode desktop, focus mode mobile) wired to library save"
  - "paperResult prop pattern for passing OpenAlex Work objects to RatingSelector"
affects: [23-library-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget mutation pattern: .catch() logs but does not throw"
    - "Dual-path state: Zustand optimistic + Convex persistent for authenticated users"
    - "Auth-gated mutation via useAuthReadiness phase check"

key-files:
  created: []
  modified:
    - "components/rating-selector.tsx"
    - "components/ui/focus-mode.tsx"
    - "components/paper-card/paper-card-list-detail.tsx"
    - "components/paper-card/paper-card-list-simple.tsx"
    - "components/paper-card/paper-card-grid.tsx"

key-decisions:
  - "Fire-and-forget mutation pattern -- Zustand is optimistic, Convex failure logged but never blocks UI"
  - "Rating removal (no-rating) does not call mutation -- library deletion is Phase 23 (LIB-07)"
  - "FocusMode looks up paper from papers array by ID rather than receiving as prop (already has access)"

patterns-established:
  - "paperResult prop on RatingSelector: optional Record<string, any> for library save"
  - "useAuthReadiness phase === 'authenticated' guard before Convex mutations in UI components"

requirements-completed: [LIB-01, LIB-12]

# Metrics
duration: 2min
completed: 2026-02-28
---

# Phase 22 Plan 02: Schema & Rating Bridge - UI Rating Bridge Summary

**Dual-path rating bridge wiring RatingSelector and FocusMode to Convex saveToLibrary mutation for signed-in users while preserving Zustand/localStorage for anonymous users**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-28T21:37:02Z
- **Completed:** 2026-02-28T21:39:25Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- RatingSelector accepts optional paperResult prop and calls saveToLibrary mutation for authenticated users
- FocusMode handleRatingChange wired to Convex mutation (desktop keyboard shortcuts + mobile compact selector)
- All 3 paper card components (list-detail, list-simple, grid) pass paperResult={result} to RatingSelector
- Anonymous user behavior completely unchanged -- Zustand/localStorage only

## Task Commits

Each task was committed atomically:

1. **Task 1: Add dual-path bridge to RatingSelector** - `75b230f` (feat)
2. **Task 2: Add bridge to FocusMode and pass paperResult in all paper cards** - `1906983` (feat)

## Files Created/Modified
- `components/rating-selector.tsx` - Added paperResult prop, useAuthReadiness/useMutation hooks, conditional saveToLibrary call
- `components/ui/focus-mode.tsx` - Added useAuthReadiness/useMutation hooks, updated handleRatingChange with Convex bridge, passed paperResult to mobile RatingSelector
- `components/paper-card/paper-card-list-detail.tsx` - Added paperResult={result} to both RatingSelector instances (mobile + desktop)
- `components/paper-card/paper-card-list-simple.tsx` - Added paperResult={result} to RatingSelector
- `components/paper-card/paper-card-grid.tsx` - Added paperResult={result} to RatingSelector

## Decisions Made
- Fire-and-forget mutation pattern: `.catch()` logs errors but never throws -- Zustand optimistic state is the source of truth for UI, Convex is persistent backup
- Rating removal (`no-rating`) does NOT trigger the Convex mutation -- library item deletion is a separate Phase 23 action (LIB-07)
- FocusMode uses `papers.find()` to look up the paper object by ID rather than receiving it as a prop, since the `papers` array is already available in scope
- Used `saveToLibraryMutation` variable name in FocusMode (vs `saveToLibrary` in RatingSelector) to avoid potential naming conflicts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All rating entry points now trigger library save for authenticated users
- Phase 22 complete -- schema, mutation, and UI bridge all wired
- Phase 23 (Library UI) can build on this foundation: query library items, display them, implement removal (LIB-07)
- All 6 indexes on libraryItems table (from Plan 01) ready for Phase 23 queries

## Self-Check: PASSED

All 5 modified files verified on disk. Both task commits verified in git history.

---
*Phase: 22-schema-rating-bridge*
*Completed: 2026-02-28*
