# Phase 89: Core Schema & Workflow Skeleton - Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 10 (new/modified)
**Analogs found:** 10 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `convex/schema.ts` (modify) | config | CRUD | `convex/schema.ts` (screeningJobs/screeningResults sections) | exact |
| `convex/convex.config.ts` (modify) | config | request-response | `convex/convex.config.ts` (screeningWorkpool registration) | exact |
| `convex/workpool.ts` (modify) | config | request-response | `convex/workpool.ts` (screeningPool instance) | exact |
| `convex/extraction/validators.ts` (create) | utility | transform | `convex/screening/validators.ts` | exact |
| `convex/extraction/workflow.ts` (create) | service | request-response | `convex/screening/workflow.ts` | exact |
| `convex/extraction/mutations.ts` (create) | service | CRUD | `convex/screening/mutations.ts` | exact |
| `convex/extraction/queries.ts` (create) | service | CRUD | `convex/screening/queries.ts` | exact |
| `convex/extraction/workpoolActions.ts` (create) | service | request-response | `convex/screening/workpoolActions.ts` | exact |
| `convex/extraction/mutations.test.ts` (create) | test | CRUD | `convex/screening/mutations.test.ts` | exact |
| `convex/lib/queryBounds.ts` (modify) | utility | transform | `convex/lib/queryBounds.ts` (screening constant) | exact |

## Pattern Assignments

### `convex/schema.ts` (config, CRUD) -- MODIFY

**Analog:** `convex/schema.ts` lines 317-404 (screeningJobs + screeningResults tables)

**Table definition pattern** (lines 319-362, screeningJobs):
```typescript
screeningJobs: defineTable({
  userId: v.id("users"),
  status: v.union(
    v.literal("pending"),
    v.literal("processing"),
    v.literal("completed"),
    v.literal("cancelled"),
    v.literal("failed"),
    v.literal("creditsExhausted")
  ),
  totalPapers: v.number(),
  processedPapers: v.number(),
  failedPapers: v.number(),
  qualifiedPapers: v.number(),
  questions: v.array(
    v.object({ key: v.string(), question: v.string() })
  ),
  // ... additional fields ...
  workflowId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"])
  .index("by_workflow", ["workflowId"]),
```

**Result table with composite index pattern** (lines 366-404, screeningResults):
```typescript
screeningResults: defineTable({
  jobId: v.id("screeningJobs"),
  openalexId: v.string(),
  title: v.string(),
  // ... fields ...
  status: v.union(
    v.literal("pending"),
    v.literal("processing"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("skipped")
  ),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
})
  .index("by_job", ["jobId"])
  .index("by_job_status", ["jobId", "status"])
  .index("by_job_openalexId", ["jobId", "openalexId"]),
```

**Apply to new tables:** `extractionJobs` mirrors `screeningJobs` (with extraction-specific status enum and questions shape). `extractionPapers` mirrors `screeningResults` (with `workpoolId` field per D-03 and `by_job`/`by_job_status` indexes). `extractionResults` adds `by_paper_question` composite index per D-04.

---

### `convex/convex.config.ts` (config, request-response) -- MODIFY

**Analog:** `convex/convex.config.ts` lines 1-11

**Component registration pattern** (full file):
```typescript
import { defineApp } from "convex/server";
import stripe from "@convex-dev/stripe/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";
import screeningWorkpool from "@convex-dev/workpool/convex.config.js";

const app = defineApp();
app.use(stripe);
app.use(workflow);
app.use(screeningWorkpool, { name: "screeningWorkpool" });

export default app;
```

**Apply:** Add a second workpool import (aliased as `extractionWorkpool`) and register with `app.use(extractionWorkpool, { name: "extractionWorkpool" })`. Note: the import path is the same (`@convex-dev/workpool/convex.config.js`), use a different import alias.

---

### `convex/workpool.ts` (config, request-response) -- MODIFY

**Analog:** `convex/workpool.ts` lines 1-13

**Workpool instance pattern** (full file):
```typescript
import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";

// For bulk screening operations
export const screeningPool = new Workpool(components.screeningWorkpool, {
  maxParallelism: 5,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2,
  },
});
```

**Apply:** Add `extractionPool` with identical config: `new Workpool(components.extractionWorkpool, { maxParallelism: 5, retryActionsByDefault: true, defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 2000, base: 2 } })`.

---

### `convex/extraction/validators.ts` (utility, transform) -- CREATE

**Analog:** `convex/screening/validators.ts` lines 1-71

**Validator export pattern** (full file):
```typescript
import { v } from "convex/values";

/**
 * Screening question snapshot embedded in job records.
 */
export const screeningQuestionValidator = v.object({
  key: v.string(),
  question: v.string(),
});

// ... per-domain rule validators ...

/**
 * Screening job lifecycle statuses.
 */
export const screeningJobStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("failed"),
  v.literal("creditsExhausted")
);

/**
 * Individual screening result statuses.
 */
export const screeningResultStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("skipped")
);
```

**Apply:** Create extraction equivalents: `extractionJobStatusValidator` (D-06 enum without `creditsExhausted`), `extractionPaperStatusValidator` (D-07 enum with `parsing`/`extracting`), `extractionQuestionValidator` (with `expectedType` field).

---

### `convex/extraction/workflow.ts` (service, request-response) -- CREATE

**Analog:** `convex/screening/workflow.ts` lines 1-74

**Imports pattern** (lines 1-4):
```typescript
import { workflow } from "../workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
```

**Workflow definition pattern** (lines 18-74):
```typescript
export const runScreeningWorkflow = workflow.define({
  args: {
    jobId: v.id("screeningJobs"),
  },
  handler: async (step, { jobId }) => {
    console.log(`[ScreeningWorkflow] Starting screening for job ${jobId}`);

    // 1. Load job
    const job = await step.runQuery(
      internal.screening.queries.getJobInternal,
      { jobId }
    );

    if (!job) {
      throw createError("NOT_FOUND", `Screening job ${jobId} not found`);
    }

    // 2. Load pending results
    const pendingResults = await step.runQuery(
      internal.screening.queries.getPendingResults,
      { jobId }
    );

    if (pendingResults.length === 0) {
      console.log(
        `[ScreeningWorkflow] No pending results for job ${jobId}, marking complete`
      );
      await step.runMutation(
        internal.screening.mutations.updateJobStatus,
        { jobId, status: "completed" }
      );
      return;
    }

    // 3. Update status to processing
    await step.runMutation(
      internal.screening.mutations.updateJobStatus,
      { jobId, status: "processing" }
    );

    // 4. Enqueue each paper for independent AI screening
    for (const result of pendingResults) {
      await step.runMutation(
        internal.screening.mutations.enqueueScreeningPaper,
        {
          resultId: result._id,
          jobId,
        }
      );
    }
  },
});
```

**Key difference per D-08:** Extraction workflow replaces the per-paper `for` loop (step 4) with a single `step.runMutation(internal.extraction.mutations.enqueueAllPapers, { jobId })` call. Only 3 journaled steps total: (1) load+validate, (2) batched enqueue, (3) no-op finalization.

---

### `convex/extraction/mutations.ts` (service, CRUD) -- CREATE

**Analog:** `convex/screening/mutations.ts` lines 1-579

**Imports pattern** (lines 1-19):
```typescript
import { mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { WorkflowId } from "@convex-dev/workflow";
import type { Doc } from "../_generated/dataModel";
import {
  screeningPaperInputValidator,
  screeningQuestionValidator,
  screeningScoringConfigValidator,
  screeningJobStatusValidator,
} from "./validators";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { workflow } from "../workflow";
import { screeningPool } from "../workpool";
```

**Public mutation with auth + validation pattern** (lines 37-158, createScreeningJob):
```typescript
export const createScreeningJob = mutation({
  args: {
    papers: v.array(screeningPaperInputValidator),
    questions: v.array(screeningQuestionValidator),
    // ...
  },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  handler: async (ctx, args) => {
    // 1. Authentication
    const user = await requireAuth(ctx);

    // 2. Validate paper count
    if (args.papers.length === 0) {
      throw createError("VALIDATION_ERROR", "At least one paper is required");
    }

    // 3. Check for active jobs
    const pendingJob = await ctx.db
      .query("screeningJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "pending")
      )
      .first();
    if (pendingJob) {
      throw createError("SCREENING_JOB_ALREADY_ACTIVE", "...");
    }

    // ... credit check, insert job, insert results ...

    // 7. Start workflow
    try {
      const workflowId = await workflow.start(
        ctx,
        internal.screening.workflow.runScreeningWorkflow,
        { jobId }
      );
      await ctx.db.patch("screeningJobs", jobId, { workflowId: String(workflowId) });
    } catch (e) {
      console.error(`[createScreeningJob] Failed to start workflow: ${e}`);
    }

    return { jobId };
  },
});
```

**Internal mutation with status update pattern** (lines 223-236):
```typescript
export const updateJobStatus = internalMutation({
  args: {
    jobId: v.id("screeningJobs"),
    status: screeningJobStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("screeningJobs", args.jobId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return null;
  },
});
```

**Workpool enqueue pattern** (lines 244-265, enqueueScreeningPaper):
```typescript
export const enqueueScreeningPaper = internalMutation({
  args: {
    resultId: v.id("screeningResults"),
    jobId: v.id("screeningJobs"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("screeningResults", args.resultId, { status: "processing" });

    await screeningPool.enqueueAction(
      ctx,
      internal.screening.workpoolActions.screenPaperAction,
      { resultId: args.resultId, jobId: args.jobId },
      {
        onComplete: internal.screening.mutations.handleScreeningComplete,
        context: { resultId: args.resultId, jobId: args.jobId },
      }
    );

    return null;
  },
});
```

**Finalization pattern** (lines 385-430, finalizeScreeningJobIfDone):
```typescript
export const finalizeScreeningJobIfDone = internalMutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("screeningJobs", args.jobId);
    if (!job) return null;

    // Terminal states are no-ops
    const TERMINAL_STATUSES = ["completed", "cancelled", "failed", "creditsExhausted"];
    if (TERMINAL_STATUSES.includes(job.status as string)) {
      return null;
    }

    // Check if all papers are processed
    if (job.processedPapers + job.failedPapers >= job.totalPapers) {
      const now = Date.now();
      await ctx.db.patch("screeningJobs", args.jobId, {
        status: "completed",
        completedAt: now,
        updatedAt: now,
      });
    }

    return null;
  },
});
```

**defineOnComplete handler pattern** (lines 455-579, handleScreeningComplete):
```typescript
export const handleScreeningComplete = screeningPool.defineOnComplete({
  context: v.object({
    resultId: v.id("screeningResults"),
    jobId: v.id("screeningJobs"),
  }),
  handler: async (ctx, { context, result }) => {
    if (result.kind === "success") {
      // Load job fresh for current counters (OCC will retry on conflict)
      const job = await ctx.db.get("screeningJobs", context.jobId) as Doc<"screeningJobs"> | null;
      if (!job) return;

      // Skip if terminal
      // ... process result, update counters ...

      await ctx.db.patch("screeningJobs", context.jobId, {
        processedPapers: (job.processedPapers ?? 0) + 1,
        updatedAt: Date.now(),
      });
    } else {
      // Error: mark failed, increment failedPapers
      await ctx.db.patch("screeningResults", context.resultId, {
        status: "failed",
        completedAt: Date.now(),
      });

      const job = await ctx.db.get("screeningJobs", context.jobId) as Doc<"screeningJobs"> | null;
      if (job) {
        await ctx.db.patch("screeningJobs", context.jobId, {
          failedPapers: (job.failedPapers ?? 0) + 1,
          updatedAt: Date.now(),
        });
      }
    }

    // Always check if job is complete
    await ctx.runMutation(
      internal.screening.mutations.finalizeScreeningJobIfDone,
      { jobId: context.jobId }
    );
  },
});
```

**Key difference per D-14:** Extraction replaces per-paper `enqueueAction` with a single `enqueueAllPapers` internal mutation that loops `enqueueAction` calls in one transaction (or uses `enqueueActionBatch` per Pitfall 1 analysis). The context passes `{ jobId, paperId }` per item.

---

### `convex/extraction/queries.ts` (service, CRUD) -- CREATE

**Analog:** `convex/screening/queries.ts` lines 1-401

**Public query with auth pattern** (lines 20-63, getScreeningProgress):
```typescript
export const getScreeningProgress = query({
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(
    v.null(),
    v.object({
      status: screeningJobStatusValidator,
      totalPapers: v.number(),
      processedPapers: v.number(),
      failedPapers: v.number(),
      // ...
      percentComplete: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get("screeningJobs", args.jobId);
    if (!job || job.userId !== user._id) return null;

    // ... compute percent ...
    return { /* progress fields */ };
  },
});
```

**Internal query (no auth) pattern** (lines 280-320, getJobInternal):
```typescript
export const getJobInternal = internalQuery({
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("screeningJobs"),
      userId: v.id("users"),
      status: screeningJobStatusValidator,
      // ... fields ...
    })
  ),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("screeningJobs", args.jobId);
    if (!job) return null;

    return { /* explicit field selection */ };
  },
});
```

**Bounded list query with index pattern** (lines 143-188, listUserScreeningJobs):
```typescript
export const listUserScreeningJobs = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({ /* fields */ })),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const jobs = await ctx.db
      .query("screeningJobs")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 20);

    return jobs.map(/* ... */);
  },
});
```

**Apply:** Create extraction query equivalents: `getExtractionProgress`, `getJobInternal`, `listUserExtractionJobs`. Same auth/no-auth split, same bounded `.take()` pattern.

---

### `convex/extraction/workpoolActions.ts` (service, request-response) -- CREATE

**Analog:** `convex/screening/workpoolActions.ts` lines 1-202

**Action file header pattern** (lines 1-2):
```typescript
"use node";
```

**Imports pattern** (lines 11-13):
```typescript
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
```

**Workpool action skeleton pattern** (lines 39-48):
```typescript
export const screenPaperAction = internalAction({
  args: {
    resultId: v.id("screeningResults"),
    jobId: v.id("screeningJobs"),
  },
  returns: v.object({
    responses: v.record(v.string(), v.union(v.boolean(), v.null())),
    confidence: v.number(),
  }),
  handler: async (ctx, args): Promise<ScreeningActionResult> => {
    // ... load job, guard checks, call AI, return result ...
  },
});
```

**Apply for Phase 89 stub:** Create a skeleton `processExtractionPaper` internalAction that accepts `{ paperId, jobId }`, loads the paper/job via `ctx.runQuery`, and returns a stub success result. Downstream phases (90-91) fill in the real parse/extract/critic/persist pipeline. Keep `"use node"` directive.

---

### `convex/extraction/mutations.test.ts` (test, CRUD) -- CREATE

**Analog:** `convex/screening/mutations.test.ts` lines 0-79

**Test setup pattern** (lines 0-6):
```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";
import schema from "../schema";
```

**Seed helper pattern** (lines 11-29):
```typescript
async function seedUser(
  t: ReturnType<typeof convexTest>,
  clerkId: string,
  email = "test@example.com"
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId,
      email,
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLoginAt: Date.now(),
    });
    return (await ctx.db.get("users", userId))!;
  });
}
```

**Seed domain entity pattern** (lines 49-72):
```typescript
async function seedScreeningJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  status: "pending" | "processing" | "completed" | "cancelled" | "failed" | "creditsExhausted"
) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("screeningJobs", {
      userId,
      status,
      totalPapers: 10,
      processedPapers: 0,
      failedPapers: 0,
      qualifiedPapers: 0,
      questions: [{ key: "q1", question: "Is this relevant?" }],
      scoringConfig: {
        rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }],
        starThresholds: [{ minScore: 0, stars: 1 }],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return (await ctx.db.get("screeningJobs", id))!;
  });
}
```

**Test with convexTest + `t.run` direct DB access** (used for testing internal mutations without workflow/workpool):
```typescript
it("some behavior", async () => {
  const t = convexTest(schema);
  // seed data with t.run(async (ctx) => { ctx.db.insert(...) })
  // call mutations with t.mutation(api.module.fn, args) or t.run for internals
  // assert with expect(...)
});
```

**Apply:** Create `seedExtractionJob`, `seedExtractionPaper` helpers. Test idempotent save (WORK-07) using direct `t.run` with `ctx.db.query(...).withIndex("by_paper_question", ...)` before insert.

---

### `convex/lib/queryBounds.ts` (utility, transform) -- MODIFY

**Analog:** `convex/lib/queryBounds.ts` lines 12-15

**Constant export pattern** (lines 12-15):
```typescript
/** Maximum papers in a single screening job.
 * Balances throughput with credit/cost predictability. */
export const MAX_SCREENING_PAPERS_PER_JOB = 200;
```

**Apply:** Add `MAX_EXTRACTION_PAPERS_PER_JOB = 200` (or appropriate limit) with same JSDoc comment pattern.

---

## Shared Patterns

### Authentication (Public Mutations/Queries)
**Source:** `convex/lib/auth.ts` lines 48-64
**Apply to:** `convex/extraction/mutations.ts` (createExtractionJob, cancelExtractionJob), `convex/extraction/queries.ts` (all public queries)
```typescript
import { requireAuth } from "../lib/auth";       // for mutations
import { getCurrentUser } from "../lib/auth";     // for queries

// In mutation handler:
const user = await requireAuth(ctx);

// In query handler (soft fail):
const user = await getCurrentUser(ctx);
if (!user) return null;
```

### Error Handling
**Source:** `convex/lib/errors.ts` lines 1-77
**Apply to:** All extraction service files (mutations, queries, workflow)
```typescript
import { createError } from "../lib/errors";

// Usage (validation):
throw createError("VALIDATION_ERROR", "At least one paper is required");

// Usage (not found):
throw createError("NOT_FOUND", `Extraction job ${jobId} not found`);
```

Note: New extraction-specific error codes (e.g., `EXTRACTION_JOB_NOT_FOUND`, `EXTRACTION_JOB_ALREADY_ACTIVE`) should be added to the `ErrorCode` union in `convex/lib/errors.ts`.

### Workflow Singleton
**Source:** `convex/workflow.ts` lines 1-14
**Apply to:** `convex/extraction/workflow.ts`, `convex/extraction/mutations.ts`
```typescript
import { workflow } from "../workflow";

// In workflow definition file:
export const runExtractionWorkflow = workflow.define({ ... });

// In mutation that starts workflow:
const workflowId = await workflow.start(
  ctx,
  internal.extraction.workflow.runExtractionWorkflow,
  { jobId }
);
```

### Workpool Instance
**Source:** `convex/workpool.ts` lines 1-13
**Apply to:** `convex/extraction/mutations.ts` (enqueue + defineOnComplete)
```typescript
import { extractionPool } from "../workpool";

// In enqueue mutation:
await extractionPool.enqueueAction(ctx, actionRef, args, { onComplete, context });

// In onComplete handler:
export const handleExtractionComplete = extractionPool.defineOnComplete({ ... });
```

### Terminal Status Guard
**Source:** `convex/screening/mutations.ts` lines 21-26 + 385-430
**Apply to:** `convex/extraction/mutations.ts` (finalizeJobIfDone, handleExtractionComplete, cancelExtractionJob)
```typescript
const TERMINAL_STATUSES = ["completed", "cancelled", "failed"] as const;

// Guard check in handler:
if (TERMINAL_STATUSES.includes(job.status as (typeof TERMINAL_STATUSES)[number])) {
  return null;
}
```

### Denormalized Counter Increment
**Source:** `convex/screening/mutations.ts` lines 544-548
**Apply to:** `convex/extraction/mutations.ts` (handleExtractionComplete)
```typescript
await ctx.db.patch("extractionJobs", context.jobId, {
  processedPapers: (job.processedPapers ?? 0) + 1,
  updatedAt: Date.now(),
});
```

### Idempotent Upsert via Composite Index
**Source:** `convex/screening/mutations.ts` lines 292-299 (saveQualifiedPaperToLibrary upsert pattern)
**Apply to:** `convex/extraction/mutations.ts` (saveResult for WORK-07)
```typescript
const existing = await ctx.db
  .query("extractionResults")
  .withIndex("by_paper_question", (q) =>
    q.eq("paperId", paperId).eq("questionId", questionId)
  )
  .unique();

if (existing) {
  // Already saved -- skip
  return;
}

await ctx.db.insert("extractionResults", { ... });
```

### Internal vs Public Function Split
**Source:** `convex/screening/mutations.ts` (public: createScreeningJob, cancelScreeningJob; internal: updateJobStatus, enqueueScreeningPaper, handleScreeningComplete, finalizeScreeningJobIfDone) and `convex/screening/queries.ts` (public: getScreeningProgress, getScreeningJob, listUserScreeningJobs; internal: getJobInternal, getPendingResults, getResultInternal)
**Apply to:** All extraction files -- same boundary: public functions require auth via `requireAuth`/`getCurrentUser`, internal functions have no auth and use `internalMutation`/`internalQuery`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | -- | -- | All 10 files have exact analogs in the screening module |

Every file to be created or modified in this phase has a direct structural analog in the existing screening pipeline. The extraction skeleton is architecturally identical to screening, differing only in table names, field shapes, status enums, and the batched enqueue optimization (D-08/D-14).

## Metadata

**Analog search scope:** `convex/screening/`, `convex/`, `convex/lib/`
**Files scanned:** 14 analog candidates read in full
**Pattern extraction date:** 2026-04-15
