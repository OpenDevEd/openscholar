# Phase 93: Workflow Cancel, Retry, and Progress - Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 8 (new/modified)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `convex/extraction/mutations.ts` (add `cancelExtractionJob`) | controller (mutation) | request-response | `convex/screening/mutations.ts:cancelScreeningJob` (lines 169-214) | exact |
| `convex/extraction/errors.ts` (NEW) | utility | transform | `convex/lib/errors.ts` (structure) + no direct analog for classification logic | role-match |
| `convex/extraction/workpoolActions.ts` (wrap pipeline with error classification) | service (action) | request-response | `convex/extraction/workpoolActions.ts` (self -- lines 230-235 existing catch block) | exact |
| `convex/extraction/mutations.ts` (modify `handleExtractionComplete`) | controller (mutation) | event-driven | `convex/extraction/mutations.ts:handleExtractionComplete` (self -- lines 400-457) | exact |
| `convex/extraction/mutations.ts` (modify `finalizeJobIfDone`) | controller (mutation) | event-driven | `convex/extraction/mutations.ts:finalizeJobIfDone` (self -- lines 363-391) | exact |
| `convex/extraction/queries.ts` (modify `getExtractionProgress`) | controller (query) | request-response | `convex/extraction/queries.ts:getExtractionProgress` (self -- lines 20-61) | exact |
| `convex/schema.ts` (add `cancelledPapers` field) | config | N/A | `convex/schema.ts` (self -- lines 410-436) | exact |
| `convex/extraction/cancel.test.ts` (NEW) | test | N/A | `convex/screening/cancel.test.ts` (lines 1-240) | exact |
| `convex/extraction/errors.test.ts` (NEW) | test | N/A | `convex/extraction/extract.test.ts` (lines 1-46, pure-function vitest pattern) | role-match |
| `convex/extraction/early-return.test.ts` (NEW) | test | N/A | `convex/extraction/mutations.test.ts` (lines 310-342, terminal-status guard tests) | role-match |

## Pattern Assignments

### `convex/extraction/mutations.ts` -- `cancelExtractionJob` mutation (controller, request-response)

**Analog:** `convex/screening/mutations.ts:cancelScreeningJob` (lines 169-214)

**Imports pattern** (extraction/mutations.ts lines 1-18 -- already present, extend with WorkId type):
```typescript
import { mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { WorkId } from "@convex-dev/workpool";          // NEW for cancel
import type { WorkflowId } from "@convex-dev/workflow";      // NEW for cancel
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { MAX_EXTRACTION_PAPERS_PER_JOB } from "../lib/queryBounds";
import { workflow } from "../workflow";
import { extractionPool } from "../workpool";
```
Note: `WorkflowId` import already exists in `convex/screening/mutations.ts` line 4. `WorkId` is imported as a type -- verified from `@convex-dev/workpool` source.

**Auth + ownership pattern** (screening/mutations.ts lines 172-179):
```typescript
const user = await requireAuth(ctx);

const job = await ctx.db.get("screeningJobs", args.jobId);

if (!job || job.userId !== user._id) {
  throw createError("SCREENING_JOB_NOT_FOUND", "Screening job not found");
}
```
Adapt: Replace `"screeningJobs"` with `args.jobId` (Convex `ctx.db.get` infers table from Id type), replace error code with `"EXTRACTION_JOB_NOT_FOUND"`. Error code already exists in `convex/lib/errors.ts` line 55.

**Terminal-status idempotent guard** (screening/mutations.ts lines 182-188):
```typescript
// Terminal states are idempotent no-ops
if (
  TERMINAL_STATUSES.includes(
    job.status as (typeof TERMINAL_STATUSES)[number]
  )
) {
  return null;
}
```
Note: `TERMINAL_STATUSES` is already defined in extraction/mutations.ts line 19 as `["completed", "cancelled", "failed"]`. Screening includes `"creditsExhausted"` but extraction does not.

**Workflow cancel pattern** (screening/mutations.ts lines 197-203):
```typescript
// Cancel workflow if running
if (job.workflowId) {
  try {
    await workflow.cancel(ctx, job.workflowId as WorkflowId);
  } catch (e) {
    console.warn(`[cancelScreeningJob] Failed to cancel workflow: ${e}`);
  }
}
```
Copy exactly, rename log prefix to `[cancelExtractionJob]`.

**Workpool cancel pattern -- SCREENING uses cancelAll (DO NOT COPY THIS PART):**
```typescript
// screening/mutations.ts lines 206-210 -- DO NOT COPY
try {
  await screeningPool.cancelAll(ctx);  // <-- blast radius: cancels ALL items across all jobs
} catch (e) {
  console.warn(`[cancelScreeningJob] Failed to cancel workpool items: ${e}`);
}
```
**INSTEAD, use targeted per-paper cancel** -- iterate extractionPapers by job, call `extractionPool.cancel(ctx, paper.workpoolId as WorkId)` on each non-terminal paper. The paper iteration pattern already exists in `enqueueAllPapers` (extraction/mutations.ts lines 170-176):
```typescript
// From enqueueAllPapers lines 170-176 -- query pattern to reuse
const pendingPapers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job_status", (q) =>
    q.eq("jobId", args.jobId).eq("status", "pending")
  )
  .take(MAX_EXTRACTION_PAPERS_PER_JOB);
```
For cancel: use `by_job` index (not `by_job_status`) since we want ALL non-terminal papers, not just pending ones.

**Status update pattern** (screening/mutations.ts lines 191-194):
```typescript
await ctx.db.patch("screeningJobs", args.jobId, {
  status: "cancelled",
  updatedAt: Date.now(),
});
```
Note: Set job status to `"cancelled"` FIRST before iterating papers. This triggers early-return guards in in-flight actions.

---

### `convex/extraction/errors.ts` -- `classifyExtractionError` (utility, transform)

**Analog:** No direct analog. `convex/lib/errors.ts` provides the error factory pattern but not classification logic. This is a NEW pure-function module.

**Module structure pattern** (from lib/errors.ts lines 1-81):
```typescript
// convex/lib/errors.ts -- type export + factory function pattern
export type ErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | /* ... */;
export type ErrorData = { code: ErrorCode; message?: string };
export function createError(code: ErrorCode, message?: string): ConvexError<ErrorData> { /* ... */ }
```
Follow the same pattern: export type + export function. No Convex imports needed (pure function).

**File structure to follow:**
```typescript
// 1. Type exports first
export type ErrorCategory = "network" | "rate_limit" | /* ... */;
export type ClassifiedError = { retryable: boolean; category: ErrorCategory; message: string };

// 2. Pure function export
export function classifyExtractionError(error: unknown): ClassifiedError { /* ... */ }
```

No `"use node"` directive -- this is a pure function, not a Convex action. It will be imported by `workpoolActions.ts` (which runs in Node) but the file itself has no runtime dependency.

---

### `convex/extraction/workpoolActions.ts` -- error classification wrapping (service, request-response)

**Analog:** `convex/extraction/workpoolActions.ts` (self -- lines 78, 230-235)

**Existing catch block** (workpoolActions.ts lines 230-235):
```typescript
} catch (error) {
  console.error(
    `[ExtractionPipeline] Pipeline failed for paper ${args.paperId}: ${error instanceof Error ? error.message : String(error)}`
  );
  throw error;
}
```
Replace with classification-aware catch. The credit-exhaustion catch at lines 168-188 remains as-is (it handles a specific upstream case). The outer catch at line 230 is the one to modify.

**Error handling pattern to apply** (new, based on D-08):
```typescript
import { classifyExtractionError } from "./errors";

// Replace the outer catch block:
} catch (error) {
  const classified = classifyExtractionError(error);

  console.error(
    `[ExtractionPipeline] Paper ${args.paperId} error: ${JSON.stringify({
      category: classified.category,
      retryable: classified.retryable,
      message: classified.message.slice(0, 200),
    })}`
  );

  if (classified.retryable) {
    throw error;  // Workpool retries (up to maxAttempts: 3)
  }

  // Permanent error -- save and return failure (no retry)
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
The `updatePaperStatus` mutation already exists (extraction/mutations.ts lines 271-293) and accepts `errorMessage`.

---

### `convex/extraction/mutations.ts` -- `handleExtractionComplete` modification (controller, event-driven)

**Analog:** `convex/extraction/mutations.ts:handleExtractionComplete` (self -- lines 400-457)

**Current else branch** (lines 432-449) -- treats both `"failed"` and `"canceled"` as failed:
```typescript
} else {
  // Error or cancelled
  await ctx.db.patch(context.paperId, {
    status: "failed",
    completedAt: Date.now(),
    updatedAt: Date.now(),
    errorMessage:
      result.kind === "error"
        ? String(result.error).slice(0, 500)
        : "Cancelled",
  });

  // Increment failedPapers
  await ctx.db.patch(context.jobId, {
    failedPapers: (job.failedPapers ?? 0) + 1,
    updatedAt: Date.now(),
  });
}
```

**Modify to:** Split the else branch into `"canceled"` vs `"error"/"failed"`. CRITICAL: workpool uses American spelling `"canceled"` (one 'l') per `node_modules/@convex-dev/workpool/src/component/shared.ts:83`. The schema uses British `"cancelled"` (two l's).

```typescript
} else if (result.kind === "canceled") {
  // Cancelled by cancelExtractionJob -- count as cancelled, not failed
  await ctx.db.patch(context.paperId, {
    status: "cancelled",       // British spelling in schema
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

---

### `convex/extraction/mutations.ts` -- `finalizeJobIfDone` modification (controller, event-driven)

**Analog:** `convex/extraction/mutations.ts:finalizeJobIfDone` (self -- lines 363-391)

**Current finalization check** (line 380):
```typescript
if (job.processedPapers + job.failedPapers >= job.totalPapers) {
```

**Modify to include cancelledPapers:**
```typescript
const handled = job.processedPapers + job.failedPapers + (job.cancelledPapers ?? 0);
if (handled >= job.totalPapers) {
```

---

### `convex/extraction/queries.ts` -- `getExtractionProgress` modification (controller, request-response)

**Analog:** `convex/extraction/queries.ts:getExtractionProgress` (self -- lines 20-61)

**Current return validator** (lines 22-31):
```typescript
returns: v.union(
  v.null(),
  v.object({
    status: extractionJobStatusValidator,
    totalPapers: v.number(),
    processedPapers: v.number(),
    failedPapers: v.number(),
    percentComplete: v.number(),
  })
),
```

**Add `cancelledPapers`:**
```typescript
returns: v.union(
  v.null(),
  v.object({
    status: extractionJobStatusValidator,
    totalPapers: v.number(),
    processedPapers: v.number(),
    failedPapers: v.number(),
    cancelledPapers: v.number(),    // NEW (D-13)
    percentComplete: v.number(),
  })
),
```

**Current handled calculation** (line 41):
```typescript
const handled = job.processedPapers + job.failedPapers;
```

**Modify to:**
```typescript
const handled = job.processedPapers + job.failedPapers + (job.cancelledPapers ?? 0);
```

**Add to return object:**
```typescript
cancelledPapers: job.cancelledPapers ?? 0,
```

---

### `convex/schema.ts` -- `extractionJobs` table modification (config)

**Analog:** `convex/schema.ts` (self -- lines 410-436)

**Current extractionJobs fields** (lines 410-432):
```typescript
extractionJobs: defineTable({
  userId: v.id("users"),
  status: v.union(
    v.literal("pending"),
    v.literal("processing"),
    v.literal("completed"),
    v.literal("cancelled"),
    v.literal("failed")
  ),
  totalPapers: v.number(),
  processedPapers: v.number(),
  failedPapers: v.number(),
  // ... questions, workflowId, timestamps ...
})
```

**Add field** (after `failedPapers`):
```typescript
cancelledPapers: v.optional(v.number()),
```
Use `v.optional` for backward compatibility with existing rows that lack this field (they will read as `undefined`, handled via `?? 0` in queries).

---

### `convex/extraction/cancel.test.ts` (NEW test file)

**Analog:** `convex/screening/cancel.test.ts` (lines 1-240)

**Test file structure** (screening/cancel.test.ts lines 1-6):
```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";
import schema from "../schema";
```

**Seed helpers -- reuse extraction pattern** (extraction/mutations.test.ts lines 10-73):
```typescript
// seedUser -- lines 10-24
async function seedUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_extraction_test",
      email: "extraction-test@example.com",
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLoginAt: Date.now(),
    });
    return (await ctx.db.get(userId))!;
  });
}

// seedExtractionJob -- lines 26-49
async function seedExtractionJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  overrides: Partial<{
    status: "pending" | "processing" | "completed" | "cancelled" | "failed";
    totalPapers: number;
    processedPapers: number;
    failedPapers: number;
  }> = {}
) { /* ... */ }

// seedExtractionPaper -- lines 51-73
async function seedExtractionPaper(
  t: ReturnType<typeof convexTest>,
  jobId: Id<"extractionJobs">,
  openalexId: string,
  status: "pending" | "parsing" | "extracting" | "completed" | "failed" | "cancelled" = "pending"
) { /* ... */ }
```
Note: For cancel tests, the seedUser helper must accept unique `clerkId` and `email` params (as in screening/cancel.test.ts lines 9-27) to allow multiple users in the same test. Also need to add `workpoolId` parameter to `seedExtractionPaper`.

**Test authentication pattern** (screening/cancel.test.ts lines 107-108):
```typescript
const asUser = t.withIdentity({ subject: "clerk_cancel2" });
// Then call mutations via asUser:
await asUser.mutation(api.screening.mutations.cancelScreeningJob, { jobId });
```
Adapt: `api.extraction.mutations.cancelExtractionJob`.

**Test cases to replicate** from screening/cancel.test.ts (8 tests):
1. Rejects unauthenticated calls (line 94-103)
2. Rejects when job not found (line 105-119)
3. Rejects when job belongs to another user (line 121-132)
4. Cancels a pending job (line 134-145)
5. Cancels a processing job (line 147-157)
6. Idempotent for already-cancelled job (line 159-174)
7. Idempotent for completed job (line 176-186)
8. Idempotent for failed job (line 188-198)

**Additional cancel-specific tests needed for extraction:**
9. Iterates persisted workpoolIds (targeted cancel, not cancelAll) -- new
10. Papers with workpoolId get cancelled; papers without get status-only update -- new
11. cancelledPapers counter incremented correctly -- new
12. Preserves existing extraction results after cancel (mirrors screening line 200-239) -- new

---

### `convex/extraction/errors.test.ts` (NEW test file)

**Analog:** `convex/extraction/extract.test.ts` (lines 1-46 for vitest structure with mocks)

**Pure function test pattern** -- simpler than Convex test (no `convexTest` needed):
```typescript
import { describe, it, expect } from "vitest";
import { classifyExtractionError } from "./errors";
```
No `convex-test`, no schema import, no seed helpers. Just direct function calls and assertions.

---

### `convex/extraction/early-return.test.ts` (NEW test file)

**Analog:** `convex/extraction/mutations.test.ts` (lines 310-342, terminal-status guard tests)

**Existing terminal-guard test pattern** (mutations.test.ts lines 310-342):
```typescript
it("terminal job status is a no-op for finalization", async () => {
  const t = convexTest(schema);
  const user = await seedUser(t);
  const job = await seedExtractionJob(t, user._id, {
    status: "cancelled",
    totalPapers: 2,
    processedPapers: 2,
    failedPapers: 0,
  });

  await t.run(async (ctx) => {
    const freshJob = await ctx.db.get(job._id);
    if (!freshJob) return;
    const TERMINAL = ["completed", "cancelled", "failed"];
    if (TERMINAL.includes(freshJob.status)) return;
    // This should never execute for cancelled jobs
    await ctx.db.patch(job._id, { /* ... */ });
  });

  const finalJob = await t.run(async (ctx) => ctx.db.get(job._id));
  expect(finalJob?.status).toBe("cancelled");
});
```

For early-return tests: test that workflow steps, workpool actions, and completion handlers all return early when job status is terminal. The action test will need `vi.mock` for the LLM call (as in extract.test.ts lines 8-16) to assert it was never invoked.

---

## Shared Patterns

### Authentication
**Source:** `convex/lib/auth.ts:requireAuth` (lines 48-64)
**Apply to:** `cancelExtractionJob` mutation

```typescript
export async function requireAuth(ctx: AuthContext, allowSyncing?: boolean): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw createError("UNAUTHENTICATED", "Authentication required");
  }
  const user = await getUserByClerkId(ctx, identity.subject);
  if (!user) {
    throw createError("UNAUTHENTICATED", "Authentication required");
  }
  return assertActiveUser(user);
}
```

### Error Factory
**Source:** `convex/lib/errors.ts:createError` (lines 73-81)
**Apply to:** `cancelExtractionJob` mutation (for NOT_FOUND errors)

```typescript
export function createError(
  code: ErrorCode,
  message?: string
): ConvexError<ErrorData> {
  if (message) {
    return new ConvexError({ code, message });
  }
  return new ConvexError({ code });
}
```
Error code `"EXTRACTION_JOB_NOT_FOUND"` already exists at line 55.

### Terminal-Status Guard
**Source:** `convex/extraction/mutations.ts` line 19
**Apply to:** All mutations and the cancel mutation

```typescript
const TERMINAL_STATUSES = ["completed", "cancelled", "failed"] as const;
```
Reuse this existing constant -- do not redeclare.

### Workpool/Workflow Singletons
**Source:** `convex/workpool.ts` (lines 16-24) and `convex/workflow.ts` (lines 1-14)
**Apply to:** `cancelExtractionJob` mutation

```typescript
// convex/workpool.ts
export const extractionPool = new Workpool(components.extractionWorkpool, {
  maxParallelism: 5,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 2000, base: 2 },
});

// convex/workflow.ts
export const workflow = new WorkflowManager(components.workflow, { /* ... */ });
```
Already imported in extraction/mutations.ts lines 16-17.

### Convex Test Helpers
**Source:** `convex/extraction/mutations.test.ts` (lines 10-73) and `convex/screening/cancel.test.ts` (lines 9-91)
**Apply to:** All new test files

Pattern: `seedUser`, `seedExtractionJob`, `seedExtractionPaper` helpers create data directly via `ctx.db.insert` inside `t.run()`. Authentication is simulated via `t.withIdentity({ subject: clerkId })`.

### Query Bounds
**Source:** `convex/lib/queryBounds.ts` line 22
**Apply to:** Cancel mutation paper iteration

```typescript
export const MAX_EXTRACTION_PAPERS_PER_JOB = 200;
```
Use as the `.take()` limit when iterating papers in the cancel mutation.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `convex/extraction/errors.ts` | utility | transform | No error classification module exists in the codebase. The `convex/lib/errors.ts` provides a factory for Convex errors but not a classifier for HTTP/network/validation errors. Research pattern from RESEARCH.md is the reference. |

---

## Metadata

**Analog search scope:** `convex/extraction/`, `convex/screening/`, `convex/lib/`, `convex/schema.ts`, `convex/workpool.ts`, `convex/workflow.ts`
**Files scanned:** 18
**Pattern extraction date:** 2026-04-15
