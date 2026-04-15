---
phase: 98-pre-flight-hard-limit-foundation
plan: 02
status: completed
subsystem: extraction-limits
tags: [call-site-rewire, benchmark, payload-validation, per-user-limit]
dependency_graph:
  requires: [EXTRACTION_LIMITS_BY_TIER, MAX_EXTRACTION_RESULTS_QUERY, getExtractionLimitForUser]
  provides: [per-user-limit-enforcement, results-query-cap, payload-size-benchmark]
  affects: [convex/extraction/mutations.ts, convex/extraction/queries.ts]
tech_stack:
  added: []
  patterns: [per-user-limit-validation, dedicated-results-constant, getConvexSize-benchmark]
key_files:
  created:
    - convex/extraction/benchmark.test.ts
  modified:
    - convex/extraction/mutations.ts
    - convex/extraction/queries.ts
decisions:
  - "Batch size of 50 papers and 10 papers-worth-of-results per t.run() transaction to stay within convex-test transaction limits during benchmark seeding"
  - "Vitest timeout set to 120s per benchmark test to accommodate 1000-paper seeding (actual runtime ~6-10s per test)"
  - "Worst-case 500-char answers + 800-char reasoning benchmark included to document upper bound (10.31 MB) even though it exceeds 5 MB target -- confirms it stays under 16 MiB Convex hard cap"
metrics:
  duration_seconds: 342
  completed: "2026-04-15T16:13:16Z"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 98 Plan 02: Call-Site Rewiring and Payload Benchmark Summary

Per-user extraction limit enforcement in createExtractionJob, dedicated MAX_EXTRACTION_RESULTS_QUERY constant at all internal .take() sites, and 1000-paper payload benchmark proving 3.97 MB typical payload (under 5 MB target).

## What Was Built

- **Per-user limit enforcement** in `createExtractionJob`: replaced global `MAX_EXTRACTION_PAPERS_PER_JOB` validation with `getExtractionLimitForUser(ctx, user._id)` which resolves the limit from the user's subscription plan via the tier map.
- **Dedicated results constant** at 2 internal `.take()` sites: `finalizeJobIfDone` and `getExtractionJobMetrics` now use `MAX_EXTRACTION_RESULTS_QUERY` (10,000) instead of `MAX_EXTRACTION_PAPERS_PER_JOB * 10`. This decouples internal query safety from the user-facing paper cap.
- **Payload size benchmark** (`benchmark.test.ts`): seeds 1000 papers x 7 questions with realistic field sizes and measures serialized payload via `getConvexSize`. Two test cases:
  - Typical (150-char answers, 200-char reasoning): **3.97 MB** -- PASS at 5 MB target
  - Worst-case (500-char answers, 800-char reasoning): **10.31 MB** -- PASS at 16 MiB Convex hard cap

## Key Decisions

1. Batched seeding in benchmark: 50 papers per transaction for paper creation, 10 papers per transaction for results seeding. This avoids convex-test transaction limits while keeping the test deterministic.
2. Worst-case test documents the upper bound (10.31 MB) but asserts against the 16 MiB Convex hard cap, not the 5 MB target. This is intentional -- it proves no Convex error even with extreme field sizes, while the typical test gates the 5 MB safety target.
3. The 7 existing sites using `MAX_EXTRACTION_PAPERS_PER_JOB` (for paper-count bounds) were intentionally left unchanged per the plan's call-site audit.

## Artifacts

| File | Action | Description |
|------|--------|-------------|
| `convex/extraction/mutations.ts` | modified | Per-user limit via getExtractionLimitForUser in createExtractionJob; MAX_EXTRACTION_RESULTS_QUERY in finalizeJobIfDone |
| `convex/extraction/queries.ts` | modified | MAX_EXTRACTION_RESULTS_QUERY in getExtractionJobMetrics |
| `convex/extraction/benchmark.test.ts` | created | 1000-paper x 7-question payload benchmark with getConvexSize measurement |

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `f1313d6` | Rewire extraction call sites to per-user limits and dedicated results constant |
| 2 | `27f9389` | Add 1000-paper payload size benchmark for GAP-04 |

## Verification

- TypeScript compilation: PASS (zero errors in mutations.ts and queries.ts)
- Zero instances of `MAX_EXTRACTION_PAPERS_PER_JOB * 10`: PASS
- `createExtractionJob` uses `getExtractionLimitForUser(ctx, user._id)`: PASS
- `finalizeJobIfDone` uses `.take(MAX_EXTRACTION_RESULTS_QUERY)`: PASS
- `getExtractionJobMetrics` uses `.take(MAX_EXTRACTION_RESULTS_QUERY)`: PASS
- Benchmark test (typical payload): 3.97 MB < 5 MB -- PASS
- Benchmark test (worst-case payload): 10.31 MB < 16 MiB -- PASS
- Benchmark logs exact byte sizes: PASS (4,159,789 bytes typical; 10,809,789 bytes worst-case)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `createdAt` and `updatedAt` to subscription seed**
- **Found during:** Task 2
- **Issue:** The `subscriptions` table schema requires `createdAt` and `updatedAt` fields, but the initial seed helper omitted them, causing validator error.
- **Fix:** Added `createdAt: Date.now()` and `updatedAt: Date.now()` to the `seedSubscription` helper.
- **Files modified:** `convex/extraction/benchmark.test.ts`
- **Commit:** `27f9389`

**2. [Rule 3 - Blocking] Fixed Vitest timeout syntax for v3.2.4+**
- **Found during:** Task 2
- **Issue:** Vitest 3.2.4 deprecates passing options as the third argument to `it()`. The correct pattern is `it(name, options, fn)` with options as the second argument.
- **Fix:** Moved `{ timeout: 120_000 }` from third argument to second argument position.
- **Files modified:** `convex/extraction/benchmark.test.ts`
- **Commit:** `27f9389`

**3. [Rule 3 - Blocking] Added `modules` glob to benchmark test**
- **Found during:** Task 2
- **Issue:** `convex-test@0.0.46` requires the modules glob to locate the `_generated` directory. `convexTest(schema)` without modules fails with "Could not find the _generated directory".
- **Fix:** Added `const modules = import.meta.glob("../**/*.ts")` and passed as second argument: `convexTest(schema, modules)`.
- **Files modified:** `convex/extraction/benchmark.test.ts`
- **Commit:** `27f9389`

## Known Stubs

None -- all call sites are fully wired to production constants and helpers.

## Threat Surface Scan

No new threat flags. All changes align with the plan's threat model:
- T-98-05 (mitigated): `createExtractionJob` now validates against per-user subscription limit, preventing privilege escalation.
- T-98-06 (mitigated): `.take(MAX_EXTRACTION_RESULTS_QUERY)` caps internal result scanning at 10,000 rows.
- T-98-07 (accepted): Benchmark test uses only synthetic data in test harness, no production impact.
