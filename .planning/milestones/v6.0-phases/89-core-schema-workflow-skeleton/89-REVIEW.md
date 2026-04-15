---
phase: 89-core-schema-workflow-skeleton
reviewed: 2026-04-15T12:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - convex/convex.config.ts
  - convex/extraction/mutations.test.ts
  - convex/extraction/mutations.ts
  - convex/extraction/queries.ts
  - convex/extraction/validators.ts
  - convex/extraction/workflow.ts
  - convex/extraction/workpoolActions.ts
  - convex/lib/errors.ts
  - convex/lib/queryBounds.ts
  - convex/schema.ts
  - convex/workpool.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 89: Code Review Report

**Reviewed:** 2026-04-15T12:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 89 introduces a well-structured extraction pipeline skeleton that follows the established screening pattern: schema tables, validators, workflow, workpool actions, mutations, and queries. The architecture is sound -- batched enqueue (WORK-06), idempotent saves (WORK-07), and terminal-state guards are implemented correctly. The test file covers key invariants.

However, there is one critical issue with the `handleExtractionComplete` counter increment logic that can cause stale-read race conditions under concurrent workpool completions. There are also several warnings around unbounded client-controlled query limits, redundant database writes, and a workflow failure being silently swallowed.

## Critical Issues

### CR-01: Stale-read race condition in handleExtractionComplete counter increment

**File:** `convex/extraction/mutations.ts:322-363`
**Issue:** The `handleExtractionComplete` handler reads the job document once at line 322, then uses the stale `job.processedPapers` / `job.failedPapers` values to compute increments at lines 344 and 361. While the comment says "OCC will retry on conflict," the `defineOnComplete` handler is an `internalMutation` registered by the workpool -- and its retry behavior depends on OCC detecting a write conflict on the same document field within the same transaction.

The problem: when two papers complete near-simultaneously, both handlers read the job (e.g., `processedPapers: 3`), and both write `processedPapers: 4`. Even with OCC, the second write silently overwrites the first because `ctx.db.patch` sets the field to a literal value, not an atomic increment. OCC retries the *transaction*, but if both reads happen before either write commits, one increment is lost.

In contrast, the `finalizeJobIfDone` mutation at lines 278-306 only checks a threshold (`>=`), so a lost counter means finalization is delayed until the *next* paper triggers it -- which may never happen if the lost counter was on the last paper.

**Fix:** Use a pattern that avoids stale reads: re-read the job document immediately before patching, or better yet, move the counter increment into `finalizeJobIfDone` by counting actual paper statuses from the database:

```typescript
// Option A: Re-read job immediately before patching (reduces but does not eliminate window)
if (result.kind === "success") {
  await ctx.db.patch(context.paperId, {
    status: "completed",
    completedAt: Date.now(),
    updatedAt: Date.now(),
  });
  // Re-read to get latest counters
  const freshJob = await ctx.db.get(context.jobId);
  if (!freshJob) return;
  await ctx.db.patch(context.jobId, {
    processedPapers: (freshJob.processedPapers ?? 0) + 1,
    updatedAt: Date.now(),
  });
}

// Option B (preferred): Derive counters from paper status in finalizeJobIfDone
// instead of maintaining denormalized counters in the onComplete handler.
// Count completed/failed papers via index queries. This is authoritative.
```

Note: Option A still has a theoretical window but is significantly smaller since the read and write happen within the same transaction without intervening awaits on other documents. Option B is the authoritative fix but requires changing `finalizeJobIfDone` to query paper statuses.

## Warnings

### WR-01: Unbounded client-controlled limit in listUserExtractionJobs

**File:** `convex/extraction/queries.ts:68,88`
**Issue:** The `limit` argument is `v.optional(v.number())` with no upper bound. A client can pass `limit: 999999`, causing the query to load an unbounded number of documents. The `MAX_EXTRACTION_JOBS_PER_USER` constant (500) exists in `queryBounds.ts` but is not used here.

**Fix:**
```typescript
const safeLimit = Math.min(args.limit ?? 20, MAX_EXTRACTION_JOBS_PER_USER);

const jobs = await ctx.db
  .query("extractionJobs")
  .withIndex("by_user", (q) => q.eq("userId", user._id))
  .order("desc")
  .take(safeLimit);
```

### WR-02: Workflow start failure silently swallowed in createExtractionJob

**File:** `convex/extraction/mutations.ts:121-133`
**Issue:** When `workflow.start()` fails, the error is caught and logged with `console.error`, but the mutation still returns `{ jobId }` successfully. The job is left in `"pending"` status with no workflow to advance it. The caller has no indication that the job will never be processed. The comment mentions "test environments," but in production this creates an orphaned job.

**Fix:** Either re-throw the error after logging (which rolls back the entire mutation), or set the job status to `"failed"` within the catch block:

```typescript
try {
  const workflowId = await workflow.start(
    ctx,
    internal.extraction.workflow.runExtractionWorkflow,
    { jobId }
  );
  await ctx.db.patch(jobId, { workflowId: String(workflowId) });
} catch (e) {
  console.error(`[createExtractionJob] Failed to start workflow: ${e}`);
  await ctx.db.patch(jobId, {
    status: "failed",
    errorMessage: `Workflow start failed: ${String(e).slice(0, 500)}`,
    updatedAt: Date.now(),
  });
}
```

### WR-03: Redundant status patch in enqueueAllPapers loop

**File:** `convex/extraction/mutations.ts:192-196`
**Issue:** Papers loaded at line 167 are already filtered to `status: "pending"` via the `by_job_status` index. The patch at line 193 sets `status: "pending"` again -- the exact same value. This is a wasted write that increases the mutation's document write count and costs a write operation for every paper.

**Fix:** Remove the redundant patch. If the intent is to set `updatedAt`, combine it with the workpoolId patch at line 209:

```typescript
for (const paper of pendingPapers) {
  const workId = await extractionPool.enqueueAction(
    ctx,
    internal.extraction.workpoolActions.processExtractionPaper,
    { paperId: paper._id, jobId: args.jobId },
    {
      onComplete: internal.extraction.mutations.handleExtractionComplete,
      context: { paperId: paper._id, jobId: args.jobId },
    }
  );

  await ctx.db.patch(paper._id, {
    workpoolId: String(workId),
    updatedAt: Date.now(),
  });
}
```

### WR-04: getExtractionProgress returns 100% for failed/cancelled jobs

**File:** `convex/extraction/queries.ts:37-49`
**Issue:** When `isTerminal` is true, `percentComplete` is unconditionally set to 100. This means a job that failed after processing 2 out of 100 papers shows 100% progress. The UI would display a completed progress bar for a job that barely started before failing. This is semantically misleading.

**Fix:** Only set 100% for `"completed"` status. For `"failed"` and `"cancelled"`, return the actual progress:

```typescript
const percentComplete =
  job.status === "completed"
    ? 100
    : isTerminal
      ? rawPercent  // failed/cancelled: show actual progress at time of termination
      : Math.min(rawPercent, 99);
```

## Info

### IN-01: console.log statements in workflow and workpool action stubs

**File:** `convex/extraction/workflow.ts:23,57` and `convex/extraction/workpoolActions.ts:33-35`
**Issue:** Multiple `console.log` statements exist in the workflow and workpool action stubs. These are acceptable for Phase 89 skeleton code but should be removed or replaced with structured logging before production.

**Fix:** Remove or gate behind a debug flag in downstream phases (90-92).

### IN-02: TERMINAL_STATUSES defined in three separate locations

**File:** `convex/extraction/mutations.ts:17`, `convex/extraction/queries.ts:37`, `convex/extraction/workflow.ts:39`
**Issue:** The `TERMINAL_STATUSES` array is defined independently in three files with identical values. This creates a maintenance risk -- if a new terminal status is added, all three must be updated.

**Fix:** Export the constant from `validators.ts` alongside the status validator:

```typescript
// In convex/extraction/validators.ts
export const EXTRACTION_TERMINAL_STATUSES = ["completed", "cancelled", "failed"] as const;
```

### IN-03: extractionResults table has no answer/value fields yet

**File:** `convex/schema.ts:468-476`
**Issue:** The `extractionResults` table currently only has `jobId`, `paperId`, `questionId`, and `createdAt`. There are no fields for the actual extracted answer, confidence score, or source citations. This is acknowledged as a Phase 89 skeleton, but the `saveResult` mutation at `mutations.ts:243-269` creates rows with no result data, which means the idempotency check at line 252 would prevent future saves from adding the answer data (once added in Phase 91+).

**Fix:** When downstream phases add answer fields, ensure `saveResult` uses upsert semantics (patch if exists, insert if not) rather than skip-if-exists, or add the answer fields now as optional:

```typescript
extractionResults: defineTable({
  jobId: v.id("extractionJobs"),
  paperId: v.id("extractionPapers"),
  questionId: v.string(),
  answer: v.optional(v.string()),
  confidence: v.optional(v.number()),
  createdAt: v.number(),
})
```

---

_Reviewed: 2026-04-15T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
