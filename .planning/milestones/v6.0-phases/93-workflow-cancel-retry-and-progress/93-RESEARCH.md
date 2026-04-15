# Phase 93: Workflow Cancel, Retry, and Progress - Research

**Researched:** 2026-04-15
**Domain:** Convex durable workflows, workpool cancel/retry, error classification, reactive progress
**Confidence:** HIGH

## Summary

Phase 93 adds job controllability to the extraction pipeline built in Phases 89-92. The codebase is well-prepared: `workpoolId` values are already persisted per paper row (Phase 89 `enqueueAllPapers`), `workflowId` is already stored on the job row (`createExtractionJob` line 130), early-return guards exist in the workflow, workpool action, and completion handler, and the reactive progress query already works with Convex subscriptions. The screening module's `cancelScreeningJob` mutation (lines 169-214) provides a direct reference pattern, though the extraction cancel uses **targeted per-paper cancel** instead of `cancelAll` to avoid cross-user blast radius.

The main new work is: (1) a `cancelExtractionJob` mutation that iterates paper rows and calls `extractionPool.cancel(ctx, workpoolId as WorkId)` on each non-terminal paper, (2) a `classifyExtractionError` helper in `convex/extraction/errors.ts` that distinguishes retryable from permanent errors, (3) wrapping the workpool action pipeline with error classification, (4) adding a `cancelledPapers` counter to the schema and progress query, and (5) a comprehensive test suite modeled on `screening/cancel.test.ts`.

**Primary recommendation:** Follow the screening cancel pattern exactly for auth/ownership/idempotency, but replace `cancelAll` with per-paper `extractionPool.cancel(ctx, workpoolId as WorkId)` iteration. The error classification module is a pure function with no Convex dependencies, making it straightforward to unit test.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Create a `cancelExtractionJob` mutation in `convex/extraction/mutations.ts` modeled after `cancelScreeningJob` but using targeted per-paper cancel instead of `cancelAll`.
- **D-02:** Cancel mutation also cancels the parent workflow via `workflow.cancel(ctx, workflowId)` -- both workflow-level and per-paper workpool-level cancellation in the same mutation.
- **D-03:** Auth and ownership checks follow the screening pattern: verify user identity, verify the user owns the job. Terminal-status jobs are idempotent no-ops.
- **D-04:** The `workflowId` must be stored on the `extractionJobs` row. **VERIFIED: Already exists in schema (line 429) and is persisted in `createExtractionJob` (line 130).**
- **D-05:** After cancelling all papers, set job status to `cancelled` and update progress counters.
- **D-06:** Create a `classifyExtractionError` helper. Retryable: network, HTTP 5xx, 429, AbortSignal timeout, transient OpenRouter. Permanent: HTTP 404, 400, Zod validation failure, empty body, page-count exceeded.
- **D-07:** Classification logic lives in `convex/extraction/errors.ts` -- shared between `workpoolActions.ts` and future error handling. Returns `{retryable, category, message}`.
- **D-08:** In `workpoolActions.ts:processExtractionPaper`, wrap pipeline in try/catch using `classifyExtractionError`. Retryable -> rethrow. Permanent -> return `{success: false}` with error details.
- **D-09:** When paper exhausts retry attempts (workpool `maxAttempts: 3`), the workpool failure handler marks it permanently failed with error details persisted.
- **D-10:** Early-return guards already exist. Phase 93 verifies comprehensiveness and adds tests.
- **D-11:** If any gap found in early-return coverage, fix it and test.
- **D-12:** Existing `getExtractionProgress` query already satisfies WORK-09. No new query needed.
- **D-13:** Add `cancelledPapers` counter to job row and progress query.

### Claude's Discretion
- Exact error classification boundaries for edge cases (e.g., OpenRouter non-standard status codes).
- Whether `classifyExtractionError` should handle critic-pass errors differently from extraction errors.
- Test fixture design: whether to use real HTTP error responses or synthetic error objects.
- Whether `cancelledPapers` is a new schema field or derived from counting papers with status `cancelled`.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WORK-03 | Each paper's workpoolId persisted for targeted cancel | Already implemented in `enqueueAllPapers` (line 211). Cancel mutation reads it. |
| WORK-04 | User can cancel a running job -- stops workflow, cancels each paper's workpool item, marks remaining as cancelled | New `cancelExtractionJob` mutation following screening pattern with per-paper targeted cancel. |
| WORK-05 | Workflow steps classify errors as retryable vs permanent -- retryable throw, permanent return `{success: false}` | New `classifyExtractionError` helper in `errors.ts`, integrated into `workpoolActions.ts`. |
| WORK-08 | All workflow-facing actions early-return when job is cancelled/failed -- zero LLM tokens | Guards exist at workflow.ts:39-49, workpoolActions.ts:58-64, mutations.ts:410-416. Need verification tests. |
| WORK-09 | Reactive Convex subscriptions stream progress counters to UI | Existing `getExtractionProgress` query (queries.ts:20-61) already provides this. Add `cancelledPapers`. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cancel mutation (auth, ownership, state transitions) | API / Backend (Convex mutation) | -- | Server-side auth, DB writes, workpool/workflow API calls |
| Error classification | API / Backend (pure function) | -- | Runs inside Convex Node.js action, classifies HTTP/validation errors |
| Early-return guards | API / Backend (Convex action + workflow) | -- | Guards in workflow steps and workpool actions prevent LLM calls |
| Reactive progress | API / Backend (Convex query) | Browser / Client (subscription) | Convex reactive query is the source of truth; client subscribes automatically |
| workpoolId persistence | Database / Storage | -- | Already stored on `extractionPapers` rows by `enqueueAllPapers` |

## Standard Stack

### Core (Already Installed)
| Library | Installed Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @convex-dev/workpool | 0.3.2 | Workpool with cancel/cancelAll/retry | Project's standard background job infrastructure [VERIFIED: package.json] |
| @convex-dev/workflow | 0.3.10 | Durable workflows with cancel API | Project's standard workflow orchestration [VERIFIED: package.json] |
| convex | (project dep) | Database, mutations, queries, reactive subscriptions | Backend platform [VERIFIED: project dependency] |
| convex-test | 0.0.46 | Testing Convex functions with edge-runtime | Project's standard test infrastructure [VERIFIED: package.json] |
| vitest | (project dep) | Test runner | Project's standard test runner [VERIFIED: vitest.config.ts] |

### Supporting (No New Dependencies)
This phase requires zero new npm packages. All functionality is built on existing infrastructure.

**Installation:** None required.

## Architecture Patterns

### System Architecture Diagram

```
User clicks "Cancel" in UI (Phase 97)
        |
        v
cancelExtractionJob mutation (Phase 93)
        |
        +---> requireAuth(ctx) -- verify identity
        |
        +---> ctx.db.get(jobId) -- load job, verify ownership
        |
        +---> Terminal status guard (completed/cancelled/failed) -- idempotent no-op
        |
        +---> ctx.db.patch(jobId, { status: "cancelled" }) -- set job cancelled FIRST
        |
        +---> workflow.cancel(ctx, workflowId as WorkflowId) -- stop future steps
        |
        +---> FOR EACH non-terminal paper:
        |       +---> extractionPool.cancel(ctx, workpoolId as WorkId)
        |       +---> ctx.db.patch(paperId, { status: "cancelled" })
        |
        +---> Update cancelledPapers counter on job row
```

```
Error Flow in processExtractionPaper action:
        |
  try { pipeline() }
        |
  catch (error) --> classifyExtractionError(error)
        |                    |
        |              retryable?
        |              /        \
        |           YES          NO
        |            |            |
        |    throw error    return { success: false }
        |    (workpool       (paper marked failed,
        |     retries)        no retry)
        v
  onComplete handler
        |
  result.kind === "success" | "failed" | "canceled"
        |
  Update counters + finalize
```

### Recommended Project Structure (Changes Only)
```
convex/extraction/
  mutations.ts          # + cancelExtractionJob mutation
  errors.ts             # NEW: classifyExtractionError helper
  workpoolActions.ts    # + error classification wrapping pipeline
  queries.ts            # + cancelledPapers in progress query
  cancel.test.ts        # NEW: cancel mutation test suite
  errors.test.ts        # NEW: error classification unit tests
  early-return.test.ts  # NEW: early-return guard verification tests
convex/schema.ts        # + cancelledPapers field on extractionJobs
convex/extraction/validators.ts  # (no changes needed -- validators already support cancelled status)
```

### Pattern 1: Targeted Per-Paper Cancel (vs cancelAll)

**What:** Instead of `cancelAll` (which cancels ALL items in the workpool regardless of owner), iterate paper rows for a specific job and call `cancel(ctx, workpoolId)` on each.

**When to use:** Multi-user systems where workpool items from different jobs share the same pool.

**Example:**
```typescript
// Source: Verified from @convex-dev/workpool 0.3.2 client API + screening/mutations.ts pattern
import type { WorkId } from "@convex-dev/workpool";
import type { WorkflowId } from "@convex-dev/workflow";
import { extractionPool } from "../workpool";
import { workflow } from "../workflow";

// Inside cancelExtractionJob mutation handler:

// 1. Cancel workflow to prevent future step execution
if (job.workflowId) {
  try {
    await workflow.cancel(ctx, job.workflowId as WorkflowId);
  } catch (e) {
    console.warn(`[cancelExtractionJob] Failed to cancel workflow: ${e}`);
  }
}

// 2. Load non-terminal papers for this job
const papers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .take(MAX_EXTRACTION_PAPERS_PER_JOB);

let cancelledCount = 0;

for (const paper of papers) {
  // Skip papers already in terminal states
  if (["completed", "failed", "cancelled"].includes(paper.status)) continue;

  // Cancel workpool item if workpoolId exists
  if (paper.workpoolId) {
    try {
      await extractionPool.cancel(ctx, paper.workpoolId as WorkId);
    } catch (e) {
      // Workpool item may already be finished -- safe to ignore
      console.warn(`[cancelExtractionJob] Failed to cancel paper ${paper._id}: ${e}`);
    }
  }

  // Mark paper as cancelled
  await ctx.db.patch(paper._id, {
    status: "cancelled",
    updatedAt: Date.now(),
  });
  cancelledCount++;
}
```
[VERIFIED: `extractionPool.cancel(ctx, id: WorkId)` API from node_modules/@convex-dev/workpool/src/client/index.ts:238]

### Pattern 2: Error Classification Helper

**What:** A pure function that inspects an error and returns `{retryable, category, message}`.

**When to use:** When workpool actions need to distinguish between transient failures (retry) and permanent failures (give up).

**Example:**
```typescript
// Source: D-06, D-07 from CONTEXT.md
export type ErrorCategory =
  | "network"
  | "rate_limit"
  | "timeout"
  | "server_error"
  | "validation"
  | "not_found"
  | "bad_request"
  | "parse_failure"
  | "empty_body"
  | "page_limit";

export type ClassifiedError = {
  retryable: boolean;
  category: ErrorCategory;
  message: string;
};

export function classifyExtractionError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error);

  // AbortSignal timeout
  if (error instanceof DOMException && error.name === "AbortError") {
    return { retryable: true, category: "timeout", message };
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return { retryable: true, category: "timeout", message };
  }

  // Network errors (fetch failures)
  if (error instanceof TypeError && message.includes("fetch")) {
    return { retryable: true, category: "network", message };
  }

  // HTTP status code patterns (from error message or response)
  if (message.includes("429") || message.includes("rate limit")) {
    return { retryable: true, category: "rate_limit", message };
  }
  if (/\b5\d{2}\b/.test(message)) {
    return { retryable: true, category: "server_error", message };
  }
  if (message.includes("404") || message.includes("not found")) {
    return { retryable: false, category: "not_found", message };
  }
  if (message.includes("400") || message.includes("bad request")) {
    return { retryable: false, category: "bad_request", message };
  }

  // Zod validation failures (from extraction cascade exhaustion)
  if (message.includes("ZodError") || message.includes("validation")) {
    return { retryable: false, category: "validation", message };
  }

  // Empty body text
  if (message.includes("empty body") || message.includes("no body text")) {
    return { retryable: false, category: "empty_body", message };
  }

  // Page count exceeded
  if (message.includes("page") && message.includes("exceeded")) {
    return { retryable: false, category: "page_limit", message };
  }

  // Default: assume retryable (network-like failure)
  return { retryable: true, category: "network", message };
}
```
[ASSUMED: Error message patterns for OpenRouter errors -- may need adjustment based on actual error shapes observed at runtime]

### Pattern 3: Workpool onComplete Handler for Cancelled Papers

**What:** The workpool's `onComplete` handler receives `result.kind === "canceled"` (note: single 'l' in the workpool API) when a work item is cancelled.

**Critical detail:** The `@convex-dev/workpool` uses American spelling `"canceled"` (one 'l'), NOT British spelling `"cancelled"` (two 'l's). The current handler already handles this in the else branch (mutations.ts:432-441).

**When cancelled papers should be counted differently:** After Phase 93, the `handleExtractionComplete` handler should distinguish `result.kind === "canceled"` from `result.kind === "failed"`:
- `"canceled"` -> increment `cancelledPapers`, not `failedPapers`
- `"failed"` -> increment `failedPapers` as before

```typescript
// Updated onComplete handler (mutations.ts handleExtractionComplete):
if (result.kind === "success") {
  // ... existing success path
} else if (result.kind === "canceled") {
  // Cancelled by cancelExtractionJob -- count as cancelled, not failed
  await ctx.db.patch(context.paperId, {
    status: "cancelled",
    updatedAt: Date.now(),
  });
  await ctx.db.patch(context.jobId, {
    cancelledPapers: (job.cancelledPapers ?? 0) + 1,
    updatedAt: Date.now(),
  });
} else {
  // Error/failed -- existing path
  await ctx.db.patch(context.paperId, {
    status: "failed",
    completedAt: Date.now(),
    updatedAt: Date.now(),
    errorMessage: String(result.error).slice(0, 500),
  });
  await ctx.db.patch(context.jobId, {
    failedPapers: (job.failedPapers ?? 0) + 1,
    updatedAt: Date.now(),
  });
}
```
[VERIFIED: `result.kind` is `"success" | "failed" | "canceled"` from node_modules/@convex-dev/workpool/src/component/shared.ts:73-85]

### Anti-Patterns to Avoid

- **Using `cancelAll` for extraction:** `cancelAll` cancels ALL items in the workpool across ALL jobs. In a multi-user system, this would cancel other users' papers. Always use per-paper `cancel(ctx, workpoolId)`. [VERIFIED: cancelAll docs at workpool client line 244-257]
- **Casting `workpoolId` without checking for null:** Papers that were never enqueued (still pending when cancel fires) will not have a `workpoolId`. The cancel loop must check `if (paper.workpoolId)` before calling `extractionPool.cancel()`. [VERIFIED: schema has `workpoolId: v.optional(v.string())`]
- **Swallowing cancel errors silently:** `extractionPool.cancel()` may throw if the item is already finished or doesn't exist. Wrap in try/catch but log the warning -- do not let it prevent the paper status update. [VERIFIED: screening pattern at mutations.ts:206-209]
- **Forgetting to update `finalizeJobIfDone` for cancelledPapers:** The finalization check is `processedPapers + failedPapers >= totalPapers`. With a `cancelledPapers` counter, this must become `processedPapers + failedPapers + cancelledPapers >= totalPapers`. [VERIFIED: current logic at mutations.ts:380]
- **Spelling mismatch between Convex schema and workpool API:** The schema uses `"cancelled"` (British, two l's) for paper/job status. The workpool `result.kind` uses `"canceled"` (American, one l). The code must map between these. [VERIFIED: schema.ts:449 vs workpool shared.ts:83]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Workpool item cancellation | Custom job status polling + abort | `extractionPool.cancel(ctx, workId)` | Workpool handles in-flight vs pending correctly -- pending items are removed, running items finish but don't retry |
| Workflow cancellation | Manual status flag checking | `workflow.cancel(ctx, workflowId)` | WorkflowManager handles journal cleanup and prevents future step execution |
| Retry with backoff | Manual delay-and-retry loops | Workpool `retryActionsByDefault: true` with `defaultRetryBehavior` | Already configured with maxAttempts: 3, 2s backoff, base 2 exponential |
| Reactive progress streaming | WebSocket, polling, SSE | Convex reactive queries (`useQuery`) | Built into the platform -- zero setup, automatic re-render on DB change |

**Key insight:** The `@convex-dev/workpool` and `@convex-dev/workflow` packages handle all the hard distributed-systems problems (exactly-once delivery, retry budgets, cancel semantics). Phase 93's job is to wire them correctly, not to reinvent them.

## Common Pitfalls

### Pitfall 1: Cancel Race Condition with onComplete
**What goes wrong:** The cancel mutation sets job status to `cancelled`, but an in-flight paper's `onComplete` fires after and tries to increment `processedPapers` or `failedPapers` on a cancelled job.
**Why it happens:** `extractionPool.cancel()` only prevents retries -- already-running actions finish. Their `onComplete` fires after the cancel mutation completes.
**How to avoid:** The terminal-status guard in `handleExtractionComplete` (mutations.ts:410-416) already handles this. When `job.status === "cancelled"`, the handler returns early without modifying counters. **Verified: this guard exists.**
**Warning signs:** `processedPapers` counter changes after job shows as cancelled.

### Pitfall 2: workpoolId Not Yet Assigned
**What goes wrong:** If the cancel mutation runs while `enqueueAllPapers` is still executing, some papers may not have `workpoolId` set yet.
**Why it happens:** `enqueueAllPapers` is a single mutation that iterates papers, but if the job status is set to `cancelled` before enqueue starts, the terminal guard in `enqueueAllPapers` (line 162-166) prevents enqueue entirely.
**How to avoid:** Set job status to `cancelled` FIRST in the cancel mutation. Then iterate papers. Papers without `workpoolId` are simply marked as `cancelled` without calling `extractionPool.cancel()`.
**Warning signs:** Papers stuck in `pending` status after cancel.

### Pitfall 3: finalizeJobIfDone Counter Mismatch
**What goes wrong:** After adding `cancelledPapers`, the finalization check `processedPapers + failedPapers >= totalPapers` no longer accounts for all papers. Job never finalizes.
**Why it happens:** Cancelled papers are a third category not included in the original check.
**How to avoid:** Update finalization to: `processedPapers + failedPapers + cancelledPapers >= totalPapers`. **However**, note that the cancel mutation already sets job status to `cancelled` directly -- it does not rely on `finalizeJobIfDone`. The finalization update is needed for the case where individual `onComplete` handlers fire after the cancel mutation.
**Warning signs:** Jobs stuck in `processing` status despite all papers being terminal.

### Pitfall 4: Spelling Mismatch -- "canceled" vs "cancelled"
**What goes wrong:** Code checks `result.kind === "cancelled"` (British) but the workpool returns `"canceled"` (American). The cancelled branch never executes.
**Why it happens:** JavaScript has no standard -- the workpool library uses American spelling.
**How to avoid:** Always check the actual workpool `vResult` validator definition. Use `result.kind === "canceled"` (one 'l') when matching workpool results.
**Warning signs:** Cancelled papers showing up as `failed` instead of `cancelled` in the progress query.

### Pitfall 5: Error Classification Default Too Permissive
**What goes wrong:** Unknown errors default to `retryable: true`, causing extra retry attempts for genuinely permanent failures.
**Why it happens:** The default case in `classifyExtractionError` assumes unknown errors are transient.
**How to avoid:** The workpool already has `maxAttempts: 3`, so even permissive classification has a ceiling. Log the error category when defaulting to retryable so it can be tuned later.
**Warning signs:** Papers failing 3 times for the same permanent error before being marked failed.

## Code Examples

### Cancel Mutation (Full Pattern)
```typescript
// Source: Derived from convex/screening/mutations.ts:169-214 + D-01 through D-05
import type { WorkId } from "@convex-dev/workpool";
import type { WorkflowId } from "@convex-dev/workflow";

export const cancelExtractionJob = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    // 1. Auth check (D-03)
    const user = await requireAuth(ctx);

    // 2. Load job + ownership check (D-03)
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) {
      throw createError("EXTRACTION_JOB_NOT_FOUND", "Extraction job not found");
    }

    // 3. Terminal status idempotent guard (D-03)
    if (TERMINAL_STATUSES.includes(job.status as (typeof TERMINAL_STATUSES)[number])) {
      return null;
    }

    // 4. Set job status to cancelled FIRST (D-05)
    //    This prevents enqueueAllPapers from proceeding and
    //    causes early-return guards to fire in in-flight actions.
    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });

    // 5. Cancel workflow (D-02)
    if (job.workflowId) {
      try {
        await workflow.cancel(ctx, job.workflowId as WorkflowId);
      } catch (e) {
        console.warn(`[cancelExtractionJob] Failed to cancel workflow: ${e}`);
      }
    }

    // 6. Cancel each non-terminal paper's workpool item (D-01)
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_EXTRACTION_PAPERS_PER_JOB);

    let cancelledCount = 0;
    for (const paper of papers) {
      if (["completed", "failed", "cancelled"].includes(paper.status)) continue;

      if (paper.workpoolId) {
        try {
          await extractionPool.cancel(ctx, paper.workpoolId as WorkId);
        } catch (e) {
          console.warn(`[cancelExtractionJob] Failed to cancel workpool item: ${e}`);
        }
      }

      await ctx.db.patch(paper._id, {
        status: "cancelled",
        updatedAt: Date.now(),
      });
      cancelledCount++;
    }

    // 7. Update cancelledPapers counter (D-13)
    await ctx.db.patch(args.jobId, {
      cancelledPapers: (job.cancelledPapers ?? 0) + cancelledCount,
      updatedAt: Date.now(),
    });

    return null;
  },
});
```
[VERIFIED: API signatures from workpool 0.3.2 and workflow 0.3.10 source]

### Error Classification Integration in workpoolActions.ts
```typescript
// Source: D-08, wrapping existing pipeline
import { classifyExtractionError } from "./errors";

// Inside processExtractionPaper, replace the outer catch:
catch (error) {
  const classified = classifyExtractionError(error);

  console.error(
    `[ExtractionPipeline] Paper ${args.paperId} error: ${JSON.stringify({
      category: classified.category,
      retryable: classified.retryable,
      message: classified.message.slice(0, 200),
    })}`
  );

  if (classified.retryable) {
    // Rethrow so workpool retries (up to maxAttempts: 3)
    throw error;
  }

  // Permanent error -- save details and return failure (no retry)
  await ctx.runMutation(
    internal.extraction.mutations.updatePaperStatus,
    {
      paperId: args.paperId,
      status: "failed",
      errorMessage: `[${classified.category}] ${classified.message}`.slice(0, 500),
    }
  );

  return { success: false };
}
```

### Updated Progress Query with cancelledPapers
```typescript
// Source: D-12, D-13 -- extending existing getExtractionProgress
export const getExtractionProgress = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(
    v.null(),
    v.object({
      status: extractionJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      cancelledPapers: v.number(),  // NEW (D-13)
      percentComplete: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    // ... existing auth + load ...

    const handled = job.processedPapers + job.failedPapers + (job.cancelledPapers ?? 0);
    // ... rest of percent calculation ...

    return {
      status: job.status,
      totalPapers: job.totalPapers,
      processedPapers: job.processedPapers,
      failedPapers: job.failedPapers,
      cancelledPapers: job.cancelledPapers ?? 0,
      percentComplete,
    };
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `cancelAll` (screening pattern) | Per-paper `cancel(ctx, workpoolId)` | Phase 93 | Eliminates cross-user blast radius |
| Uniform retry (all errors retry) | Error classification (retryable vs permanent) | Phase 93 | Saves LLM spend on permanent failures |
| failedPapers includes cancelled | Separate cancelledPapers counter | Phase 93 | UI can distinguish user-cancelled from actual failures |

**Current codebase state (pre-Phase 93):**
- `workpoolId` already persisted on paper rows [VERIFIED: enqueueAllPapers line 211-213]
- `workflowId` already persisted on job rows [VERIFIED: createExtractionJob line 130]
- Early-return guards exist at 3 locations [VERIFIED: workflow.ts:39-49, workpoolActions.ts:58-64, mutations.ts:410-416]
- Progress query works reactively [VERIFIED: queries.ts:20-61]
- `handleExtractionComplete` handles `result.kind === "canceled"` in the else branch but counts it as failed [VERIFIED: mutations.ts:432-441]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OpenRouter errors include HTTP status codes in error messages that can be pattern-matched | Error Classification Pattern | Error messages may have different format -- classification logic would need adjustment. Mitigated by maxAttempts: 3 ceiling. |
| A2 | Default to retryable for unknown errors is the safer choice | Error Classification Pattern | Could waste 2 extra attempts per permanent failure. Low risk at maxAttempts: 3. |
| A3 | 200 papers max means cancel mutation stays within Convex transaction limits | Cancel Mutation | If limit increased beyond ~800, the cancel loop could hit document write limits. Current MAX is 200 -- well within bounds. |

## Open Questions

1. **Should `cancelledPapers` be a stored field or derived?**
   - What we know: D-13 says "add a cancelledPapers counter" but Claude's discretion includes whether it's a schema field or derived.
   - What's unclear: Whether deriving from paper count (`status === "cancelled"`) is preferable to denormalized counter.
   - Recommendation: Use a **denormalized counter** (schema field) to match the existing pattern for `processedPapers` and `failedPapers`. This avoids a count query on every progress read and is consistent with Convex guidelines against `.collect().length`. [VERIFIED: Convex guidelines say "maintain a denormalized counter"]

2. **Should the cancel mutation mark papers THEN cancel workpool, or vice versa?**
   - What we know: The cancel mutation should set job status first (to trigger early-return guards).
   - What's unclear: Whether to mark papers as cancelled before or after calling `extractionPool.cancel()`.
   - Recommendation: Call `extractionPool.cancel()` first (to prevent retry), then mark paper as cancelled. If `extractionPool.cancel()` throws (item already finished), still mark the paper. This matches the "cancel first, clean up second" principle.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest + convex-test 0.0.46 + @edge-runtime/vm |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run convex/extraction/cancel.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run convex/extraction/ --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WORK-03 | workpoolId persisted per paper for targeted cancel | unit | `npx vitest run convex/extraction/cancel.test.ts -t "iterates persisted workpoolId" -x` | Wave 0 |
| WORK-04 | Cancel mutation stops workflow, cancels papers, marks cancelled | unit | `npx vitest run convex/extraction/cancel.test.ts -t "cancels a processing job" -x` | Wave 0 |
| WORK-05 | Error classification: retryable throw, permanent return false | unit | `npx vitest run convex/extraction/errors.test.ts -x` | Wave 0 |
| WORK-08 | Early-return guards prevent LLM calls on cancelled jobs | unit | `npx vitest run convex/extraction/early-return.test.ts -x` | Wave 0 |
| WORK-09 | Reactive progress with cancelledPapers counter | unit | `npx vitest run convex/extraction/cancel.test.ts -t "cancelledPapers counter" -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run convex/extraction/ --reporter=verbose`
- **Per wave merge:** `npx vitest run convex/ --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `convex/extraction/cancel.test.ts` -- covers WORK-03, WORK-04, WORK-09 (modeled on screening/cancel.test.ts)
- [ ] `convex/extraction/errors.test.ts` -- covers WORK-05 (pure function, no Convex test harness needed)
- [ ] `convex/extraction/early-return.test.ts` -- covers WORK-08 (tests that mock LLM and assert never-called)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | `requireAuth(ctx)` from `convex/lib/auth.ts` -- same as screening [VERIFIED] |
| V3 Session Management | No | Handled by Clerk at app level |
| V4 Access Control | Yes | Ownership check: `job.userId !== user._id` -- prevents cancelling other users' jobs [VERIFIED: screening pattern] |
| V5 Input Validation | Yes | Convex validators on mutation args (`v.id("extractionJobs")`) [VERIFIED] |
| V6 Cryptography | No | No crypto in this phase |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| User cancels another user's job | Elevation of Privilege | Ownership check: `job.userId !== user._id` returns NOT_FOUND (no info leak) |
| Replay/timing attack on cancel | Tampering | Idempotent terminal-status guard -- re-cancelling is a no-op |
| Cancel mutation as DoS vector | Denial of Service | Auth required, single job at a time per user (checked in createExtractionJob), bounded paper iteration (MAX 200) |

## Project Constraints (from CLAUDE.md)

- **Convex backend:** All mutations, queries, and actions follow `convex/_generated/ai/guidelines.md` patterns.
- **No legacy code:** Destructive rebuild -- no backward compatibility concerns.
- **Test-first discipline:** Tests required for all new code paths.
- **DRY principle:** Reuse screening cancel pattern -- do not reinvent auth/ownership/idempotency checks.
- **Modern standards:** Use current `@convex-dev/workpool` 0.3.2 API (not deprecated `resultValidator` export).
- **No dead code:** If any dead code paths are found in early-return verification, remove them.

## Sources

### Primary (HIGH confidence)
- `node_modules/@convex-dev/workpool/src/client/index.ts` -- cancel() API at line 238, cancelAll() at line 249, RunResult type, defineOnComplete
- `node_modules/@convex-dev/workpool/src/component/shared.ts` -- vResult validator (success/failed/canceled kinds) at line 73-86
- `node_modules/@convex-dev/workflow/src/client/index.ts` -- WorkflowManager.cancel() at line 634
- `convex/screening/mutations.ts:169-214` -- cancelScreeningJob reference implementation
- `convex/screening/cancel.test.ts` -- 8-test cancel suite template
- `convex/extraction/mutations.ts` -- existing mutations including handleExtractionComplete, enqueueAllPapers
- `convex/extraction/workpoolActions.ts` -- existing pipeline with early-return guards
- `convex/extraction/workflow.ts` -- existing workflow with early-return guards
- `convex/extraction/queries.ts` -- existing progress query
- `convex/schema.ts:408-460` -- extractionJobs and extractionPapers tables
- `convex/workpool.ts` -- extractionPool configuration (maxParallelism: 5, maxAttempts: 3)
- `convex/workflow.ts` -- WorkflowManager singleton

### Secondary (MEDIUM confidence)
- `convex/_generated/ai/guidelines.md` -- Convex API patterns and conventions
- `convex/lib/errors.ts` -- ErrorCode union type (EXTRACTION_JOB_NOT_FOUND already exists)

### Tertiary (LOW confidence)
- Error message patterns for OpenRouter errors (A1 in Assumptions Log) -- needs runtime verification

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all packages already installed and verified from node_modules
- Architecture: HIGH -- patterns directly derived from existing screening module and verified workpool/workflow APIs
- Pitfalls: HIGH -- identified from actual code analysis (spelling mismatch, counter logic, race conditions)
- Error classification: MEDIUM -- error message patterns are assumed, need runtime tuning

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable -- workpool/workflow APIs change slowly)
