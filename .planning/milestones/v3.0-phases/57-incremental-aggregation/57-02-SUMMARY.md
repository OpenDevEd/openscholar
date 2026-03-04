---
phase: 57-incremental-aggregation
plan: 02
subsystem: database
tags: [convex, incremental-aggregation, extraction, fast-path, report-metrics, backfill]

requires:
  - phase: 57-incremental-aggregation-01
    provides: extractionJobStats table with incremental upsert and cascade delete
provides:
  - Fast-path stats read in getJobInsights summary section
  - Stats-backed metrics in createExtractionReportSnapshot
  - backfillJobStats internal mutation for legacy completed jobs
affects: [extraction report queries, extraction pipeline, future stats consumers]

tech-stack:
  added: []
  patterns: [fast-path-with-fallback, lazy-backfill-on-first-access, scope-guard-for-stats]

key-files:
  created: []
  modified:
    - convex/extraction/queries.ts
    - convex/extraction/mutations.ts

key-decisions:
  - "Stats fast path only for summary counters in getJobInsights; per-question detail still requires fan-out"
  - "Stats bypassed when report has paper-level or question-level scope filtering"
  - "Backfill triggered from createExtractionReportSnapshot (mutation context) not getJobInsights (query context, read-only)"
  - "avgEffectiveConfidence and diagnostics (noContentCount, abstractOnlyCount) always from fan-out since stats do not track these"

patterns-established:
  - "Fast-path with fallback: query stats first, use when count matches, else fall back to existing computation"
  - "Scope guard: stats only valid for unscoped whole-job aggregation, skip when filteredPaperIds or selectedQuestionKeys present"
  - "Lazy backfill: schedule backfillJobStats from mutation context on first report access for legacy jobs"

requirements-completed: [PERF-06]

duration: 5min
completed: 2026-03-04
---

# Phase 57 Plan 02: Fast-Path Reads and Backfill Summary

**getJobInsights and createExtractionReportSnapshot read from pre-aggregated extractionJobStats with fan-out fallback and lazy backfill for legacy jobs**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-04T07:00:11Z
- **Completed:** 2026-03-04T07:05:51Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- getJobInsights summary section reads pre-aggregated counters from extractionJobStats when stats exist and match question count, bypassing summary aggregation loops
- createExtractionReportSnapshot metrics section uses stats for answeredRate/groundedRate/bestEffortRate when available and unscoped (no paper-level or question-level filtering)
- backfillJobStats internal mutation computes and persists stats from existing results for legacy completed jobs, triggered on first report creation
- Scoped report snapshots (filteredPaperIds or selectedQuestionKeys) correctly fall back to fan-out computation

## Task Commits

Each task was committed atomically:

1. **Task 1: Add fast-path stats read to getJobInsights** - `19a9288` (feat)
2. **Task 2: Stats-backed metrics in createExtractionReportSnapshot and backfill mutation** - `e11e507` (feat)

## Files Created/Modified
- `convex/extraction/queries.ts` - Fast-path stats read in getJobInsights with conditional summary counters
- `convex/extraction/mutations.ts` - Stats-backed metrics in createExtractionReportSnapshot, backfillJobStats internal mutation, lazy backfill scheduler

## Decisions Made
- Stats fast path only applies to summary counters in getJobInsights; the per-question detail arrays (topAnswers, entityDistribution, reviewed) still require the full fan-out since stats don't decompose individual answer values
- Backfill triggered from createExtractionReportSnapshot (mutation context where scheduling is allowed) rather than getJobInsights (query context, read-only in Convex)
- Stats bypassed when report has scope filtering (filteredPaperIds or selectedQuestionKeys) because stats represent whole-job aggregation only
- avgEffectiveConfidence and diagnostics fields (noContentCount, abstractOnlyCount) always come from the fan-out path since the stats table doesn't track these

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript errors in unrelated files (convex/crons.ts, convex/apiKeys/, convex/zotero/, convex/lib/envValidation.ts) about missing `audit` and `envValidation` modules. These are from undeployed phases and are out of scope. No new TS errors introduced by this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All fast-path read optimizations for extraction stats are in place
- Phase 57 (incremental aggregation) is fully complete: stats table, incremental upsert, cascade delete, fast-path reads, backfill
- Ready for Phase 58 or deployment

## Self-Check: PASSED

All files verified present, all commits verified in git log.

---
*Phase: 57-incremental-aggregation*
*Completed: 2026-03-04*
