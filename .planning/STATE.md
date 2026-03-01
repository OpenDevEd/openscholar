---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Library & Collections
status: unknown
last_updated: "2026-03-01T05:22:15Z"
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 8
  completed_plans: 8
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-28)

**Core value:** Reliable, well-tested academic search and AI extraction
**Current focus:** v2.1 Library & Collections -- Phase 24 in progress (advanced filtering & URL state)

## Current Position

Phase: 25 (Collections)
Plan: 2 of 3 complete
Status: Plan 02 complete (TDD: assignment mutations + count queries + filtered browse/search). Plan 03 remains.
Last activity: 2026-03-01 -- Plan 02 completed (collection assignment, counts, filtered queries)

Progress: [#############_______] 67% (Phase 25: 2/3 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 50 (v1.0: 7, v1.1: 6, v1.2: 11, v2.0: 17, v2.1: 5, phase-27: 2, phase-25: 2)
- Total milestones shipped: 4

**By Milestone:**

| Milestone | Phases | Plans | Shipped |
|-----------|--------|-------|---------|
| v1.0 | 3 | 7 | 2026-02-27 |
| v1.1 | 3 | 6 | 2026-02-27 |
| v1.2 | 7 | 11 | 2026-02-28 |
| v2.0 | 8 | 17 | 2026-02-28 |
| v2.1 | 6 | TBD | In progress |
| Phase 27 P01 | 2min | 2 tasks | 3 files |
| Phase 27 P02 | 2min | 2 tasks | 5 files |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full log.

- [22-01] Slim typed fields instead of v.any() blob for libraryItems (enforces 1-2 KB at schema level)
- [22-01] All Phase 23 indexes defined upfront (zero cost, avoids second schema migration)
- [22-01] searchableText concatenated field for Phase 23 full-text search
- [22-01] Re-rate patches only rating/searchableText/updatedAt, preserves original metadata and savedAt
- [22-02] Fire-and-forget mutation pattern -- Zustand optimistic, Convex failure logged but never blocks UI
- [22-02] Rating removal (no-rating) does not call mutation -- library deletion is Phase 23 (LIB-07)
- [22-02] FocusMode looks up paper by ID from papers array rather than receiving as prop
- [23-01] Dual-path query: search mode (relevance via searchIndex) vs browse mode (custom sort via regular indexes)
- [23-01] convex-helpers filter() for rating >= N on both browse and search paths (pages may be undersized)
- [23-01] getLibraryCount uses .collect().length (acceptable for libraries up to 1024 items)
- [23-02] Bidirectional rating-library sync: removing from library clears Zustand stars, clearing stars removes from library
- [23-02] Added removeFromLibraryByOpenalexId mutation for RatingSelector to delete by openalexId (doesn't know Convex _id)
- [24-01] Debounce bridge pattern: rawSearch (local useState) syncs to URL param q via useEffect after 300ms debounce
- [24-01] null vs undefined convention: nuqs uses null to clear params, Convex uses undefined for optional args -- conversion at derivation point
- [27-01] Exact 1:1 copy of FilterSection to shared module preserving all motion animations for zero visual regression
- [27-01] X icon import kept in search-sidebar.tsx (used by collapsed sidebar clear-all buttons, not only FilterSection)
- [27-02] Keep flat row layout for list view (not card-based), only upgrade hover states to sidebar-accent pattern
- [27-02] Grid skeleton shows 6 items to match 3-column layout, list skeleton keeps 5 items
- [25-01] Junction table (libraryItemCollections) for many-to-many, not array fields on libraryItems
- [25-01] Alphabetical sort for listCollections via localeCompare (case-insensitive)
- [25-01] Cascade-delete junction rows in both removeFromLibrary and removeFromLibraryByOpenalexId
- [25-02] Non-existent/unowned collection filter returns empty results (not error) per RESEARCH Pitfall 5
- [25-02] Collection filter uses Set-based pre-fetch + convex-helpers filter() for both browse and search
- [25-02] getCollectionsWithCounts sorts alphabetically by name (case-insensitive)

### Roadmap Evolution

- Phase 27 added: Library UI Redesign — DRY shared components with search, match codebase patterns

### Pending Todos

None.

### Blockers/Concerns

- 9 human verification items pending Stripe test mode validation (from v1.1)
- 3 pre-existing TypeScript errors in test files (unrelated to milestone work)
- convex-test issue #50 (getUserIdentity bug) blocks auth-gated end-to-end testing
- Collection filter + text search combination: RESOLVED in 25-02 (Set-based pre-fetch + filter() pattern, same as rating filter)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | currently screening deducts points for each item, but translation does not, translation should be the same | 2026-02-28 | 3dcf772 | [1-currently-screening-deducts-points-for-e](./quick/1-currently-screening-deducts-points-for-e/) |

## Session Continuity

Last activity: 2026-03-01 - 25-02 completed (collection assignment, counts, filtered queries)
Stopped at: Completed 25-02-PLAN.md
Resume file: None
