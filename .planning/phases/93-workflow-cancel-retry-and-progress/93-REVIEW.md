---
phase: 93-workflow-cancel-retry-and-progress
reviewed: 2026-04-15T12:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - convex/extraction/errors.ts
  - convex/extraction/errors.test.ts
  - convex/extraction/mutations.ts
  - convex/extraction/queries.ts
  - convex/extraction/cancel.test.ts
  - convex/extraction/workpoolActions.ts
  - convex/extraction/early-return.test.ts
  - convex/schema.ts
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues_found
---

# Phase 93: Code Review Report

**Reviewed:** 2026-04-15T12:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 93 adds cancellation, retry-with-error-classification, and real-time progress tracking to the extraction pipeline. The implementation is well-structured overall: the cancel mutation correctly applies per-paper targeted cancellation instead of a blanket `cancelAll`, error classification is a clean pure-function module, and the progress query handles the 99%-cap edge case to avoid premature 100% display. Terminal-status guard logic is consistently applied across mutations, workflow steps, and workpool actions.

The review found one critical issue (double-counting of cancelled papers in a race between `cancelExtractionJob` and `handleExtractionComplete`), five warnings (a regex false-positive risk, a stale-read counter pattern, missing terminal-status re-check after cancellation in the action, a `cancelledPapers` counter overwrite in `cancelExtractionJob`, and missing `"extracting"` in the cancel test paper status coverage), plus three informational items.

## Critical Issues

### CR-01: Double-counting of cancelledPapers between cancelExtractionJob and handleExtractionComplete

**File:** `convex/extraction/mutations.ts:228-232` and `convex/extraction/mutations.ts:538-542`

**Issue:** Both `cancelExtractionJob` (line 230) and `handleExtractionComplete` (line 540) increment `cancelledPapers` based on stale snapshots of the job document. This creates a race condition:

1. `cancelExtractionJob` reads `job.cancelledPapers` (e.g., 0) at line 167.
2. A concurrent `handleExtractionComplete` for a paper whose workpool item was already finishing receives `result.kind === "canceled"` and also reads `job.cancelledPapers` (0) at line 505.
3. Both write `cancelledPapers: 0 + N` -- the last write wins, losing the other's count.

While Convex mutations are transactions and OCC will retry on conflict for truly concurrent writes within the same transaction, the issue is that `cancelExtractionJob` reads the job at line 167 and writes the counter at line 230 -- with many `db.patch` calls to papers in between. The `handleExtractionComplete` callback runs as a separate mutation triggered by the workpool after the cancel completes. If it fires between the cancel mutation's read and the final `db.patch` on line 230, OCC will not help because they are separate transactions.

The practical impact: `cancelledPapers` counter may be incorrect, causing `finalizeJobIfDone` (line 477: `handled >= job.totalPapers`) to either never fire (under-count, job stuck in "processing" forever) or fire prematurely.

**Fix:** Re-read the job document immediately before the counter update in `cancelExtractionJob`, or better yet, use an atomic read-then-patch pattern:

```typescript
// Line 228-232 in cancelExtractionJob -- replace with fresh read:
const freshJob = await ctx.db.get(args.jobId);
if (freshJob) {
  await ctx.db.patch(args.jobId, {
    cancelledPapers: (freshJob.cancelledPapers ?? 0) + cancelledCount,
    updatedAt: Date.now(),
  });
}
```

However, since the entire `cancelExtractionJob` is a single mutation (single transaction), the OCC will actually re-run the entire handler on conflict. The real risk is the *separate* `handleExtractionComplete` transaction that fires asynchronously. The counter write in `handleExtractionComplete` (line 540) and the counter write in `cancelExtractionJob` (line 230) will not conflict with each other on the OCC level if they happen to run in sequence without overlap. But if a paper's workpool completes and triggers `handleExtractionComplete` *after* the cancel mutation has already marked that paper as cancelled (line 221-224), then `handleExtractionComplete` will see `result.kind === "canceled"` and increment `cancelledPapers` *again* for a paper that was already counted by the cancel mutation.

The root cause is that the same paper's cancellation is counted in two places. The fix should ensure only one path counts the cancellation:

```typescript
// In handleExtractionComplete, before incrementing cancelledPapers,
// check if the paper is ALREADY cancelled (cancel mutation got there first):
} else if (result.kind === "canceled") {
  const currentPaper = await ctx.db.get(context.paperId);
  if (currentPaper && currentPaper.status !== "cancelled") {
    await ctx.db.patch(context.paperId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
    await ctx.db.patch(context.jobId, {
      cancelledPapers: (job.cancelledPapers ?? 0) + 1,
      updatedAt: Date.now(),
    });
  }
  // else: cancelExtractionJob already counted this paper -- skip
}
```

## Warnings

### WR-01: 5xx regex in classifyExtractionError matches non-HTTP numbers

**File:** `convex/extraction/errors.ts:67-69`

**Issue:** The regex `/\b5\d{2}\b/` matches any standalone 3-digit number starting with 5, not just HTTP status codes. An error message like `"processed 512 bytes"` or `"timeout after 500 ms"` would be incorrectly classified as a retryable server error instead of falling through to the correct category. In the extraction pipeline context, messages about "500 papers" or "512 bytes" are plausible.

**Fix:** Anchor the pattern to HTTP-like context:

```typescript
// More precise: require "HTTP" or status-like prefix
if (/(?:HTTP|status)\s*5\d{2}\b/i.test(message) || /\b5\d{2}\s+(?:Internal|Bad Gateway|Service|Gateway Timeout)/i.test(message)) {
  return { retryable: true, category: "server_error", message };
}
```

Or at minimum, check the 5xx pattern *after* the more specific patterns (which is already the case), and accept the low-probability false positive as documented behavior. The current ordering mitigates the risk since rate_limit (429) is checked first.

### WR-02: cancelExtractionJob overwrites its own earlier patch to the job

**File:** `convex/extraction/mutations.ts:182-185` and `convex/extraction/mutations.ts:228-232`

**Issue:** The mutation patches the job document at line 182 (setting `status: "cancelled"`) and then patches it again at line 229 (setting `cancelledPapers`). The second patch includes `updatedAt: Date.now()` but does NOT include `status: "cancelled"`. Since `db.patch` is a shallow merge, this is technically fine -- the status field persists from the first patch. However, the two patches read slightly different `Date.now()` values for `updatedAt`, and a reader between the two patches would see `cancelledPapers` at its old value. Within a single Convex mutation transaction this is not externally observable, but it is a code clarity concern that could cause bugs if the code is ever refactored to split across transactions.

**Fix:** Combine the two patches into one at the end, or at minimum document why two patches are intentional (the first one must happen early to trigger the early-return guards in in-flight actions):

```typescript
// At the end, combine final counter update with a comment:
// Note: status was already set to "cancelled" at line 182 to trigger
// early-return guards. This second patch only updates the counter.
await ctx.db.patch(args.jobId, {
  cancelledPapers: (job.cancelledPapers ?? 0) + cancelledCount,
  updatedAt: Date.now(),
});
```

### WR-03: processExtractionPaper does not re-check job status after parsing

**File:** `convex/extraction/workpoolActions.ts:117-138`

**Issue:** The action checks job terminal status at line 60, then proceeds to parse the paper (which involves external HTTP calls that may take many seconds). After parsing completes, it reloads the paper at line 117 and the job at line 129, but it only checks `jobForQuestions.questions.length === 0` -- it does NOT re-check whether the job status has become "cancelled" during parsing. If a user cancels the job while a paper is being parsed, the action will proceed to the expensive extraction cascade (LLM calls with credit billing) even though the job is cancelled.

The credit billing via `withUserCreditsBatch` will still charge the user for extraction on a cancelled job.

**Fix:** Add a terminal-status re-check after reloading the job for questions:

```typescript
// Line 133 in workpoolActions.ts -- add terminal guard:
if (!jobForQuestions || jobForQuestions.questions.length === 0) {
  console.warn(`[ExtractionPipeline] Job ${args.jobId} has no questions`);
  return { success: true };
}

// Add this check:
if (terminalStatuses.includes(jobForQuestions.status)) {
  console.log(
    `[ExtractionPipeline] Job ${args.jobId} became ${jobForQuestions.status} during parsing, skipping extraction`
  );
  return { success: false };
}
```

### WR-04: cancel.test.ts does not cover the "extracting" paper status

**File:** `convex/extraction/cancel.test.ts:250-278`

**Issue:** The test at line 250 verifies `cancelledPapers` counter accuracy with papers in "completed", "pending", and "parsing" states. However, the "extracting" status (which is a non-terminal in-progress state) is not tested. A paper in "extracting" status should be cancelled by `cancelExtractionJob`, but there is no test confirming this behavior.

**Fix:** Add an "extracting" paper to the test at line 259:

```typescript
// Add after the parsing paper:
await seedExtractionPaper(t, jobId, "oa:cancel10_extracting", {
  status: "extracting",
});
// Update totalPapers to 4 and expect cancelledPapers to be 3
```

### WR-05: getExtractionProgress returns 100% for cancelled/failed jobs

**File:** `convex/extraction/queries.ts:53`

**Issue:** The progress query sets `percentComplete` to 100 for ALL terminal statuses, including "cancelled" and "failed". A job that was cancelled at 30% progress will show 100% complete to the UI, which is misleading. Users may interpret 100% as "all papers were processed" when in fact the job was cancelled or failed partway through.

**Fix:** Only show 100% for "completed" status; for "cancelled" and "failed", show the actual percentage:

```typescript
const percentComplete =
  job.status === "completed"
    ? 100
    : isTerminal
      ? rawPercent  // Show actual progress for cancelled/failed
      : Math.min(rawPercent, 99);
```

## Info

### IN-01: `TERMINAL_STATUSES` defined in multiple locations

**File:** `convex/extraction/mutations.ts:20`, `convex/extraction/queries.ts:40`, `convex/extraction/workpoolActions.ts:59`, `convex/extraction/early-return.test.ts:92`

**Issue:** The terminal statuses array `["completed", "cancelled", "failed"]` is defined independently in four files. If a new terminal status is added (e.g., `"creditsExhausted"` as in screening), each file must be updated independently. This is a maintenance hazard.

**Fix:** Export the constant from `validators.ts` or a shared constants file:

```typescript
// In convex/extraction/validators.ts:
export const EXTRACTION_TERMINAL_STATUSES = ["completed", "cancelled", "failed"] as const;
```

### IN-02: cancel.test.ts does not pass modules to convexTest

**File:** `convex/extraction/cancel.test.ts:103`

**Issue:** The cancel test file uses `convexTest(schema)` without passing the `modules` parameter (unlike `early-return.test.ts` which passes `modules`). This means the test harness cannot resolve and load function files for `t.mutation(api.extraction.mutations.cancelExtractionJob, ...)`. If the tests are currently passing, it may be due to test framework auto-discovery, but the inconsistency with `early-return.test.ts` is worth noting. The `convex-test` docs explicitly require `modules` for function resolution.

**Fix:** Add the modules glob:

```typescript
const modules = import.meta.glob("../**/*.*s");
// Then: const t = convexTest(schema, modules);
```

### IN-03: Type assertion for workpoolId and workflowId casts

**File:** `convex/extraction/mutations.ts:132`, `convex/extraction/mutations.ts:190`, `convex/extraction/mutations.ts:211`

**Issue:** Several lines use `as WorkflowId` and `as WorkId` type assertions to cast `string` values back to their opaque types. This is necessary because the IDs are stored as `v.string()` in the schema (Convex does not support opaque type storage), but the casts bypass type safety. If the stored string is corrupted or from a different component, the cast would silently produce an invalid ID.

**Fix:** This is a known limitation of storing opaque component IDs in Convex. Consider adding a comment documenting the invariant that these strings are always valid component IDs, or wrapping the cast in a helper function that provides a single point of failure for debugging:

```typescript
function asWorkId(id: string): WorkId {
  return id as WorkId;
}
```

---

_Reviewed: 2026-04-15T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
