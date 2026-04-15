---
phase: 95-structured-observability-slo-metrics
plan: 02
subsystem: observability
tags: [structured-logging, traceId-propagation, extraction-pipeline, timing-instrumentation]

# Dependency graph
requires:
  - phase: 95-structured-observability-slo-metrics
    plan: 01
    provides: "emitStageLog, emitStageError, computeCostUsd from logging.ts; traceId on extractionJobs schema"
  - phase: 93-workflow-cancel-retry-and-progress
    provides: "classifyExtractionError from errors.ts"
provides:
  - "traceId propagation from job row through enqueue to workpool action args"
  - "Structured JSON logging replacing all ad-hoc [ExtractionPipeline] and [ExtractionWorkflow] strings"
  - "Timing instrumentation on all four extraction stages (parse, extract, critic, save)"
  - "Critic stage structured logging inside extractSingleAnswer"
  - "traceId/jobId/paperId threading from extractAnswers to extractSingleAnswer"
affects: [95-03, 95-04, extraction-pipeline, incident-triage]

# Tech tracking
tech-stack:
  added: []
  patterns: [traceId-propagation, stage-timing-instrumentation, structured-error-logging]

key-files:
  created: []
  modified:
    - convex/extraction/mutations.ts
    - convex/extraction/workflow.ts
    - convex/extraction/workpoolActions.ts
    - convex/extraction/extract.ts

key-decisions:
  - "traceId read once from job row in enqueueAllPapers, not per-paper in the loop"
  - "Guard-clause warnings (job not found, paper not found, etc.) use inline JSON.stringify rather than emitStageLog since they lack paperId context"
  - "extractAnswers and extractSingleAnswer accept traceId/jobId/paperId as optional params for backward compatibility with tests"
  - "Critic stage logging gated on traceId && jobId && paperId to avoid errors when called without pipeline context"
  - "[ExtractionCascade] per-tier retry warnings in extract.ts left as-is -- they are cascade-internal retry signals, not pipeline-stage logs"

patterns-established:
  - "traceId propagation: job row -> enqueueAllPapers -> workpool action args -> extractAnswers -> extractSingleAnswer -> every structured log"
  - "Stage timing: const stageStartMs = Date.now(); ... const stageLatencyMs = Date.now() - stageStartMs; emitStageLog({latencyMs})"
  - "Guard-clause structured logging: console.warn(JSON.stringify({ event: name, traceId })) for non-stage events"

requirements-completed: [OBS-01, OBS-02, OBS-03]

# Metrics
duration: 7min
completed: 2026-04-15
---

# Phase 95 Plan 02: Extraction Pipeline Structured Logging Summary

**traceId threaded through entire extraction pipeline with structured JSON logging on all four stages (parse, extract, critic, save) and timing instrumentation**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-15T08:12:55Z
- **Completed:** 2026-04-15T08:19:42Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- traceId flows end-to-end: job row -> enqueueAllPapers -> workpool action args -> extractAnswers -> extractSingleAnswer -> every log call
- All 6+ ad-hoc `[ExtractionPipeline]` console.log/error calls replaced with `emitStageLog`/`emitStageError`
- All 3 `[ExtractionWorkflow]` console.log calls replaced with structured `console.info(JSON.stringify(...))`
- All four extraction stages instrumented with `Date.now()` timing deltas (parse, extract, critic, save)
- Critic stage inside `extractSingleAnswer` emits structured logs on both success and failure paths
- Guard-clause warnings (job not found, paper not found, no questions, credits exhausted, terminal skip) converted to structured JSON

## Task Commits

Each task was committed atomically:

1. **Task 1: Propagate traceId through workflow and enqueue** - `a5b8429` (feat)
2. **Task 2: Replace all ad-hoc logs with structured logging and timing** - `59b6fe1` (feat)

## Files Created/Modified
- `convex/extraction/mutations.ts` - traceId read from job row and passed in enqueue args; workflow_start_failed structured log
- `convex/extraction/workflow.ts` - 3 ad-hoc [ExtractionWorkflow] logs replaced with structured JSON console.info
- `convex/extraction/workpoolActions.ts` - traceId in action args, 4 emitStageLog calls, 3 emitStageError calls, 5 guard-clause warnings converted to structured JSON, timing instrumentation (parseStartMs, extractStartMs, saveStartMs)
- `convex/extraction/extract.ts` - traceId/jobId/paperId threaded from extractAnswers to extractSingleAnswer, critic stage emitStageLog on success, emitStageError on failure, criticStartMs timing

## Decisions Made
- traceId read once from job row before the paper loop in enqueueAllPapers (not per-iteration) for efficiency
- Guard-clause warnings use inline JSON.stringify since they lack paperId context needed for emitStageLog
- Optional traceId/jobId/paperId parameters on extractAnswers and extractSingleAnswer maintain backward compatibility with existing test call sites
- Critic stage logging is gated on `if (traceId && jobId && paperId)` to avoid errors when called without pipeline context (e.g., in tests)
- [ExtractionCascade] per-tier retry warnings in extract.ts left unchanged -- these are cascade-internal retry signals, not pipeline-stage logs targeted by OBS-01

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `convex/extraction/mutations.test.ts` fails due to pre-existing `convex-test` infrastructure issue (`_generated` directory not found in worktree). Verified this failure exists on the base commit before any changes -- not caused by this plan. Documented in 95-01-SUMMARY.md as well.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All extraction pipeline logs are now structured JSON with traceId -- ready for Plan 03 (SLO computation on top of structured data)
- Timing instrumentation on all four stages enables latency-based SLO alerting in Plan 04
- `computeCostUsd` is called in extraction success/failure paths, providing cost data for Plan 03 aggregation

## Self-Check: PASSED

- All 4 modified files exist (mutations.ts, workflow.ts, workpoolActions.ts, extract.ts)
- Both commits found (a5b8429, 59b6fe1)
- 4 emitStageLog calls in workpoolActions.ts (parse success, parse skip, save, extract success)
- 3 emitStageError calls in workpoolActions.ts (no bodyText, all questions failed, classified error)
- 0 occurrences of [ExtractionPipeline] in workpoolActions.ts
- 0 occurrences of [ExtractionWorkflow] in workflow.ts
- traceId: v.string() in action args
- criticStartMs timing variable in extract.ts (3 references)
- stage: "critic" in extract.ts (2 locations: success + failure)

---
*Phase: 95-structured-observability-slo-metrics*
*Completed: 2026-04-15*
