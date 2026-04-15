# Phase 95: Structured Observability & SLO Metrics - Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 8 (1 new, 7 modified)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `convex/extraction/logging.ts` | utility | transform | `convex/extraction/errors.ts` | exact |
| `convex/extraction/mutations.ts` | mutation | CRUD | self (existing file) | exact |
| `convex/extraction/workpoolActions.ts` | action | request-response | self (existing file) | exact |
| `convex/extraction/extract.ts` | service | request-response | self (existing file) | exact |
| `convex/extraction/queries.ts` | query | CRUD | self (`getExtractionProgress`) | exact |
| `convex/extraction/workflow.ts` | workflow | event-driven | self (existing file) | exact |
| `convex/schema.ts` | config | N/A | self (existing file) | exact |
| `convex/extraction/validators.ts` | config | N/A | self (existing file) | exact |

## Pattern Assignments

### `convex/extraction/logging.ts` (NEW - utility, transform)

**Analog:** `convex/extraction/errors.ts`

This is the only new file. It follows the same module-per-concern pattern as `errors.ts`: a pure function module with typed exports, no Convex function registrations, no `"use node"` directive.

**Module structure pattern** (errors.ts lines 1-10):
```typescript
/**
 * Error classification for the extraction pipeline.
 *
 * Pure function module -- no Convex imports, no "use node" directive.
 * [description of purpose]
 *
 * Consumed by workpoolActions.ts to decide retry vs fail behavior.
 */
```

**Type export pattern** (errors.ts lines 12-28):
```typescript
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
```

**Pure function export pattern** (errors.ts lines 45-99):
```typescript
export function classifyExtractionError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error);
  // ... classification logic ...
  return { retryable: true, category: "network", message };
}
```

**Import pattern for logging.ts consumers** (workpoolActions.ts line 19):
```typescript
import { classifyExtractionError } from "./errors";
```
New file will be imported the same way:
```typescript
import { emitStageLog, emitStageError, computeCostUsd } from "./logging";
```

**Id type import** (for typed params -- use `Id` from dataModel):
```typescript
import type { Id } from "../_generated/dataModel";
```

---

### `convex/extraction/mutations.ts` (MODIFY - mutation, CRUD)

**Analog:** self

**ULID insertion site** -- `createExtractionJob` (lines 89-101):
```typescript
// 5. Create extraction job record
const now = Date.now();
const jobId = await ctx.db.insert("extractionJobs", {
  userId: user._id,
  status: "pending",
  totalPapers: args.papers.length,
  processedPapers: 0,
  failedPapers: 0,
  questions: args.questions,
  createdAt: now,
  updatedAt: now,
});
```
Change: Add `traceId: ulid()` to the insert object. Import `{ ulid } from "ulid"` at the top.

**traceId propagation in enqueueAllPapers** (lines 291-305):
```typescript
const workId = await extractionPool.enqueueAction(
  ctx,
  internal.extraction.workpoolActions.processExtractionPaper,
  { paperId: paper._id, jobId: args.jobId },
  {
    onComplete: internal.extraction.mutations.handleExtractionComplete,
    context: { paperId: paper._id, jobId: args.jobId },
  }
);
```
Change: Add `traceId` to the action args object. Read it from the job row earlier in the handler.

**SLO computation site** -- `finalizeJobIfDone` (lines 459-489):
```typescript
export const finalizeJobIfDone = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;

    // Terminal states are no-ops
    if (TERMINAL_STATUSES.includes(job.status as (typeof TERMINAL_STATUSES)[number])) {
      return null;
    }

    const handled = job.processedPapers + job.failedPapers + (job.cancelledPapers ?? 0);
    if (handled >= job.totalPapers) {
      const now = Date.now();
      await ctx.db.patch(args.jobId, {
        status: "completed",
        completedAt: now,
        updatedAt: now,
      });
    }

    return null;
  },
});
```
Change: Before the `ctx.db.patch`, query `extractionResults` by job to compute `citationValidityRate`, then include it in the patch alongside `recallOnInclude: null`.

**Ad-hoc log to replace** (line 136):
```typescript
console.error(`[createExtractionJob] Failed to start workflow: ${e}`);
```

---

### `convex/extraction/workpoolActions.ts` (MODIFY - action, request-response)

**Analog:** self

**Args pattern to extend** (lines 38-42):
```typescript
export const processExtractionPaper = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
  },
```
Change: Add `traceId: v.string()`.

**Ad-hoc logs to replace with emitStageLog/emitStageError** (6 sites):

Site 1 -- parse success (lines 102-104):
```typescript
console.log(
  `[ExtractionPipeline] Paper ${args.paperId} parsed via ${result.parsingSource} (${result.bodyText.length} chars)`
);
```

Site 2 -- parse skip (lines 106-108):
```typescript
console.log(
  `[ExtractionPipeline] Paper ${args.paperId} already parsed, skipping to extraction`
);
```

Site 3 -- no bodyText error (lines 122-125):
```typescript
console.error(
  `[ExtractionPipeline] Paper ${args.paperId} has no bodyText after parsing`
);
```

Site 4 -- all questions failed (lines 219-222):
```typescript
console.error(
  `[ExtractionPipeline] All questions failed for paper ${args.paperId}`
);
```

Site 5 -- extraction success (lines 226-228):
```typescript
console.log(
  `[ExtractionPipeline] Paper ${args.paperId} extracted: ${extractionResults.filter((r) => r.answer !== null).length}/${extractionResults.length} questions answered`
);
```

Site 6 -- classified error (lines 234-239):
```typescript
console.error(
  `[ExtractionPipeline] Paper ${args.paperId} error: ${JSON.stringify({
    category: classified.category,
    retryable: classified.retryable,
    message: classified.message.slice(0, 200),
  })}`
);
```

**Timing instrumentation pattern** -- wrap each stage with `Date.now()` deltas:
```typescript
const startMs = Date.now();
// ... stage work ...
const latencyMs = Date.now() - startMs;
```

**Error classification reuse** (line 232):
```typescript
const classified = classifyExtractionError(error);
```
The `classified` object already has `{ retryable, category, message }` -- map directly to `emitStageError` params.

---

### `convex/extraction/extract.ts` (MODIFY - service, request-response)

**Analog:** self

**Function signature to extend** (lines 422-426):
```typescript
export async function extractAnswers(
  bodyText: string,
  questions: QuestionInput[],
  _parsingSource?: string
): Promise<ExtractionResult[]> {
```
Change: Add `traceId?: string` parameter. Thread it down to `extractSingleAnswer`.

**Call site in workpoolActions.ts** (lines 154-158):
```typescript
const results = await extractAnswers(
  parsedPaper.bodyText!,
  questions,
  parsedPaper.parsingSource,
);
```
Change: Add `args.traceId` as fourth argument.

---

### `convex/extraction/queries.ts` (MODIFY - query, CRUD)

**Analog:** `getExtractionProgress` (lines 20-64)

**Auth + ownership guard pattern** (lines 33-38):
```typescript
const user = await getCurrentUser(ctx);
if (!user) return null;

const job = await ctx.db.get(args.jobId);
if (!job || job.userId !== user._id) return null;
```

**Typed return pattern** (lines 22-31):
```typescript
returns: v.union(
  v.null(),
  v.object({
    status: extractionJobStatusValidator,
    totalPapers: v.number(),
    processedPapers: v.number(),
    failedPapers: v.number(),
    cancelledPapers: v.number(),
    percentComplete: v.number(),
  })
),
```

**Index-based querying pattern** (from mutations.ts lines 266-271):
```typescript
const completedPapers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job_status", (q) =>
    q.eq("jobId", args.jobId).eq("status", "completed")
  )
  .take(MAX_EXTRACTION_PAPERS_PER_JOB);
```

**Import pattern** (lines 1-10):
```typescript
import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import {
  extractionJobStatusValidator,
  extractionPaperStatusValidator,
  extractionQuestionValidator,
  parsingSourceValidator,
} from "./validators";
import { getCurrentUser } from "../lib/auth";
import { MAX_EXTRACTION_PAPERS_PER_JOB } from "../lib/queryBounds";
```

---

### `convex/extraction/workflow.ts` (MODIFY - workflow, event-driven)

**Analog:** self

**traceId read site** (lines 25-29):
```typescript
const job = await step.runQuery(
  internal.extraction.queries.getJobInternal,
  { jobId }
);
```
The `getJobInternal` query already returns the job row. Once `traceId` is added to the schema and the query's return validator, `job.traceId` will be available here. Pass it through to `enqueueAllPapers` args.

**enqueueAllPapers call site** (lines 52-54):
```typescript
await step.runMutation(
  internal.extraction.mutations.enqueueAllPapers,
  { jobId }
);
```
Change: Either pass `traceId` as an arg, or (simpler) have `enqueueAllPapers` read it from the job row directly since it already loads the job at line 253.

---

### `convex/schema.ts` (MODIFY - config)

**Analog:** self -- `extractionJobs` table definition (lines 410-437)

**Existing schema pattern for optional fields** (lines 422, 430-433):
```typescript
cancelledPapers: v.optional(v.number()),
// ...
workflowId: v.optional(v.string()),
createdAt: v.number(),
updatedAt: v.number(),
completedAt: v.optional(v.number()),
```
Change: Add three new optional fields following the same pattern:
```typescript
traceId: v.optional(v.string()),
citationValidityRate: v.optional(v.number()),
recallOnInclude: v.optional(v.number()),
```

---

### `convex/extraction/validators.ts` (MODIFY - config)

**Analog:** self

No new validators strictly required. The `traceId` is `v.string()` (inline validator), `citationValidityRate` and `recallOnInclude` are `v.number()` (inline). If the planner determines a shared validator is warranted for stage types, follow the existing pattern (lines 8-14):
```typescript
export const extractionJobStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("failed")
);
```

---

## Shared Patterns

### Authentication + User Isolation
**Source:** `convex/lib/auth.ts` lines 31-39 and `convex/extraction/queries.ts` lines 33-38
**Apply to:** New `getExtractionJobMetrics` query
```typescript
import { getCurrentUser } from "../lib/auth";

// Inside query handler:
const user = await getCurrentUser(ctx);
if (!user) return null;

const job = await ctx.db.get(args.jobId);
if (!job || job.userId !== user._id) return null;
```

### Bounded Collection Reads
**Source:** `convex/extraction/mutations.ts` lines 266-271 and `convex/lib/queryBounds.ts` line 22
**Apply to:** All new aggregation queries over `extractionPapers` and `extractionResults`
```typescript
import { MAX_EXTRACTION_PAPERS_PER_JOB } from "../lib/queryBounds";

// Papers: bounded by job limit
const papers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job_status", (q) =>
    q.eq("jobId", args.jobId).eq("status", "completed")
  )
  .take(MAX_EXTRACTION_PAPERS_PER_JOB);

// Results: bounded by papers * questions upper bound
const results = await ctx.db
  .query("extractionResults")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .take(MAX_EXTRACTION_PAPERS_PER_JOB * 10);
```

### Error Classification Reuse
**Source:** `convex/extraction/errors.ts` lines 12-28
**Apply to:** `emitStageError` params in `logging.ts`
```typescript
import type { ErrorCategory } from "./errors";

export interface StageErrorParams extends StageLogParams {
  errorMessage: string;
  errorCategory: ErrorCategory;
  retryable: boolean;
}
```

### Typed Return Validators (No v.any())
**Source:** `convex/extraction/queries.ts` lines 22-31
**Apply to:** New `getExtractionJobMetrics` query return type
```typescript
returns: v.union(
  v.null(),
  v.object({
    papersProcessed: v.number(),
    averageLatencyMs: v.union(v.number(), v.null()),
    estimatedCostUsd: v.number(),
    errorCount: v.number(),
    citationValidityRate: v.union(v.number(), v.null()),
    recallOnInclude: v.union(v.number(), v.null()),
  })
),
```

### Denormalized Counter Pattern
**Source:** `convex/extraction/mutations.ts` lines 517-529 (handleExtractionComplete incrementing processedPapers/failedPapers)
**Apply to:** SLO metric persistence in `finalizeJobIfDone` -- compute once at completion, persist on job row
```typescript
await ctx.db.patch(args.jobId, {
  status: "completed",
  completedAt: now,
  updatedAt: now,
  citationValidityRate,      // computed from extractionResults
  recallOnInclude: null,     // Phase 96
});
```

### Test Pattern: convex-test with Schema + Seed Helpers
**Source:** `convex/extraction/mutations.test.ts` lines 1-73
**Apply to:** New test cases for logging, metrics query, SLO persistence
```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

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

async function seedExtractionJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  overrides: Partial<{ /* ... */ }> = {}
) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("extractionJobs", { /* ... */ });
    return (await ctx.db.get(id))!;
  });
}
```

### Test Pattern: Pure Function Unit Tests (No convex-test)
**Source:** `convex/extraction/errors.test.ts` lines 1-5
**Apply to:** `logging.test.ts` for `emitStageLog`, `emitStageError`, `computeCostUsd`
```typescript
import { describe, it, expect } from "vitest";
import { classifyExtractionError } from "./errors";

describe("classifyExtractionError", () => {
  it("classifies AbortError DOMException as retryable timeout", () => {
    const error = new DOMException("Operation timed out", "AbortError");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: true,
      category: "timeout",
      message: "Operation timed out",
    });
  });
});
```
For logging tests, use `vi.spyOn(console, "info")` to capture and assert structured JSON output.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| -- | -- | -- | All files have exact analogs in the existing codebase |

Every file in this phase either already exists (modification) or has a direct structural analog (`logging.ts` mirrors `errors.ts`). No files require patterns from RESEARCH.md as fallback.

## Metadata

**Analog search scope:** `convex/extraction/`, `convex/lib/`, `convex/schema.ts`
**Files scanned:** 12
**Pattern extraction date:** 2026-04-15
