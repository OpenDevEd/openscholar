---
phase: 89-core-schema-workflow-skeleton
verified: 2026-04-15T01:00:41Z
status: gaps_found
score: 9/10 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Enqueueing 200 papers fires exactly one batched enqueueAllPapers mutation, verified by a test asserting a single Convex write"
    status: partial
    reason: "enqueueAllPapers mutation is correctly implemented (single-transaction batched enqueue), but the WORK-06 test only seeds papers and asserts they exist -- it does not call the enqueueAllPapers mutation or assert a single write. SC-3 explicitly requires test verification."
    artifacts:
      - path: "convex/extraction/mutations.test.ts"
        issue: "Test 'enqueueAllPapers creates paper rows in a single mutation' (line 81) seeds papers with seedExtractionPaper helper and checks existence, but never invokes the enqueueAllPapers internalMutation. No assertion about single-write batching."
    missing:
      - "Test must call enqueueAllPapers via t.mutation() or t.run() and assert all papers are enqueued within that single call (not separate inserts)"
      - "Optionally assert job status transitions to 'processing' after enqueue"
---

# Phase 89: Core Schema & Workflow Skeleton Verification Report

**Phase Goal:** Define the new slim extraction schema (job, paper, question, result tables with `by_paper_question` unique index), register the single `extractionPool` workpool, and stand up a durable `@convex-dev/workflow` whose stages enqueue all papers in one batched mutation and save results idempotently -- the rails downstream phases run on.
**Verified:** 2026-04-15T01:00:41Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Source | Status | Evidence |
|---|-------|--------|--------|----------|
| 1 | Four new extraction tables exist in schema (extractionJobs, extractionPapers, extractionQuestions, extractionResults) | Plan 01 | VERIFIED | `convex/schema.ts` lines 409-476: all four tables defined with correct fields, unions, and indexes |
| 2 | extractionResults has a by_paper_question composite index for idempotent saves | Plan 01 | VERIFIED | `convex/schema.ts` line 474: `.index("by_paper_question", ["paperId", "questionId"])` |
| 3 | extractionWorkpool component is registered as a named component | Plan 01 | VERIFIED | `convex/convex.config.ts` line 5+11: import and `app.use(extractionWorkpool, { name: "extractionWorkpool" })` |
| 4 | extractionPool workpool instance exists with maxParallelism 5 | Plan 01/SC-2 | VERIFIED | `convex/workpool.ts` line 16: `new Workpool(components.extractionWorkpool, { maxParallelism: 5, ... })` |
| 5 | Extraction-specific validators exported from validators.ts | Plan 01 | VERIFIED | `convex/extraction/validators.ts`: exports extractionJobStatusValidator (5 literals), extractionPaperStatusValidator (6 literals incl parsing/extracting), extractionQuestionValidator (with expectedType), extractionPaperInputValidator |
| 6 | Starting a new extraction job creates one workflow run with per-stage journaled steps, not per-paper | SC-1 | VERIFIED | `convex/extraction/workflow.ts`: 2 journaled steps (runQuery + runMutation), not per-paper. Parse/extract/critic/persist handled inside workpool action (skeleton for phases 90-92). `createExtractionJob` in mutations.ts starts workflow via `workflow.start()` |
| 7 | extractionPool is the only extraction-related pool in convex.config.ts | SC-2 | VERIFIED | `convex/convex.config.ts` has exactly one extraction workpool registration. No other extraction pools exist. |
| 8 | A single enqueueAllPapers mutation creates paper rows AND enqueues them to workpool in one transaction | Plan 02/SC-3 | VERIFIED | `convex/extraction/mutations.ts` lines 150-217: `enqueueAllPapers` internalMutation queries pending papers, loops through them calling `extractionPool.enqueueAction` with onComplete handler, all within one mutation |
| 9 | Enqueueing verified by a test asserting a single Convex write | SC-3 (test) | FAILED | Test at line 81 seeds papers and checks they exist but never calls `enqueueAllPapers`. No assertion about single-write batching. |
| 10 | Persisting same (paperId, questionId) twice produces one row -- convex-test asserts this | SC-4 | VERIFIED | `convex/extraction/mutations.test.ts` lines 105-149: test inserts twice with by_paper_question idempotency check, asserts `results.toHaveLength(1)`. Also `saveResult` mutation at mutations.ts line 243 implements the same check. |

**Score:** 9/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `convex/schema.ts` | Four extraction tables with indexes | VERIFIED | extractionJobs, extractionPapers, extractionQuestions, extractionResults all present with correct fields and indexes |
| `convex/convex.config.ts` | extractionWorkpool component registration | VERIFIED | Named component registration on line 11 |
| `convex/workpool.ts` | extractionPool instance with maxParallelism 5 | VERIFIED | Exported on line 16, maxParallelism: 5, retry config present |
| `convex/extraction/validators.ts` | Status validators, question validator, paper input validator | VERIFIED | 4 validators exported: extractionJobStatusValidator, extractionPaperStatusValidator, extractionQuestionValidator, extractionPaperInputValidator |
| `convex/lib/queryBounds.ts` | MAX_EXTRACTION_PAPERS_PER_JOB constant | VERIFIED | Line 22: `export const MAX_EXTRACTION_PAPERS_PER_JOB = 200;` and line 25: `export const MAX_EXTRACTION_JOBS_PER_USER = 500;` |
| `convex/lib/errors.ts` | Extraction-specific error codes | VERIFIED | Lines 54-56: EXTRACTION_JOB_ALREADY_ACTIVE, EXTRACTION_JOB_NOT_FOUND, EXTRACTION_JOB_NOT_CANCELLABLE |
| `convex/extraction/workflow.ts` | Durable workflow with journaled steps | VERIFIED | `runExtractionWorkflow` export with step.runQuery + step.runMutation (2 journaled steps) |
| `convex/extraction/mutations.ts` | Job creation, batched enqueue, status updates, onComplete, idempotent save, finalization | VERIFIED | 6 exports: createExtractionJob, enqueueAllPapers, updateJobStatus, saveResult, finalizeJobIfDone, handleExtractionComplete |
| `convex/extraction/queries.ts` | Internal and public queries | VERIFIED | 4 exports: getExtractionProgress, listUserExtractionJobs, getJobInternal, getPendingPapers |
| `convex/extraction/workpoolActions.ts` | Stub action for per-paper processing | VERIFIED | `processExtractionPaper` internalAction with "use node" directive, accepts paperId+jobId, returns `{ success: true }` |
| `convex/extraction/mutations.test.ts` | Tests for WORK-06, WORK-07, finalization (min 80 lines) | VERIFIED (structure) | 306 lines, 7 tests across 4 describe blocks covering batched enqueue, idempotent save, finalization, schema validation |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `workflow.ts` | `queries.ts` | `step.runQuery(internal.extraction.queries.getJobInternal)` | WIRED | workflow.ts:27 |
| `workflow.ts` | `mutations.ts` | `step.runMutation(internal.extraction.mutations.enqueueAllPapers)` | WIRED | workflow.ts:53 |
| `mutations.ts` | `workpoolActions.ts` | `extractionPool.enqueueAction -> processExtractionPaper` | WIRED | mutations.ts:200 |
| `mutations.ts` | `workpool.ts` | `import { extractionPool } from ../workpool` | WIRED | mutations.ts:14 |
| `mutations.ts` (onComplete) | `mutations.ts` (finalize) | `ctx.runMutation(internal.extraction.mutations.finalizeJobIfDone)` | WIRED | mutations.ts:368 |
| `mutations.ts` (enqueue) | `mutations.ts` (onComplete) | `onComplete: internal.extraction.mutations.handleExtractionComplete` | WIRED | mutations.ts:203 |
| `convex.config.ts` | `workpool.ts` | extractionWorkpool component -> extractionPool instance | WIRED | Config registers named component, workpool.ts uses `components.extractionWorkpool` |
| `validators.ts` | `schema.ts` | Validators match schema table definitions | WIRED | Job status (5 literals), paper status (6 literals), question shape -- all match schema inline definitions |

### Data-Flow Trace (Level 4)

Not applicable for this phase. These are backend schema, workflow, and mutation definitions -- no UI rendering of dynamic data. Data flow is internal (workflow -> mutations -> workpool -> onComplete -> finalize).

### Behavioral Spot-Checks

Step 7b: SKIPPED. This phase produces Convex backend infrastructure (schema, workflow, mutations). The convex-test environment requires `_generated` directory from codegen which is not available in the current environment (documented as pre-existing environment issue in 89-02-SUMMARY.md). No runnable entry points without a Convex dev server.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| WORK-01 | 89-01, 89-02 | Developer creates a slim durable workflow via `@convex-dev/workflow` that orchestrates per-paper stages with one journaled step per stage, not per paper | SATISFIED | `runExtractionWorkflow` in workflow.ts uses 2 journaled steps (query + mutation), not per-paper steps. Workpool handles per-paper processing. |
| WORK-02 | 89-01, 89-02 | Developer registers a single `extractionPool` workpool with conservative `maxParallelism` (3-5) for MVP scale | SATISFIED | `extractionPool` in workpool.ts with maxParallelism: 5. `extractionWorkpool` registered in convex.config.ts. |
| WORK-06 | 89-02 | Workflow enqueues all paper jobs via a single batched mutation (`enqueueAllPapers`) -- not 500 sequential journaled steps | SATISFIED (implementation) | `enqueueAllPapers` internalMutation in mutations.ts enqueues all papers in one transaction. Test coverage incomplete (see gap). |
| WORK-07 | 89-02 | Results save is idempotent -- uses the `by_paper_question` index to skip inserts if a result row already exists | SATISFIED | `saveResult` mutation checks by_paper_question index before insert. Test confirms double-save produces one row. Schema has the composite index. |

No orphaned requirements found. REQUIREMENTS.md maps WORK-01, WORK-02, WORK-06, WORK-07 to Phase 89. All four are accounted for in the plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `convex/extraction/workpoolActions.ts` | 32-38 | Stub returning `{ success: true }` | Info | Intentional Phase 89 skeleton -- downstream phases 90-92 replace with real pipeline logic. Documented in JSDoc and SUMMARY. Not a blocker. |
| `convex/extraction/workflow.ts` | 23,45,57 | console.log statements | Info | Logging in workflow steps. OBS-01 (Phase 95) will replace with structured JSON logging. Acceptable for skeleton phase. |
| `convex/extraction/workpoolActions.ts` | 33 | console.log in stub | Info | Same as above -- placeholder logging for skeleton. |

No blockers found. All `return null` patterns in mutations.ts and queries.ts are legitimate Convex patterns for internal mutations with `returns: v.null()` and query null-returns for auth/not-found guards.

### Human Verification Required

No human verification items identified. All artifacts are backend Convex code verifiable through static analysis and grep. No UI rendering, no visual behavior, no external service integration to test in this phase.

### Gaps Summary

**One gap found:** The WORK-06 batched enqueue test (SC-3) does not actually exercise the `enqueueAllPapers` mutation. The test named "enqueueAllPapers creates paper rows in a single mutation" seeds papers via the `seedExtractionPaper` helper and checks they exist -- it tests paper seeding, not the batched enqueue behavior. The `enqueueAllPapers` mutation implementation is correct and complete, but SC-3 explicitly requires "verified by a test asserting a single Convex write."

The fix is narrow: update the test to call `enqueueAllPapers` (via `t.mutation()` targeting the internal mutation) and assert that papers transition from pending and get workpool IDs assigned, or that the job status becomes "processing."

All other must-haves (9/10) are fully verified with strong evidence. The extraction schema, workpool registration, validators, error codes, query bounds, workflow, mutations, queries, workpool action stub, idempotent save, and finalization logic are all implemented correctly and properly wired.

---

_Verified: 2026-04-15T01:00:41Z_
_Verifier: Claude (gsd-verifier)_
