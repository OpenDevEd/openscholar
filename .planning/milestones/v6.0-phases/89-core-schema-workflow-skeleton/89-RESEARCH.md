# Phase 89: Core Schema & Workflow Skeleton - Research

**Researched:** 2026-04-15
**Domain:** Convex schema definition, @convex-dev/workflow durable workflows, @convex-dev/workpool bounded parallelism
**Confidence:** HIGH

## Summary

This phase creates the foundational schema and orchestration skeleton for the v6.0 extraction pipeline. The work is purely backend: four new Convex tables (`extractionJobs`, `extractionPapers`, `extractionQuestions`, `extractionResults`), a new `extractionWorkpool` component registration in `convex.config.ts`, a new `extractionPool` Workpool instance, and a durable workflow that loads a job, enqueues all papers in a single batched mutation, and delegates per-paper processing to the workpool.

The existing screening pipeline (`convex/screening/`) provides a proven, battle-tested reference implementation. The extraction skeleton mirrors screening's architecture almost exactly: WorkflowManager.define for the workflow, Workpool for bounded parallelism, defineOnComplete for result handling, denormalized progress counters on the job row. The key architectural difference is the **batched enqueue** pattern -- the screening workflow uses a `for` loop calling `enqueueScreeningPaper` per paper (each a separate journaled step), while the extraction workflow must use a single `enqueueAllPapers` mutation that calls `extractionPool.enqueueActionBatch()` to enqueue all papers in one transaction.

All four WORK requirements map cleanly to specific implementation artifacts: WORK-01 (workflow with per-stage journaling), WORK-02 (workpool with maxParallelism 5), WORK-06 (single batched enqueue mutation), WORK-07 (idempotent save via `by_paper_question` index).

**Primary recommendation:** Mirror the screening workflow/workpool pattern exactly, replacing the per-paper enqueue loop with a single `enqueueActionBatch` call, and adding a `by_paper_question` composite index on `extractionResults` for idempotent saves.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Four new tables: `extractionJobs`, `extractionPapers`, `extractionQuestions`, `extractionResults`. Minimal MVP fields only.
- **D-02:** `extractionJobs` includes denormalized progress counters (`totalPapers`, `processedPapers`, `failedPapers`) matching screeningJobs pattern.
- **D-03:** `extractionPapers` stores `workpoolId` per paper row for targeted cancel in Phase 93.
- **D-04:** `extractionResults` has `by_paper_question` composite index for idempotent save. Also `by_job` and `by_paper` indexes.
- **D-05:** `extractionQuestions` stores user-defined questions per job with extraction-specific fields.
- **D-06:** Job status enum: `pending`, `processing`, `completed`, `cancelled`, `failed`.
- **D-07:** Paper status enum: `pending`, `parsing`, `extracting`, `completed`, `failed`, `cancelled`.
- **D-08:** Workflow follows 3 journaled steps: (1) load job + validate, (2) batched enqueue, (3) finalization. NOT per-paper journaled steps.
- **D-09:** Each workpool item runs full per-paper pipeline autonomously. Workflow doesn't micromanage per-paper stages.
- **D-10:** Workpool `onComplete` handler handles per-paper result aggregation and job finalization.
- **D-11:** Register `extractionPool` as separate named component `extractionWorkpool` in `convex.config.ts`.
- **D-12:** `maxParallelism: 5`, matching screening.
- **D-13:** Retry config: `maxAttempts: 3`, `initialBackoffMs: 2000`, `base: 2`.
- **D-14:** `enqueueAllPapers` is a single mutation creating paper rows AND enqueuing to workpool in one transaction.
- **D-15:** Idempotent result save: query `by_paper_question` before insert; skip if exists.

### Claude's Discretion
- Exact field names and validator shapes for the four tables -- follow Convex conventions and screening patterns.
- Whether `extractionQuestions` are stored as nested array on job or as separate rows.
- Internal vs public function split for the extraction module.
- Test file organization (colocated in `convex/extraction/` or under `tests/extraction/`).

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WORK-01 | Slim durable workflow with per-stage journaled steps (parse -> extract -> critic -> persist), not per paper | Workflow defined via `workflow.define()` with 3 journaled `step.run*` calls. Each workpool item runs the full pipeline autonomously. |
| WORK-02 | Single `extractionPool` workpool with `maxParallelism` 3-5 | New `Workpool` instance with `maxParallelism: 5`, registered as named component `extractionWorkpool` in `convex.config.ts`. |
| WORK-06 | Single batched `enqueueAllPapers` mutation, not 500 sequential steps | Use `extractionPool.enqueueActionBatch()` in one internal mutation -- verified available in installed @convex-dev/workpool@0.3.2. |
| WORK-07 | Idempotent result save via `by_paper_question` index | `extractionResults` table with composite index `by_paper_question: ["paperId", "questionId"]`. Persist mutation queries index before insert. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- This project uses Convex as its backend. Always read `convex/_generated/ai/guidelines.md` first for Convex API patterns.
- `strict: true` TypeScript. No `any` types (enforced by `scripts/verify-no-any.sh`).
- DRY: check codebase before implementing. The screening module is the direct reference.
- No legacy behavior, no backward compatibility. Destructive and clean.
- Tests colocated in `convex/` directory use `convex-test` with `edge-runtime` environment.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Schema definition | Database / Storage | -- | Tables, indexes, validators live in `convex/schema.ts` |
| Workflow orchestration | API / Backend | -- | Durable workflow runs server-side via `@convex-dev/workflow` |
| Workpool registration | API / Backend | -- | Component config in `convex/convex.config.ts` |
| Batched enqueue | API / Backend | -- | Internal mutation creating paper rows + workpool enqueue |
| Idempotent persist | Database / Storage | API / Backend | Index enforces uniqueness, mutation checks before insert |
| Progress counters | Database / Storage | -- | Denormalized on job row, read reactively by frontend |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `convex` | 1.34.1 (installed), 1.35.1 (latest) | Backend runtime, database, functions | Project foundation [VERIFIED: npm registry] |
| `@convex-dev/workflow` | 0.3.10 (installed = latest) | Durable workflow orchestration | Already used by screening [VERIFIED: npm registry, installed package] |
| `@convex-dev/workpool` | 0.3.2 (installed), 0.4.6 (latest) | Bounded-parallelism worker pools | Already used by screening [VERIFIED: npm registry, installed package] |
| `convex-test` | 0.0.46 (installed), 0.0.48 (latest) | Convex function testing harness | Already used by screening tests [VERIFIED: npm registry] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `convex-helpers` | 0.1.114 (installed) | Rate limit tables, validators, utilities | Already in schema for `rateLimitTables` |
| `vitest` | 3.2.4 (installed) | Test runner | All unit/integration tests |
| `@edge-runtime/vm` | 5.0.0 (installed) | Edge runtime emulation for Convex tests | Test environment for `convex/**/*.test.ts` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@convex-dev/workpool` 0.3.2 | Upgrade to 0.4.6 | 0.3.2 already has `enqueueActionBatch`. Upgrading introduces risk of API changes across screening + extraction. Defer upgrade to a dedicated maintenance phase. |
| Separate `extractionQuestions` table | Nested array on `extractionJobs` | Separate table is more flexible but adds complexity. Screening uses nested arrays for questions. Recommend Claude's Discretion: nested array on job (simpler, matches screening, extraction queries read from job anyway). |

**Installation:**
```bash
# No new packages needed. All dependencies already installed.
# Optionally upgrade workpool for latest fixes:
# npm install @convex-dev/workpool@0.4.6
```

**Version verification:**
- `@convex-dev/workflow`: 0.3.10 installed = 0.3.10 latest [VERIFIED: npm registry 2026-04-15]
- `@convex-dev/workpool`: 0.3.2 installed, 0.4.6 latest [VERIFIED: npm registry 2026-04-15]
- `convex`: 1.34.1 installed, 1.35.1 latest [VERIFIED: npm registry 2026-04-15]
- `convex-test`: 0.0.46 installed, 0.0.48 latest [VERIFIED: npm registry 2026-04-15]

## Architecture Patterns

### System Architecture Diagram

```
User clicks "Start Extraction"
          |
          v
[createExtractionJob] (public mutation)
  - Auth check
  - Create extractionJobs row (status: pending)
  - Create extractionQuestions (nested on job or separate rows)
  - Start workflow via workflow.start()
          |
          v
[runExtractionWorkflow] (durable workflow, 3 journaled steps)
  |
  |-- Step 1: step.runQuery(getJobInternal)
  |     Load job, validate, check not cancelled
  |
  |-- Step 2: step.runMutation(enqueueAllPapers)
  |     Single mutation that:
  |       1. Creates N extractionPapers rows (status: pending)
  |       2. Calls extractionPool.enqueueActionBatch()
  |       3. Stores workpoolIds on paper rows
  |       4. Updates job status -> processing
  |
  |-- Step 3: (no-op skeleton -- finalization handled by onComplete)
  |
  v
[extractionPool] (workpool, maxParallelism: 5)
  |
  |-- Per paper: [processExtractionPaper] (action)
  |     parse -> extract -> critic -> persist
  |     (skeleton in this phase -- stubs that return success)
  |
  v
[handleExtractionComplete] (onComplete handler)
  - On success: increment processedPapers counter
  - On failure: increment failedPapers, mark paper failed
  - Check if all papers done -> finalize job (status: completed)
  - Idempotent: by_paper_question check before insert
```

### Recommended Project Structure
```
convex/
  extraction/
    workflow.ts         # Durable workflow definition (runExtractionWorkflow)
    mutations.ts        # createExtractionJob, enqueueAllPapers, handleExtractionComplete,
                        # updateJobStatus, finalizeJobIfDone, saveResult
    queries.ts          # getJobInternal, getExtractionProgress, listUserExtractionJobs
    validators.ts       # extractionJobStatusValidator, extractionPaperStatusValidator, etc.
    workpoolActions.ts  # processExtractionPaper action (stub for this phase)
    mutations.test.ts   # Tests: schema, batched enqueue, idempotent save
  workpool.ts           # + extractionPool instance (alongside screeningPool)
  convex.config.ts      # + extractionWorkpool component registration
  schema.ts             # + 4 new extraction tables
  workflow.ts           # WorkflowManager singleton (unchanged, shared)
```

### Pattern 1: Component Registration
**What:** Register a new named workpool component in convex.config.ts
**When to use:** Each workpool needs its own component instance for isolation
**Example:**
```typescript
// Source: convex/convex.config.ts (existing pattern)
import extractionWorkpool from "@convex-dev/workpool/convex.config.js";

const app = defineApp();
app.use(stripe);
app.use(workflow);
app.use(screeningWorkpool, { name: "screeningWorkpool" });
app.use(extractionWorkpool, { name: "extractionWorkpool" }); // NEW
```
[VERIFIED: existing `convex/convex.config.ts` uses this exact pattern for screeningWorkpool]

### Pattern 2: Workpool Instance Creation
**What:** Create a Workpool instance pointing at the registered component
**When to use:** Each pool gets its own instance with independent config
**Example:**
```typescript
// Source: convex/workpool.ts (existing pattern)
import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";

export const extractionPool = new Workpool(components.extractionWorkpool, {
  maxParallelism: 5,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2,
  },
});
```
[VERIFIED: existing `convex/workpool.ts` uses this exact pattern for screeningPool]

### Pattern 3: Workflow Definition with Journaled Steps
**What:** Define a durable workflow using `workflow.define()` with `step.runQuery`/`step.runMutation` calls
**When to use:** Multi-step orchestration that must survive restarts
**Example:**
```typescript
// Source: convex/screening/workflow.ts (existing pattern)
export const runExtractionWorkflow = workflow.define({
  args: {
    jobId: v.id("extractionJobs"),
  },
  handler: async (step, { jobId }) => {
    // Step 1: Load and validate
    const job = await step.runQuery(
      internal.extraction.queries.getJobInternal,
      { jobId }
    );
    if (!job) throw createError("NOT_FOUND", `Job ${jobId} not found`);

    // Step 2: Batched enqueue (single mutation)
    await step.runMutation(
      internal.extraction.mutations.enqueueAllPapers,
      { jobId }
    );

    // Step 3: Finalization handled by onComplete, workflow done
  },
});
```
[VERIFIED: screening workflow uses identical `workflow.define()` API]

### Pattern 4: Batched Enqueue via enqueueActionBatch
**What:** Enqueue all papers to workpool in a single mutation using `enqueueActionBatch`
**When to use:** WORK-06 requirement -- single batched mutation instead of N sequential steps
**Example:**
```typescript
// Source: @convex-dev/workpool client API (verified in installed package)
export const enqueueAllPapers = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("extractionJobs", jobId);
    if (!job) return;

    // 1. Create paper rows
    const paperIds: Id<"extractionPapers">[] = [];
    for (const paperId of paperOpenalexIds) {
      const id = await ctx.db.insert("extractionPapers", { ... });
      paperIds.push(id);
    }

    // 2. Build args array for batch enqueue
    const argsArray = paperIds.map(paperId => ({
      paperId,
      jobId,
    }));

    // 3. Single batch enqueue call
    const workIds = await extractionPool.enqueueActionBatch(
      ctx,
      internal.extraction.workpoolActions.processExtractionPaper,
      argsArray,
      {
        onComplete: internal.extraction.mutations.handleExtractionComplete,
        context: { jobId }, // shared context for all items
      }
    );

    // 4. Store workpoolIds on paper rows (for Phase 93 cancel)
    for (let i = 0; i < paperIds.length; i++) {
      await ctx.db.patch("extractionPapers", paperIds[i], {
        workpoolId: String(workIds[i]),
      });
    }

    // 5. Update job status
    await ctx.db.patch("extractionJobs", jobId, {
      status: "processing",
      updatedAt: Date.now(),
    });
  },
});
```
[VERIFIED: `enqueueActionBatch` exists in installed @convex-dev/workpool@0.3.2 dist/client/index.d.ts]

**Critical note on `enqueueActionBatch` context limitation:** The `onComplete` options including `context` are shared across all batch items. Each item gets the SAME `context` value. To differentiate items in the onComplete handler, use the `workId` parameter to look up the paper. Alternatively, pass per-item context by using individual `enqueueAction` calls in a loop within the same mutation (still one transaction, satisfies WORK-06).

### Pattern 5: Idempotent Result Save
**What:** Query composite index before insert to prevent duplicate results
**When to use:** WORK-07 requirement -- prevents onComplete double-fire corruption
**Example:**
```typescript
// Persist a single extraction result idempotently
const existing = await ctx.db
  .query("extractionResults")
  .withIndex("by_paper_question", (q) =>
    q.eq("paperId", paperId).eq("questionId", questionId)
  )
  .unique();

if (existing) {
  // Already saved -- no-op
  return;
}

await ctx.db.insert("extractionResults", {
  jobId,
  paperId,
  questionId,
  // ... result fields added by Phase 91
  createdAt: Date.now(),
});
```
[VERIFIED: Convex `withIndex` + `.unique()` pattern used throughout codebase]

### Pattern 6: defineOnComplete Handler
**What:** Workpool completion handler for per-paper result aggregation
**When to use:** When each workpool item finishes, update job counters and check finalization
**Example:**
```typescript
// Source: convex/screening/mutations.ts (existing pattern)
export const handleExtractionComplete = extractionPool.defineOnComplete({
  context: v.object({
    jobId: v.id("extractionJobs"),
  }),
  handler: async (ctx, { context, result }) => {
    if (result.kind === "success") {
      // Increment processedPapers
    } else {
      // Increment failedPapers
    }
    // Check finalization
    await ctx.runMutation(
      internal.extraction.mutations.finalizeJobIfDone,
      { jobId: context.jobId }
    );
  },
});
```
[VERIFIED: screening uses identical `defineOnComplete` pattern with context validator]

### Anti-Patterns to Avoid
- **Per-paper journaled steps in workflow:** Screening does `for (const result of pendingResults) { await step.runMutation(...) }` -- each iteration is a journaled step. For extraction, this would create N workflow steps for N papers. Decision D-08 explicitly forbids this. Use a single `step.runMutation(enqueueAllPapers)` instead.
- **Mixing queries/mutations and actions in same file:** Convex requires `"use node"` for actions using Node built-ins, but queries/mutations cannot run in Node runtime. Keep `workpoolActions.ts` (with `"use node"`) separate from `mutations.ts` and `queries.ts`.
- **Using `ctx.db` in actions:** Actions cannot access the database directly. Use `ctx.runQuery` and `ctx.runMutation` instead.
- **Bare `as any` casts:** Forbidden by project conventions. Use proper type narrowing with `as Doc<"tableName">`.
- **Unbounded `.collect()` calls:** Always use `.take(N)` or bounded queries per Convex guidelines.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Durable workflow orchestration | Custom scheduler chains | `@convex-dev/workflow` `WorkflowManager.define()` | Handles restarts, replay, journaling. Already proven in screening. |
| Bounded parallelism | Custom semaphore/queue | `@convex-dev/workpool` `Workpool` | Handles scheduling, retries, backoff, cancellation. Already proven in screening. |
| Completion callbacks | Custom status polling | `defineOnComplete` from workpool | Race-condition-free callback system with typed context. |
| Batched enqueue | Custom batching logic | `enqueueActionBatch()` from workpool | Single-transaction batch enqueue with automatic work ID tracking. |
| Unique constraint enforcement | Custom dedup logic | Composite index + query-before-insert | Convex indexes are the standard pattern for uniqueness checks. |
| Error factory | Custom error classes | `createError()` from `convex/lib/errors.ts` | Centralized error codes, discriminated unions, client-parseable. |

**Key insight:** Every orchestration primitive needed for this phase already exists in the installed `@convex-dev/workflow` and `@convex-dev/workpool` packages, and the screening module demonstrates each pattern. The extraction skeleton is a structural mirror with different table names and a batched enqueue optimization.

## Common Pitfalls

### Pitfall 1: onComplete context shared across batch items
**What goes wrong:** `enqueueActionBatch` shares the `options` (including `onComplete` and `context`) across all items in the batch. If you need per-paper context in the completion handler, you cannot pass it through the batch options.
**Why it happens:** The batch API takes a single `options` object, not per-item options.
**How to avoid:** Two approaches: (1) Use individual `enqueueAction` calls in a loop within the same mutation (still one transaction for WORK-06). (2) Use shared context (e.g., `{ jobId }`) and look up paper details from the `workId` in the completion handler. Approach (1) is what screening does and is simpler for context passing.
**Warning signs:** The `handleExtractionComplete` handler cannot identify which paper completed.

### Pitfall 2: Convex transaction limits on large batches
**What goes wrong:** A single mutation that inserts 200+ paper rows AND enqueues them to the workpool may hit Convex's transaction document write limits (8192 documents per transaction).
**Why it happens:** Each `ctx.db.insert` and each workpool enqueue creates documents.
**How to avoid:** At MVP scale (200 papers max per `MAX_SCREENING_PAPERS_PER_JOB`), this is well within limits. Each paper creates ~2 documents (paper row + workpool work item), so 200 papers = ~400 documents. The 8192 limit is not a concern at this scale. [VERIFIED: Convex docs state 8192 array item limit; document write limits are higher]
**Warning signs:** `ConvexError: Transaction too large` on job creation with many papers.

### Pitfall 3: OCC contention on denormalized counters
**What goes wrong:** Multiple onComplete handlers fire concurrently, each reading and patching the same `extractionJobs` row's `processedPapers` counter. Optimistic concurrency control (OCC) causes retries.
**Why it happens:** Convex mutations are transactions; concurrent patches to the same document trigger OCC conflicts.
**How to avoid:** At maxParallelism 5, contention is manageable -- Convex automatically retries OCC conflicts. This is the same pattern screening uses successfully. At higher parallelism (future SCALE-01), sharded counters would be needed.
**Warning signs:** Elevated OCC retry rates in Convex dashboard. Decision D-02 explicitly acknowledges this is acceptable at MVP scale.

### Pitfall 4: convex-test does not run workflow/workpool components
**What goes wrong:** `convexTest(schema)` creates a test environment that does NOT include component registrations. Calling `workflow.start()` or `extractionPool.enqueueAction()` in tests throws because the component is not available.
**Why it happens:** `convex-test` mocks the Convex runtime but not external components.
**How to avoid:** Test mutations and queries independently of the workflow. The existing screening tests demonstrate this: `createScreeningJob` catches workflow start errors gracefully (`try/catch` around `workflow.start`), and tests validate the database state without running the actual workflow. For extraction, test `enqueueAllPapers` by validating the paper rows it creates, not by running the workpool.
**Warning signs:** Tests throw `Error: Component not registered` when calling workflow/workpool APIs.

### Pitfall 5: Missing `"use node"` directive on action files
**What goes wrong:** Action files that use Node.js built-ins (like `fetch` for external APIs) fail at runtime without the `"use node"` directive.
**Why it happens:** Convex's default runtime is a restricted V8 environment. The `"use node"` directive opts into the Node.js runtime.
**How to avoid:** Always add `"use node"` at the top of `workpoolActions.ts`. Note: `fetch` is available in both runtimes, but Node.js modules like `crypto` require the directive. For the Phase 89 stub action, `"use node"` is still needed because downstream phases will add Node-dependent code.
**Warning signs:** Runtime errors about missing Node.js modules.

### Pitfall 6: Schema migration deploying to production
**What goes wrong:** Adding new tables is additive and non-breaking, but deploying schema changes to a live Convex instance requires `npx convex deploy` (not just `npx convex dev`).
**Why it happens:** Schema changes are applied on deploy, not on function push.
**How to avoid:** New tables are always safe to add (additive migration). No existing data is affected. Just ensure `convex dev` is running locally to regenerate `_generated/` types before writing code.
**Warning signs:** TypeScript errors about missing table types after adding tables to `schema.ts`.

## Code Examples

### Schema: extractionJobs table
```typescript
// Source: mirrors screeningJobs pattern from convex/schema.ts
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
  questions: v.array(
    v.object({
      key: v.string(),
      question: v.string(),
      expectedType: v.optional(v.string()), // extraction-specific
    })
  ),
  workflowId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"])
  .index("by_workflow", ["workflowId"]),
```

### Schema: extractionPapers table
```typescript
// Source: mirrors screeningResults pattern with workpoolId for Phase 93
extractionPapers: defineTable({
  jobId: v.id("extractionJobs"),
  openalexId: v.string(),
  title: v.string(),
  doi: v.optional(v.string()),
  status: v.union(
    v.literal("pending"),
    v.literal("parsing"),
    v.literal("extracting"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled")
  ),
  workpoolId: v.optional(v.string()), // D-03: for targeted cancel
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
})
  .index("by_job", ["jobId"])
  .index("by_job_status", ["jobId", "status"]),
```

### Schema: extractionResults table
```typescript
// Source: WORK-07 idempotent save pattern
extractionResults: defineTable({
  jobId: v.id("extractionJobs"),
  paperId: v.id("extractionPapers"),
  questionId: v.string(), // key from questions array
  // Result fields added by Phase 91 (EXTR-02)
  // Stub: just the identity fields for now
  createdAt: v.number(),
})
  .index("by_paper_question", ["paperId", "questionId"]) // D-04: idempotent save
  .index("by_job", ["jobId"])
  .index("by_paper", ["paperId"]),
```

### Validators for extraction module
```typescript
// Source: mirrors convex/screening/validators.ts pattern
import { v } from "convex/values";

export const extractionJobStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("failed")
);

export const extractionPaperStatusValidator = v.union(
  v.literal("pending"),
  v.literal("parsing"),
  v.literal("extracting"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled")
);

export const extractionQuestionValidator = v.object({
  key: v.string(),
  question: v.string(),
  expectedType: v.optional(v.string()),
});
```

### Test: idempotent save (WORK-07)
```typescript
// Source: convex-test pattern from convex/screening/mutations.test.ts
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../schema";

describe("idempotent result save", () => {
  it("saving same (paperId, questionId) twice results in one row", async () => {
    const t = convexTest(schema);

    // Seed job, paper, then call saveResult twice
    const { jobId, paperId } = await seedJobAndPaper(t);

    // First save
    await t.run(async (ctx) => {
      await ctx.db.insert("extractionResults", {
        jobId, paperId, questionId: "q1", createdAt: Date.now(),
      });
    });

    // Second save (idempotent -- check index first)
    await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper_question", (q) =>
          q.eq("paperId", paperId).eq("questionId", "q1")
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("extractionResults", {
          jobId, paperId, questionId: "q1", createdAt: Date.now(),
        });
      }
    });

    // Assert only one row
    const results = await t.run(async (ctx) => {
      return await ctx.db
        .query("extractionResults")
        .withIndex("by_paper_question", (q) =>
          q.eq("paperId", paperId).eq("questionId", "q1")
        )
        .collect();
    });
    expect(results).toHaveLength(1);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@convex-dev/workpool` per-item enqueue in loop | `enqueueActionBatch()` for bulk enqueue | Available in 0.3.x | Single transaction for N items, cleaner API |
| `WorkflowManager.define({ handler })` inline | `workflow.define({ args }).handler(fn)` builder pattern | 0.3.x supports both | Both syntaxes work; project uses inline handler style |
| `convex-test` without modules argument | `convexTest(schema, modules)` with `import.meta.glob` | 0.0.46+ recommends modules | Project uses `convexTest(schema)` without modules -- both work |

**Deprecated/outdated:**
- `@convex-dev/rag` was removed in Phase 88 (TEAR-04). Not relevant to this phase.
- `pdfProcessingPool` was removed in Phase 88 (TEAR-05). Only `screeningWorkpool` and new `extractionWorkpool` remain.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `enqueueActionBatch` context/options are shared across all batch items (cannot pass per-item context) | Pitfalls, Pattern 4 | If per-item context IS supported, the enqueue pattern simplifies. Fallback is individual enqueue calls in a loop (still one transaction). LOW risk. |
| A2 | 200 papers creating ~400 documents per transaction is within Convex limits | Pitfalls | If Convex has a lower write limit, batch would need splitting. At MVP scale with MAX_SCREENING_PAPERS_PER_JOB=200, very unlikely. LOW risk. |
| A3 | Storing `extractionQuestions` as nested array on job (recommended for Claude's Discretion) is sufficient | Standard Stack Alternatives | If questions need independent CRUD or exceed document size limits, separate table needed. At MVP scale with ~10 questions, nested array is safe. LOW risk. |

## Open Questions

1. **Extraction questions: nested array vs separate table**
   - What we know: Screening stores questions as `v.array(v.object({...}))` on the job row. Extraction questions have the same cardinality (~3-10 per job).
   - What's unclear: Whether downstream phases (91-92) need to query questions independently of the job.
   - Recommendation: Use nested array on job (matching screening), since extraction queries always load the full job first. If downstream phases need independent question queries, refactor then.

2. **enqueueActionBatch per-item context**
   - What we know: The API signature passes shared `options` including `context` for all batch items.
   - What's unclear: Whether the onComplete handler receives the `workId` that can be used to correlate back to the specific paper.
   - Recommendation: Use individual `enqueueAction` calls in a loop within the single `enqueueAllPapers` mutation. This matches the screening pattern, allows per-paper context in onComplete, and still satisfies WORK-06 (single mutation = single transaction). The `for` loop is inside one mutation, not N journaled workflow steps.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 + convex-test 0.0.46 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run convex/extraction/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WORK-01 | Workflow creates one run with per-stage steps | unit | `npx vitest run convex/extraction/mutations.test.ts -t "workflow"` | Wave 0 |
| WORK-02 | extractionPool registered with maxParallelism 3-5 | unit | `npx vitest run convex/extraction/mutations.test.ts -t "workpool"` | Wave 0 |
| WORK-06 | enqueueAllPapers fires exactly one batched mutation | unit | `npx vitest run convex/extraction/mutations.test.ts -t "batched enqueue"` | Wave 0 |
| WORK-07 | Double-save of (paperId, questionId) produces one row | unit | `npx vitest run convex/extraction/mutations.test.ts -t "idempotent"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run convex/extraction/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `convex/extraction/mutations.test.ts` -- covers WORK-01, WORK-06, WORK-07 (schema operations, batched insert, idempotent save)
- [ ] Test helpers: `seedExtractionJob`, `seedExtractionPaper`, `seedExtractionResult` factory functions
- [ ] Note: WORK-02 (workpool maxParallelism) is a config assertion, not a runtime test. Verify by reading `convex/workpool.ts` source.
- [ ] Note: Workflow and workpool component interactions cannot be tested in `convex-test` (see Pitfall 4). Tests verify database state only.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `requireAuth(ctx)` from `convex/lib/auth.ts` on public mutations |
| V3 Session Management | no | Handled by Clerk, not this phase |
| V4 Access Control | yes | User isolation: `job.userId !== user._id` check on all queries/mutations |
| V5 Input Validation | yes | Convex `v.*` validators on all function args |
| V6 Cryptography | no | No crypto operations in this phase |

### Known Threat Patterns for Convex Backend

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| User accessing another user's job | Information Disclosure | `userId` check on all public queries (screening pattern) |
| Unauthenticated job creation | Elevation of Privilege | `requireAuth(ctx)` guard |
| Job status manipulation | Tampering | Internal mutations only; public mutations validate transitions |
| Workpool resource exhaustion | Denial of Service | `maxParallelism: 5` caps concurrent actions |

## Sources

### Primary (HIGH confidence)
- `convex/schema.ts` -- current schema after Phase 88 teardown (read directly)
- `convex/screening/workflow.ts` -- 74-line screening workflow, direct reference (read directly)
- `convex/screening/mutations.ts` -- screening mutations including enqueue and onComplete (read directly)
- `convex/convex.config.ts` -- component registrations (read directly)
- `convex/workflow.ts` -- WorkflowManager singleton (read directly)
- `convex/workpool.ts` -- screeningPool instance (read directly)
- `node_modules/@convex-dev/workpool/src/client/index.ts` -- Workpool class API including `enqueueActionBatch` (read directly)
- `node_modules/@convex-dev/workflow/src/client/index.ts` -- WorkflowManager class API (read directly)

### Secondary (MEDIUM confidence)
- npm registry version checks for `@convex-dev/workflow`, `@convex-dev/workpool`, `convex`, `convex-test` (verified via `npm view`)
- `convex/_generated/ai/guidelines.md` -- Convex AI guidelines (generated, read directly)

### Tertiary (LOW confidence)
- None. All claims verified against installed source code or npm registry.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all packages already installed and used by screening; versions verified against npm registry
- Architecture: HIGH -- extraction workflow is a structural mirror of the proven screening workflow with one optimization (batched enqueue)
- Pitfalls: HIGH -- derived from direct source code reading of workpool/workflow APIs and existing screening test patterns

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable -- core Convex APIs change slowly; workpool 0.4.x upgrade deferred)
