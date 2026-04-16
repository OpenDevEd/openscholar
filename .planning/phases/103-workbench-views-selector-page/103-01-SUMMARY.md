---
phase: 103-workbench-views-selector-page
plan: 01
subsystem: ui, api
tags: [i18n, zustand, convex, useProtectedQuery, auth-safety, export]

requires:
  - phase: 101-workbench-primitives
    provides: Zustand view store v1 with columnVisibility and activeView
  - phase: 100-backend-wiring-tierselector-fix
    provides: Export query getExtractionResultsForExport

provides:
  - Phase 103 i18n keys seeded across all 6 locales (workbench, selector, export)
  - Zustand view store v2 with pageSize field (default 25) and migration
  - Auth-safe EvidenceQuote and JobMetricsPanel via useProtectedQuery (GAP-02 fix)
  - Export query with optional paperIds filter for filtered export (D-19)

affects: [103-02, 103-03, 103-04, 103-05]

tech-stack:
  added: []
  patterns: [useProtectedQuery for auth-safe component queries, Zustand persist migration v1->v2]

key-files:
  created: []
  modified:
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/ja.json
    - messages/zh.json
    - messages/hi.json
    - lib/store/extraction-results-view.ts
    - components/extraction/evidence-quote.tsx
    - components/extraction/job-metrics-panel.tsx
    - convex/extraction/queries.ts

key-decisions:
  - "pageSize default 25 matches existing pagination.perPage i18n pattern"
  - "paperIds filter uses Set<string> with String() conversion for reliable Id comparison"

patterns-established:
  - "Zustand persist v2 migration: spread previous state + add new field with default"
  - "useProtectedQuery destructured as { data: localName } for drop-in replacement of bare useQuery"

requirements-completed: [GAP-01, GAP-02, WB-08, WB-09]

duration: 5min
completed: 2026-04-16
---

# Phase 103 Plan 01: Foundations Summary

**Phase 103 i18n keys across 6 locales, Zustand store v2 with pageSize, GAP-02 useProtectedQuery fixes in EvidenceQuote/JobMetricsPanel, and export query paperIds filter for filtered export**

## Performance

- **Duration:** 4m 45s
- **Started:** 2026-04-16T12:42:06Z
- **Completed:** 2026-04-16T12:47:00Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Seeded all Phase 103 i18n keys (extraction.workbench.*, extraction.selector.*, extraction.export.exportFailed) across all 6 locale files
- Migrated Zustand view store from v1 to v2 with pageSize field (default 25), setPageSize action, and backward-compatible migration
- Fixed GAP-02: replaced bare useQuery with useProtectedQuery in EvidenceQuote and JobMetricsPanel to prevent unauthenticated data flash during Clerk auth transitions (T-103-02, T-103-03)
- Enhanced getExtractionResultsForExport with optional paperIds filter for filtered export (D-19), with auth check firing before filter

## Task Commits

Each task was committed atomically:

1. **Task 1: i18n keys + Zustand store v2 + GAP-02 fixes** - `db436b0` (feat)
2. **Task 2: Backend export query -- optional paperIds filter (D-19)** - `290e6d2` (feat)

## Files Created/Modified
- `messages/en-US.json` - Added extraction.workbench.*, extraction.selector.*, extraction.export.exportFailed keys
- `messages/en-GB.json` - Same keys as en-US (English variant)
- `messages/fr.json` - Same keys as en-US (placeholder for localization pass)
- `messages/ja.json` - Same keys as en-US (placeholder for localization pass)
- `messages/zh.json` - Same keys as en-US (placeholder for localization pass)
- `messages/hi.json` - Same keys as en-US (placeholder for localization pass)
- `lib/store/extraction-results-view.ts` - Added pageSize to state/partialize, setPageSize action, v1->v2 migration, bumped version
- `components/extraction/evidence-quote.tsx` - Replaced useQuery with useProtectedQuery (GAP-02)
- `components/extraction/job-metrics-panel.tsx` - Replaced useQuery with useProtectedQuery (GAP-02)
- `convex/extraction/queries.ts` - Added optional paperIds arg and filter to getExtractionResultsForExport

## Decisions Made
- pageSize default of 25 aligns with the existing pagination.perPage i18n pattern used elsewhere in the codebase
- paperIds filter uses `new Set(args.paperIds.map(String))` with `String(p._id)` comparison for reliable Convex Id matching
- Non-English locales receive en-US text as placeholders (standard codebase practice; localization is a separate pass)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript error in `tests/crash-prevention/prompt-delimiters.test.ts` (regex flag targeting issue) -- confirmed present on base commit, not caused by this plan's changes. Out of scope per deviation rules.
- `tests/extraction-i18n-coverage.test.ts` referenced in plan verification does not exist yet -- not a blocker as the i18n keys were verified directly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Phase 103 i18n keys are seeded and available for Plans 02-05 to use immediately
- View store v2 with pageSize ready for workbench pagination (Plan 02: table view)
- GAP-02 closed: EvidenceQuote safe for Plan 04 evidence drawer mounting
- Export query paperIds filter ready for Plan 03 filtered export UI

---
*Phase: 103-workbench-views-selector-page*
*Completed: 2026-04-16*
