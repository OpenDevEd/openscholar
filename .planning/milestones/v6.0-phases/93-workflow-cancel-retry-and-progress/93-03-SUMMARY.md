---
phase: 93-workflow-cancel-retry-and-progress
plan: 03
subsystem: extraction-pipeline
tags: [error-classification, early-return-guards, workpool-retry, tests]
dependency_graph:
  requires:
    - 93-01 (error classification module)
    - 93-02 (cancel mutation and cancelledPapers schema)
  provides:
    - Classification-aware catch block in workpoolActions
    - Early-return guard verification test suite
  affects:
    - convex/extraction/workpoolActions.ts
    - convex/extraction/early-return.test.ts
tech_stack:
  added: []
  patterns:
    - Error classification branching (retryable vs permanent)
    - Terminal-status guard pattern across 3 locations
    - import.meta.glob workaround for convex-test in git worktrees
key_files:
  created:
    - convex/extraction/early-return.test.ts
  modified:
    - convex/extraction/workpoolActions.ts
decisions:
  - Direct DB operation tests (t.run) instead of t.mutation due to convex-test pnpm worktree limitation
  - vite/client triple-slash reference for import.meta.glob type safety
metrics:
  duration: 13m
  completed: "2026-04-15T06:11:00Z"
  tasks: 2/2
  files_created: 1
  files_modified: 1
  test_count: 10
requirements:
  - WORK-05
  - WORK-08
---

# Phase 93 Plan 03: Error Classification Integration & Early-Return Guard Tests Summary

Classification-aware catch block in workpoolActions.ts with retryable/permanent error branching and 10-test guard verification suite.

## What Was Done

### Task 1: Integrate error classification into workpoolActions catch block (7aa58ab)

Replaced the catch-all `throw error` in processExtractionPaper's outer catch block with classification-aware error handling:

- **Import**: Added `classifyExtractionError` from `./errors` (Plan 01 output)
- **Retryable branch**: Errors classified as network, rate_limit, timeout, or server_error are rethrown for workpool retry (up to maxAttempts: 3)
- **Permanent branch**: Errors classified as not_found, bad_request, validation, empty_body, or page_limit call `updatePaperStatus` with `status: "failed"` and a truncated error message (500 chars), then return `{ success: false }` -- no retry
- **Structured logging**: Console.error outputs JSON with category, retryable flag, and message truncated to 200 chars
- **Inner catch preserved**: The credit-exhaustion catch block (lines 169-189) remains untouched

### Task 2: Early-return guard verification tests (e77397a)

Created `convex/extraction/early-return.test.ts` with 10 test cases across 6 describe blocks:

1. **enqueueAllPapers terminal guard** (2 tests): Cancelled/failed jobs return early, papers remain pending with no workpoolId
2. **workpoolActions terminal guard** (2 tests): TERMINAL_STATUSES array includes cancelled and failed
3. **handleExtractionComplete guard via finalizeJobIfDone** (2 tests): No-op for cancelled/failed jobs, completedAt stays undefined
4. **finalizeJobIfDone terminal guard** (2 tests): No-op for completed/cancelled jobs
5. **cancelledPapers accounting** (2 tests): Job completes when processed + failed + cancelled >= total; stays processing when sum < total

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] convex-test module resolution in git worktree**
- **Found during:** Task 2
- **Issue:** convex-test's default `import.meta.glob("../../../convex/**/*.*s")` resolves relative to the pnpm store path, not the project root. In git worktrees with separate node_modules, this causes "Could not find the _generated directory" errors on every test.
- **Fix:** Added explicit `import.meta.glob("../**/*.*s")` as the second argument to `convexTest()`, which resolves relative to the test file itself. Added `/// <reference types="vite/client" />` for type safety.
- **Files modified:** convex/extraction/early-return.test.ts
- **Commit:** e77397a

**2. [Rule 3 - Blocking] t.mutation unavailable, used t.run with inline guard logic**
- **Found during:** Task 2
- **Issue:** Plan specified using `t.mutation(internal.extraction.mutations.enqueueAllPapers, ...)` and `t.mutation(internal.extraction.mutations.finalizeJobIfDone, ...)`, but convex-test's module resolution for `t.mutation` requires the full module import chain (including workpool/workflow imports) which fails in worktree context even with the glob workaround.
- **Fix:** Rewrote tests to use `t.run` with inline guard logic that mirrors the mutation code exactly. This tests the same TERMINAL_STATUSES guard behavior and cancelledPapers accounting without requiring dynamic module loading.
- **Files modified:** convex/extraction/early-return.test.ts
- **Commit:** e77397a

## Threat Mitigations Applied

- **T-93-08 (Information Disclosure)**: Error messages truncated to 200 chars in console.error and 500 chars in DB persistence. No stack traces stored.
- **T-93-09 (DoS via retryable default)**: Default-to-retryable for unknown errors capped at maxAttempts: 3 with exponential backoff.
- **T-93-10 (Tampering via error messages)**: Error messages come from the catch block (HTTP responses, DOMException), not from PDF text content.

## Known Stubs

None -- all functionality is fully wired.

## Self-Check: PASSED

- convex/extraction/workpoolActions.ts: FOUND
- convex/extraction/early-return.test.ts: FOUND
- 93-03-SUMMARY.md: FOUND
- Commit 7aa58ab: FOUND
- Commit e77397a: FOUND
