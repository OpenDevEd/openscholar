---
phase: 96-eval-loop-quality-sampling
plan: 02
subsystem: extraction/quality-sampling
tags: [quality-sampling, cron, critic, review-queue, eval-loop]
dependency_graph:
  requires: [extractionResults, extractionPapers, extractionJobs, buildCriticPrompt]
  provides: [qualityChecks-table, quality-sampling-cron, quality-trend-query, review-queue-query, review-status-mutation]
  affects: [convex/schema.ts, convex/crons.ts, convex/extraction/queries.ts, convex/extraction/mutations.ts]
tech_stack:
  added: []
  patterns: [internalAction-with-separate-helpers, hourly-cron-sampling, auth-gated-quality-queries]
key_files:
  created:
    - convex/extraction/qualitySampling.ts
    - convex/extraction/qualitySamplingHelpers.ts
  modified:
    - convex/schema.ts
    - convex/crons.ts
    - convex/extraction/validators.ts
    - convex/extraction/queries.ts
    - convex/extraction/mutations.ts
decisions:
  - Separate "use node" action from query/mutation helpers per Convex Pitfall 6
  - Use existing buildCriticPrompt and criticOutputSchema pattern from extract.ts
  - Unsupported verdicts auto-land in review queue with pending status
  - updateReviewStatus only allows reviewed/promoted transitions (cannot reset to pending)
metrics:
  duration: 5m31s
  completed: "2026-04-15T09:43:16Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 5
requirements: [EVAL-04, EVAL-05, EVAL-06]
---

# Phase 96 Plan 02: Quality Sampling Backend Summary

Hourly cron-driven production quality sampling with critic re-run, 7-day trend query, and human-review queue for extraction answer verification.

## Task Completion

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add qualityChecks table and reviewStatus validator | a7693f7 | convex/schema.ts, convex/extraction/validators.ts |
| 2 | Create qualitySampling action and register hourly cron | 64cb2b2 | convex/extraction/qualitySampling.ts, convex/extraction/qualitySamplingHelpers.ts, convex/crons.ts |
| 3 | Add quality trend query, review queue, and review status mutation | 7b64925 | convex/extraction/queries.ts, convex/extraction/mutations.ts |

## What Was Built

### qualityChecks Table (EVAL-04)
New schema table with `answerId`, `verdict`, `judgeModel`, `timestamp`, `reviewStatus` fields and `by_answerId`/`by_timestamp` indexes. Stores results of hourly critic re-runs on production extraction answers.

### Hourly Sampling Cron (EVAL-04)
- `sampleAndCheck` internalAction picks 1 random eligible extraction result (has criticVerdict, not sampled in last 7 days)
- Re-runs the critic via OpenRouter using `buildCriticPrompt` infrastructure
- Writes verdict to qualityChecks with auto-assigned reviewStatus (unsupported -> pending, others -> reviewed)
- Early-returns silently when no eligible results exist (D-14)
- 30s AbortSignal timeout on LLM calls

### Architecture: Separate Files for "use node" Compliance
- `qualitySampling.ts` ("use node") -- only exports the internalAction
- `qualitySamplingHelpers.ts` (no "use node") -- exports 3 internalQueries and 1 internalMutation for DB access
- This follows Convex Pitfall 6: "use node" files cannot export queries or mutations

### Quality Trend Query (EVAL-05)
- `getQualityTrend` returns 7-day rolling `{supported, unsupported, partial, total, passRate}`
- Auth-gated via `getCurrentUser`, returns null for unauthenticated requests
- Uses `by_timestamp` index with `.take(1000)` bound

### Review Queue Query (EVAL-06)
- `getReviewQueue` returns pending items joined with answer, question text, and paper title
- Auth-gated, bounded to 100 items, most recent first
- Each join is a single `ctx.db.get()` by ID (T-96-08)

### Review Status Mutation (EVAL-06)
- `updateReviewStatus` allows `reviewed` or `promoted` transitions only
- Cannot reset to `pending` (T-96-05 tampering mitigation)
- Auth-gated via `requireAuth`, NOT_FOUND error for missing checks

### Validator
- `reviewStatusValidator` (pending/reviewed/promoted) exported from validators.ts

## Deviations from Plan

None -- plan executed exactly as written.

## Threat Mitigations Verified

| Threat ID | Mitigation | Verified |
|-----------|-----------|----------|
| T-96-04 | getCurrentUser null check on getQualityTrend and getReviewQueue | Yes |
| T-96-05 | requireAuth + v.union(v.literal("reviewed"), v.literal("promoted")) on updateReviewStatus | Yes |
| T-96-07 | writeQualityCheck is internalMutation (not callable from client) | Yes |
| T-96-08 | .take(100) bound on getReviewQueue, single ctx.db.get per join | Yes |

## Self-Check: PASSED

All files exist, all commits verified:
- a7693f7: qualityChecks table + reviewStatusValidator
- 64cb2b2: qualitySampling action + cron
- 7b64925: quality trend/review queries + review status mutation
