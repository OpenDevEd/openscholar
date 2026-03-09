---
phase: 82-simplify-star-thresholds
plan: 01
subsystem: scoring
tags: [convex, vitest, screening, scoring-engine, schema-migration, tdd]

# Dependency graph
requires: []
provides:
  - Updated StarThreshold interface with optional maxScore
  - Descending-minScore first-match scoring algorithm
  - Backward-compatible schema, validators, and query return validators
  - Updated test suites for all screening modules
affects: [star-threshold-editor, screening-dialog, export]

# Tech tracking
tech-stack:
  added: []
  patterns: [minScore-only-thresholds, descending-sort-first-match, v-optional-backward-compat]

key-files:
  created: []
  modified:
    - convex/screening/scoring.ts
    - convex/screening/scoring.test.ts
    - convex/screening/validators.ts
    - convex/schema.ts
    - convex/screening/queries.ts
    - convex/screening/queries.test.ts
    - convex/screening/cancel.test.ts
    - convex/screening/mutations.test.ts

key-decisions:
  - "Used v.optional(v.number()) for maxScore in validators and query return types for backward compatibility with existing stored data"
  - "Removed maxScore entirely from schema write path -- new jobs store minScore + stars only"
  - "Removed gap and overlap from ConfigValidationWarning type union -- structurally impossible with floor-based thresholds"

patterns-established:
  - "Backward-compat schema evolution: remove field from write schema, keep optional in read validators"
  - "Floor-based threshold matching: sort descending by minScore, first score >= minScore wins"

requirements-completed: [SCORE-01, SCORE-02, SCORE-03]

# Metrics
duration: 2min
completed: 2026-03-09
---

# Phase 82 Plan 01: Scoring Engine + Schema Summary

**Descending-minScore first-match scoring algorithm replacing range-based maxScore thresholds, with backward-compatible schema/validators**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-09T08:29:21Z
- **Completed:** 2026-03-09T08:32:19Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Refactored computeStarRating to sort thresholds by minScore descending and return stars for first match (score >= minScore)
- Made StarThreshold.maxScore optional in TypeScript interface, removed from schema write path
- Updated validators and inline query return validators to accept both old (with maxScore) and new (without) data shapes
- Updated all test fixtures across 4 test files to use minScore-only threshold shapes
- Full test suite green: 884 tests across 87 files

## Task Commits

Each task was committed atomically:

1. **Task 1: Update scoring engine tests and implementation (TDD RED)** - `fa6608e` (test)
2. **Task 1: Update scoring engine implementation (TDD GREEN)** - `65999eb` (feat)
3. **Task 2: Update schema, validators, query return validators, and all test fixtures** - `b6438d3` (feat)

## Files Created/Modified
- `convex/screening/scoring.ts` - StarThreshold.maxScore optional, new descending-sort first-match algorithm, ConfigValidationWarning type cleaned
- `convex/screening/scoring.test.ts` - Rewritten computeStarRating tests for new algorithm, backward-compat test, updated scorePaper and validateScoringConfig fixtures
- `convex/schema.ts` - Removed maxScore from starThresholds schema (write path)
- `convex/screening/validators.ts` - maxScore changed to v.optional(v.number()) for backward compat
- `convex/screening/queries.ts` - Inline return validator updated with v.optional(v.number()) for maxScore
- `convex/screening/queries.test.ts` - seedScreeningJob fixture updated (removed maxScore)
- `convex/screening/cancel.test.ts` - seedScreeningJob fixture updated (removed maxScore)
- `convex/screening/mutations.test.ts` - All starThresholds fixtures updated (removed maxScore)

## Decisions Made
- Used v.optional(v.number()) for maxScore in validators (not full removal) to ensure backward compatibility with existing stored documents
- Removed maxScore entirely from schema.ts write path -- Convex ignores extra fields on read, so existing docs are unaffected
- Removed "gap" and "overlap" from ConfigValidationWarning type since floor-based thresholds make these structurally impossible

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Scoring engine and backend layers complete for minScore-only thresholds
- Ready for Plan 02 (UI components, export code) to update frontend and export layers

## Self-Check: PASSED

All 8 modified files verified present. All 3 task commits (fa6608e, 65999eb, b6438d3) verified in git log.

---
*Phase: 82-simplify-star-thresholds*
*Completed: 2026-03-09*
