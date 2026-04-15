---
phase: 95-structured-observability-slo-metrics
plan: 01
subsystem: observability
tags: [structured-logging, ulid, extraction, cost-tracking, slo-metrics]

# Dependency graph
requires:
  - phase: 89-core-schema-workflow-skeleton
    provides: extractionJobs table, extraction pipeline schema
  - phase: 93-workflow-cancel-retry-and-progress
    provides: error classification module (errors.ts, ErrorCategory type)
provides:
  - "Structured logging module (emitStageLog, emitStageError, computeCostUsd)"
  - "COST_PER_MILLION_TOKENS map for 3 cascade models"
  - "ExtractionStage, StageLogParams, StageErrorParams type exports"
  - "traceId field on extractionJobs schema (ULID, generated at job creation)"
  - "citationValidityRate and recallOnInclude SLO fields on extractionJobs"
  - "getJobInternal returns traceId for downstream pipeline consumers"
affects: [95-02, 95-03, 95-04, extraction-pipeline, workpoolActions, extract]

# Tech tracking
tech-stack:
  added: [ulid]
  patterns: [structured-json-logging, cost-map-const, ulid-trace-correlation]

key-files:
  created:
    - convex/extraction/logging.ts
    - convex/extraction/logging.test.ts
  modified:
    - convex/schema.ts
    - convex/extraction/mutations.ts
    - convex/extraction/queries.ts
    - package.json

key-decisions:
  - "Pure function logging module with zero Convex runtime imports (only Id type)"
  - "ULID for traceId (monotonic, sortable, crypto-random) generated server-side in mutation"
  - "SLO fields (citationValidityRate, recallOnInclude) are optional to support existing jobs"

patterns-established:
  - "Structured JSON logging: single console.info/console.error call per stage event, grep-friendly"
  - "Cost map pattern: COST_PER_MILLION_TOKENS Record<string, {input, output}> for OpenRouter pricing"
  - "Trace correlation: ULID traceId persisted on job row, threaded through all pipeline logs"

requirements-completed: [OBS-01, OBS-02, OBS-03]

# Metrics
duration: 4min
completed: 2026-04-15

# TDD Gate Compliance
tdd_gates:
  red: 0ecc76e
  green: a91e26d
  refactor: null
---

# Phase 95 Plan 01: Structured Logging Foundation Summary

**Structured JSON logging module with cost map for 3 cascade models, ULID traceId on extractionJobs, and SLO metric fields**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-15T08:04:34Z
- **Completed:** 2026-04-15T08:08:57Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created `logging.ts` pure function module with `emitStageLog`, `emitStageError`, `computeCostUsd` and verified OpenRouter pricing for all 3 cascade models
- Extended `extractionJobs` schema with `traceId`, `citationValidityRate`, `recallOnInclude` optional fields
- ULID generation wired into `createExtractionJob` mutation for trace correlation
- `getJobInternal` updated to return `traceId` for downstream pipeline consumers
- Full TDD coverage: 10 passing tests in `logging.test.ts`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create logging.ts module with TDD**
   - RED: `0ecc76e` (test) - 10 failing tests for logging module
   - GREEN: `a91e26d` (feat) - logging.ts implementation, all tests pass
2. **Task 2: Extend schema + generate ULID traceId** - `06eae79` (feat)

## Files Created/Modified
- `convex/extraction/logging.ts` - Structured logging helpers, cost map, type exports
- `convex/extraction/logging.test.ts` - 10 test cases covering all exports
- `convex/schema.ts` - Added traceId, citationValidityRate, recallOnInclude to extractionJobs
- `convex/extraction/mutations.ts` - Added ulid import and traceId generation in createExtractionJob
- `convex/extraction/queries.ts` - getJobInternal returns traceId
- `package.json` - Added ulid dependency
- `pnpm-lock.yaml` - Lock file updated

## Decisions Made
- Pure function logging module with zero Convex runtime imports (only Id type) -- matches errors.ts pattern for testability
- ULID chosen for traceId (monotonic, sortable, crypto-random via crypto.getRandomValues in V8 runtime)
- SLO fields are v.optional() to support existing jobs without migration
- Cost map uses Record<string, {input, output}> for clean lookup with 0 fallback for unknown models

## Deviations from Plan

None - plan executed exactly as written.

## TDD Gate Compliance

- RED gate: `0ecc76e` (test commit with 10 failing tests)
- GREEN gate: `a91e26d` (feat commit, all 10 tests passing)
- REFACTOR gate: skipped (no refactoring needed for this simple module)

## Issues Encountered

- `convex/extraction/mutations.test.ts` fails due to pre-existing `convex-test` edge-runtime infrastructure issue (`_generated` directory not found in worktree). Verified this failure exists on the base commit before any changes -- not caused by this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `logging.ts` exports are ready for consumption by `workpoolActions.ts` and `extract.ts` (Plan 02/03)
- `traceId` is generated at job creation and available via `getJobInternal` for pipeline correlation
- `citationValidityRate` and `recallOnInclude` fields ready for Plan 03 (SLO computation)

## Self-Check: PASSED

- All created files exist (logging.ts, logging.test.ts)
- All 3 commits found (0ecc76e, a91e26d, 06eae79)
- All schema fields present (traceId, citationValidityRate, recallOnInclude)
- All 7 logging exports present (emitStageLog, emitStageError, computeCostUsd, COST_PER_MILLION_TOKENS, ExtractionStage, StageLogParams, StageErrorParams)

---
*Phase: 95-structured-observability-slo-metrics*
*Completed: 2026-04-15*
