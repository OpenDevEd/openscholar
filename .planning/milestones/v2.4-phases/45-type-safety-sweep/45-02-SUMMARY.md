---
phase: 45-type-safety-sweep
plan: 02
subsystem: api
tags: [convex, validators, type-safety, extraction, runtime-validation]

# Dependency graph
requires:
  - phase: 45-01
    provides: "Shared document validators in convex/extraction/validators.ts"
provides:
  - "All 11 extraction query return validators fully typed (zero v.any())"
  - "statusResultValidator pattern adopted across all extraction queries"
affects: [extraction-queries, runtime-validation]

# Tech tracking
tech-stack:
  added: []
  patterns: ["statusResultValidator wrapping for all auth-gated query returns", "Inline computed-shape validators for aggregate/insight responses"]

key-files:
  created: []
  modified:
    - "convex/extraction/queries.ts"

key-decisions:
  - "Used statusResultValidator helper for all auth-gated queries instead of manual v.union patterns"
  - "Kept computed/aggregate validators inline in queries rather than extracting to validators.ts"
  - "getJobInsights returns { id, name } for job (not full document) to match handler's computed shape"
  - "entityDistribution kept as non-optional v.array since aggregate always returns it (empty array for non-array types)"

patterns-established:
  - "statusResultValidator pattern: all extraction queries use statusResultValidator({...fields}) instead of manual v.union of ok/unauthenticated/no_access"
  - "Inline validators for computed shapes: aggregated/transformed data uses inline v.object() rather than shared validators"

requirements-completed: [TYPE-02]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Phase 45 Plan 02: Extraction Query Return Validators Summary

**All 11 extraction query return validators replaced from v.any() to fully typed Convex validators using shared document validators and inline computed-shape validators**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T05:44:47Z
- **Completed:** 2026-03-03T05:48:15Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Replaced v.any() in all 11 extraction query return validators with typed validators
- Adopted statusResultValidator pattern across all auth-gated extraction queries
- Zero new TypeScript errors; all 701 tests pass
- Only schema-level v.any() (searchFilters record values) and pagination wrapper remain

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace v.any() in queries 1-6 (document-heavy queries)** - `b99673e` (feat)
2. **Task 2: Replace v.any() in queries 7-11 and verify full suite** - `f029493` (feat)

## Files Created/Modified
- `convex/extraction/queries.ts` - All 11 extraction query return validators replaced with typed validators

## Decisions Made
- Used `statusResultValidator` helper for all auth-gated queries, replacing manual `v.union(v.object({status: "ok", ...}), ...)` patterns -- cleaner and consistent
- Kept computed/aggregate validators inline in queries (e.g., getJobInsights summary, question aggregates) rather than extracting to validators.ts, following the plan's anti-pattern guidance
- getJobInsights `job` field uses `v.object({ id: v.id("extractionJobs"), name: v.string() })` instead of `extractionJobValidator` because the handler returns a computed subset
- entityDistribution in getQuestionInsights uses `v.array(...)` not `v.optional(v.array(...))` because `aggregateQuestionInsights` always returns an array (empty for non-array types)
- includeNotFound parameter used for getQuestionInsights and getQuestionDisagreements since their handlers call `notFound()`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TYPE-02 requirement fully satisfied
- Extraction queries are now runtime-validated by Convex
- Phase 45 complete -- all plans executed

## Self-Check: PASSED

- FOUND: convex/extraction/queries.ts
- FOUND: commit b99673e (Task 1)
- FOUND: commit f029493 (Task 2)
- FOUND: 45-02-SUMMARY.md

---
*Phase: 45-type-safety-sweep*
*Completed: 2026-03-03*
