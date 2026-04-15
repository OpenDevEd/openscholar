---
phase: 93-workflow-cancel-retry-and-progress
plan: 01
subsystem: extraction-errors
tags: [error-classification, pure-function, unit-tests, workpool-retry]
dependency_graph:
  requires: []
  provides: [classifyExtractionError, ErrorCategory, ClassifiedError]
  affects: [convex/extraction/workpoolActions.ts]
tech_stack:
  added: []
  patterns: [pure-function-module, priority-ordered-classification]
key_files:
  created:
    - convex/extraction/errors.ts
    - convex/extraction/errors.test.ts
  modified: []
decisions:
  - Default-to-retryable fallback for unknown errors (safe: maxAttempts 3 caps wasted retries)
  - Case-insensitive regex matching for HTTP status text patterns
  - DOMException checked before string patterns (priority order prevents misclassification)
metrics:
  duration_seconds: 150
  completed: "2026-04-15T05:45:32Z"
  tasks: 2
  files_created: 2
  files_modified: 0
  test_count: 17
  test_pass: 17
---

# Phase 93 Plan 01: Error Classification Module Summary

Pure-function error classifier with 10-category taxonomy and 17-test unit suite for extraction pipeline retry/fail decisions.

## What Was Built

### Task 1: Error Classification Module (`convex/extraction/errors.ts`)

Created a pure-function module (no Convex imports, no `"use node"` directive) that classifies extraction errors into one of 10 categories and determines retryability:

- **Retryable categories** (workpool retries up to maxAttempts: 3): `timeout` (DOMException), `network` (TypeError fetch), `rate_limit` (429/rate limit text), `server_error` (5xx)
- **Permanent categories** (return `{success: false}`, no retry): `not_found` (404), `bad_request` (400), `validation` (ZodError), `empty_body`, `page_limit`
- **Default fallback**: `retryable: true, category: "network"` -- safe because workpool maxAttempts: 3 caps wasted retries

Exports: `ErrorCategory` type, `ClassifiedError` type, `classifyExtractionError` function.

### Task 2: Unit Test Suite (`convex/extraction/errors.test.ts`)

17 test cases covering all error categories and edge cases:
- 2 DOMException timeout tests (AbortError, TimeoutError)
- 1 TypeError network test (fetch failed)
- 2 rate limit tests (429 status, "rate limit" text)
- 2 server error tests (500, 502)
- 1 not found test (404)
- 1 bad request test (400)
- 2 validation tests (ZodError, "validation failed")
- 2 empty body tests ("empty body text", "no body text")
- 1 page limit test
- 1 default fallback test (unknown error)
- 1 non-Error input test (string passed directly)
- 1 structural test (every result has exactly 3 keys)

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Case-insensitive regex matching**: Used `/429|rate limit/i` pattern for case-insensitive matching rather than separate `message.toLowerCase().includes()` calls. More concise and matches the plan's specification of "case-insensitive".

2. **Combined DOMException check**: Used single `if` with OR condition for AbortError/TimeoutError instead of two separate checks. Same classification result, fewer lines.

## Verification Results

- `npx tsc --noEmit convex/extraction/errors.ts` -- clean compile (zero errors)
- `npx vitest run convex/extraction/errors.test.ts --reporter=verbose` -- 17/17 tests pass
- File has no Convex imports, no `"use node"` directive
- All 10 category literals present in type definition
- Function signature: `(error: unknown): ClassifiedError`

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create error classification module | 47e1efa | convex/extraction/errors.ts |
| 2 | Create error classification unit tests | 1772a9d | convex/extraction/errors.test.ts |

## Self-Check: PASSED

- [x] convex/extraction/errors.ts exists
- [x] convex/extraction/errors.test.ts exists
- [x] 93-01-SUMMARY.md exists
- [x] Commit 47e1efa found in git log
- [x] Commit 1772a9d found in git log
