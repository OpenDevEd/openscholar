# Phase 75: Schema & Job Infrastructure - Research

**Researched:** 2026-03-09
**Domain:** Convex schema design, mutations, credit verification, reactive queries
**Confidence:** HIGH

## Summary

Phase 75 creates the database infrastructure for bulk screening: two new tables (`screeningJobs`, `screeningResults`), job creation with credit verification, job cancellation with workpool stop, and a reactive progress query. The project has a mature extraction workflow pattern (`extractionJobs` + `extractionPapers` + workpool + credit-guard) that serves as the direct blueprint.

All patterns needed are already proven in the codebase. The screening domain is simpler than extraction (no PDF processing, no RAG indexing, no evidence units) -- it only needs title+abstract AI screening. Schema design, mutations, and credit logic follow established conventions with no new dependencies.

**Primary recommendation:** Mirror the extraction domain module structure (`convex/screening/`) and reuse all established patterns (status unions, credit-guard, workpool cancelAll, `convex-test` TDD).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- 1 credit per paper for bulk screening -- same cost as single-paper screening
- Credit verification at job creation: check user has >= paperCount credits before starting
- Per-batch credit deduction during processing (not upfront lump sum) with credit-guard pattern matching extraction
- One active bulk screening job at a time per user
- Job creation mutation rejects if user has a job in pending/processing status
- Each bulk screening job is independent -- papers are re-screened even if previously screened
- No cross-job deduplication in schema
- Partial results preserved in screeningResults on cancellation
- Already-qualifying papers saved to library before cancellation remain in library
- Credit-guard prevents billing for papers processed after cancellation signal
- Snapshot screening questions into the screeningJobs record at creation time
- Questions come from the existing screening panel (DIALOG-02) and are frozen for the job's lifetime
- Scoring config (point values per question per answer) embedded in job record alongside questions

### Claude's Discretion
- Exact schema field names and types for screeningJobs and screeningResults tables
- Index design for optimal query patterns
- Status enum values and transitions
- Progress query implementation (polling vs reactive subscription)
- Error code naming for credit/validation failures
- Internal mutation structure for status updates

### Deferred Ideas (OUT OF SCOPE)
- Plan-tier limits on bulk screening cap (free=50, go=100, pro=200) -- captured as JOB-09
- Bulk screening job results page with detailed per-paper breakdown -- captured as JOB-10
- Saved scoring rule presets reusable across searches -- captured as SCORE-06
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| JOB-01 | User can trigger a bulk screening job for up to 200 search results | Schema supports up to MAX_SCREENING_PAPERS_PER_JOB=200 papers; createScreeningJob mutation validates paper count and inserts job record with embedded questions/scoring config |
| JOB-04 | System verifies user has sufficient credits before starting the job | Pre-flight credit check in createScreeningJob mutation using getUserCredits; rejects with INSUFFICIENT_CREDITS if balance < paperCount; actual deduction deferred to per-batch processing (Phase 77) |
| JOB-07 | User can cancel a running bulk screening job (stops processing, keeps partial results) | cancelScreeningJob mutation sets status to "cancelled", calls workpool.cancelAll() and workflow.cancel(); credit-guard in processing actions skips billing for cancelled jobs; existing screeningResults rows are preserved |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| convex | (project version) | Backend framework, schema, mutations, queries | Project foundation |
| convex/values | (bundled) | Validators for schema and function args | Required for Convex schema |
| @convex-dev/workpool | (installed) | Parallel task processing with cancellation | Already used for extraction |
| @convex-dev/workflow | (installed) | Durable workflow orchestration | Already used for extraction |
| convex-test | (installed) | Convex function unit testing | Already used for extraction tests |
| vitest | (installed) | Test runner | Project standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| convex-helpers | (installed) | Rate limiting tables | Already in schema |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Embedded questions in job | Separate screeningQuestions table | Extraction uses separate table, but screening questions are simpler (just boolean questions + scoring config) -- embedding is cleaner for snapshot semantics |
| Separate screeningPapers table | Results-only table | Extraction needs per-paper status tracking (download, index, extract steps); screening only needs per-paper results. A single screeningResults table with status suffices |

## Architecture Patterns

### Recommended Project Structure
```
convex/
  screening/
    mutations.ts        # createScreeningJob, cancelScreeningJob, updateJobStatus (internal)
    queries.ts          # getScreeningJob, getScreeningProgress, listScreeningJobs
    validators.ts       # Shared validators for screening questions, scoring config
  schema.ts             # Add screeningJobs + screeningResults tables
  lib/
    errors.ts           # Add new error codes
    queryBounds.ts      # Add MAX_SCREENING_PAPERS_PER_JOB
```

### Pattern 1: screeningJobs Table Design
**What:** Job record with embedded questions and scoring config (snapshot at creation)
**When to use:** Always -- the job must be self-contained for reproducibility

```typescript
// Recommended schema for screeningJobs
screeningJobs: defineTable({
  userId: v.id("users"),

  // Job metadata
  status: v.union(
    v.literal("pending"),
    v.literal("processing"),
    v.literal("completed"),
    v.literal("cancelled"),
    v.literal("failed"),
    v.literal("creditsExhausted")
  ),

  // Paper tracking
  totalPapers: v.number(),
  processedPapers: v.number(),
  failedPapers: v.number(),
  qualifiedPapers: v.number(),  // Papers that met score threshold

  // Embedded screening questions (frozen snapshot)
  questions: v.array(v.object({
    key: v.string(),
    question: v.string(),
  })),

  // Embedded scoring config (frozen snapshot)
  scoringConfig: v.object({
    rules: v.array(v.object({
      questionKey: v.string(),
      yesPoints: v.number(),
      noPoints: v.number(),
      nullPoints: v.number(),
    })),
    starThresholds: v.array(v.object({
      minScore: v.number(),
      maxScore: v.number(),
      stars: v.number(),
    })),
    minimumScore: v.optional(v.number()),
  }),

  // Target collection for auto-save
  targetCollectionId: v.optional(v.id("collections")),

  // Search source reference
  searchFilters: v.optional(searchFiltersValidator),

  // Workflow tracking
  workflowId: v.optional(v.string()),

  // Timestamps
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"])
  .index("by_workflow", ["workflowId"]),
```

### Pattern 2: screeningResults Table Design
**What:** Per-paper screening result with AI answers and computed score
**When to use:** One row per paper per job

```typescript
// Recommended schema for screeningResults
screeningResults: defineTable({
  jobId: v.id("screeningJobs"),

  // Paper identification
  openalexId: v.string(),
  title: v.string(),
  abstract: v.optional(v.string()),
  authors: v.optional(v.array(v.string())),
  publicationYear: v.optional(v.number()),
  doi: v.optional(v.string()),

  // Processing status
  status: v.union(
    v.literal("pending"),
    v.literal("processing"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("skipped")  // e.g., credits exhausted
  ),

  // AI screening answers (key -> boolean | null)
  answers: v.optional(v.record(v.string(), v.union(v.boolean(), v.null()))),

  // Computed scoring
  score: v.optional(v.number()),
  stars: v.optional(v.number()),
  qualified: v.optional(v.boolean()),  // Met minimum score threshold

  // AI metadata
  aiMetadata: v.optional(v.object({
    reasoning: v.optional(v.string()),
    confidence: v.optional(v.number()),
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
  })),

  // Credit tracking
  creditsUsed: v.optional(v.number()),

  // Library integration
  savedToLibrary: v.optional(v.boolean()),
  libraryItemId: v.optional(v.id("libraryItems")),

  // Timestamps
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
})
  .index("by_job", ["jobId"])
  .index("by_job_status", ["jobId", "status"])
  .index("by_job_openalexId", ["jobId", "openalexId"]),
```

### Pattern 3: Job Status State Machine
**What:** Valid status transitions for screening jobs
**When to use:** All status updates must follow this machine

```
pending -> processing     (workflow starts)
processing -> completed   (all papers done)
processing -> cancelled   (user cancels)
processing -> failed      (unrecoverable error)
processing -> creditsExhausted  (credits ran out mid-job)
pending -> cancelled      (user cancels before start)
```

### Pattern 4: Credit Pre-flight Check (from existing pattern)
**What:** Verify credits before creating job, but do not deduct upfront
**When to use:** In createScreeningJob mutation

```typescript
// Source: Existing pattern in convex/lib/auth.ts + convex/credits/internal.ts
const credits = await ctx.db
  .query("credits")
  .withIndex("by_user", (q) => q.eq("userId", user._id))
  .unique();

const totalAvailable = (credits?.freeBalance ?? 0) + (credits?.paidBalance ?? 0);
if (totalAvailable < paperCount) {
  throw createError("INSUFFICIENT_CREDITS",
    `Need ${paperCount} credits, have ${totalAvailable}`);
}
```

### Pattern 5: Concurrent Job Guard
**What:** Prevent multiple active jobs per user
**When to use:** In createScreeningJob mutation

```typescript
// Source: CONTEXT.md decision - one active job at a time
const activeJob = await ctx.db
  .query("screeningJobs")
  .withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", "pending"))
  .first();

if (activeJob) {
  throw createError("VALIDATION_ERROR", "A screening job is already active");
}

// Also check "processing" status
const processingJob = await ctx.db
  .query("screeningJobs")
  .withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", "processing"))
  .first();

if (processingJob) {
  throw createError("VALIDATION_ERROR", "A screening job is already active");
}
```

### Pattern 6: Cancellation with Workpool Stop (from extraction)
**What:** Cancel job + stop workpool + credit-guard in processing
**When to use:** cancelScreeningJob mutation

```typescript
// Source: convex/extraction/mutations.ts:250-286
// 1. Update job status to cancelled
await ctx.db.patch(jobId, { status: "cancelled", updatedAt: Date.now() });

// 2. Cancel workflow if running
if (job.workflowId) {
  try {
    await workflow.cancel(ctx, job.workflowId as WorkflowId);
  } catch (e) {
    console.warn(`[cancelScreening] Failed to cancel workflow: ${e}`);
  }
}

// 3. Cancel pending workpool items
// Note: Need a screening-specific workpool to avoid cross-cancellation with extraction
try {
  await screeningPool.cancelAll(ctx);
} catch (e) {
  console.warn(`[cancelScreening] Failed to cancel workpool items: ${e}`);
}
```

### Pattern 7: Reactive Progress Query
**What:** Convex query that reactively updates as job progresses
**When to use:** Client subscribes for real-time progress

```typescript
// Source: Convex reactive queries are natively real-time (no WebSocket needed per REQUIREMENTS.md Out of Scope)
export const getScreeningProgress = query({
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(v.null(), v.object({
    status: v.string(),
    totalPapers: v.number(),
    processedPapers: v.number(),
    failedPapers: v.number(),
    qualifiedPapers: v.number(),
    // Percentage for progress bar
    percentComplete: v.number(),
  })),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;

    return {
      status: job.status,
      totalPapers: job.totalPapers,
      processedPapers: job.processedPapers,
      failedPapers: job.failedPapers,
      qualifiedPapers: job.qualifiedPapers,
      percentComplete: job.totalPapers > 0
        ? Math.round((job.processedPapers / job.totalPapers) * 100)
        : 0,
    };
  },
});
```

### Anti-Patterns to Avoid
- **Separate workpool for screening:** Do NOT reuse `pdfProcessingPool` -- extraction's `cancelAll()` cancels ALL items. Create a dedicated `screeningPool` in `convex/workpool.ts` to avoid cross-cancellation between extraction and screening jobs.
- **Upfront credit deduction:** Do NOT deduct all credits at job creation. Per-batch deduction with credit-guard is the locked decision and matches extraction pattern.
- **Polling for progress:** Do NOT implement polling. Convex reactive queries update automatically when the underlying data changes -- the `getScreeningProgress` query re-runs whenever the job document is patched.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parallel task processing | Custom queue/scheduler | `@convex-dev/workpool` | Handles retries, parallelism, cancellation |
| Durable workflow steps | Manual step tracking | `@convex-dev/workflow` | Handles failures, restarts, step replay |
| Credit deduction atomicity | Custom locking | `deductCredits` internal mutation | OCC provides serializable isolation |
| Rate limiting | Custom counters | `convex-helpers/server/rateLimit` | Already in schema, battle-tested |
| Error types | String error messages | `createError()` from `convex/lib/errors.ts` | Typed error codes, consistent UI handling |

## Common Pitfalls

### Pitfall 1: Cross-Cancellation with Extraction Workpool
**What goes wrong:** Using `pdfProcessingPool.cancelAll()` for screening cancellation also cancels all extraction workpool items (and vice versa).
**Why it happens:** `cancelAll()` cancels ALL items in the pool, not just items for a specific job.
**How to avoid:** Create a separate `screeningPool` workpool instance in `convex/workpool.ts`. The extraction code already has this problem documented in a comment at line 276.
**Warning signs:** Cancelling a screening job causes extraction jobs to stall.

### Pitfall 2: Concurrent Job Check Race Condition
**What goes wrong:** Two simultaneous job creation requests both pass the "no active job" check and both create jobs.
**Why it happens:** Two concurrent mutation transactions read "no active job" and both insert.
**How to avoid:** Convex OCC handles this -- both mutations read the same index range. The second one will conflict and retry, seeing the first job. No additional mitigation needed.
**Warning signs:** This is actually safe in Convex due to OCC.

### Pitfall 3: Status Check with Composite Index
**What goes wrong:** `by_user_status` index only supports exact equality on status. Checking "pending OR processing" requires two queries.
**Why it happens:** Convex indexes use prefix-based equality -- you can't do `status IN ("pending", "processing")` in a single index query.
**How to avoid:** Run two separate index queries (one for pending, one for processing) or use a `by_user` index and filter in-memory (acceptable for small cardinality -- users have few jobs).
**Warning signs:** Trying to use `.filter()` on indexed fields instead of `.withIndex()`.

### Pitfall 4: Forgetting to Add Error Codes to ErrorCode Union
**What goes wrong:** New error codes like `SCREENING_JOB_ALREADY_ACTIVE` throw TypeScript errors.
**Why it happens:** `ErrorCode` in `convex/lib/errors.ts` is a string literal union type -- new codes must be added.
**How to avoid:** Add new screening error codes to the `ErrorCode` type before using them.
**Warning signs:** TypeScript compilation errors in screening mutations.

### Pitfall 5: Embedding Large Paper Data in screeningResults
**What goes wrong:** Storing full paper metadata (title, abstract, authors) in every result row bloats the table.
**Why it happens:** Screening results need paper context for display, so it's tempting to denormalize everything.
**How to avoid:** Store minimal identification (openalexId, title) in screeningResults. The client can fetch full paper data from OpenAlex when needed. Abstract is needed for the AI screening prompt, so it should be stored.
**Warning signs:** screeningResults rows becoming very large.

## Code Examples

### Creating a Screening Job (mutation pattern)
```typescript
// Source: Follows convex/extraction/mutations.ts createExtraction pattern
export const createScreeningJob = mutation({
  args: {
    papers: v.array(v.object({
      openalexId: v.string(),
      title: v.string(),
      abstract: v.optional(v.string()),
      authors: v.optional(v.array(v.string())),
      publicationYear: v.optional(v.number()),
      doi: v.optional(v.string()),
    })),
    questions: v.array(v.object({
      key: v.string(),
      question: v.string(),
    })),
    scoringConfig: screeningScoringConfigValidator,
    targetCollectionId: v.optional(v.id("collections")),
  },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Validate paper count
    if (args.papers.length === 0) {
      throw createError("VALIDATION_ERROR", "No papers provided");
    }
    if (args.papers.length > MAX_SCREENING_PAPERS_PER_JOB) {
      throw createError("VALIDATION_ERROR",
        `Maximum ${MAX_SCREENING_PAPERS_PER_JOB} papers per job`);
    }

    // Check for active job
    // ... (see Pattern 5 above)

    // Credit pre-flight check
    // ... (see Pattern 4 above)

    const now = Date.now();

    // Create job with embedded questions and scoring config
    const jobId = await ctx.db.insert("screeningJobs", {
      userId: user._id,
      status: "pending",
      totalPapers: args.papers.length,
      processedPapers: 0,
      failedPapers: 0,
      qualifiedPapers: 0,
      questions: args.questions,
      scoringConfig: args.scoringConfig,
      targetCollectionId: args.targetCollectionId,
      createdAt: now,
      updatedAt: now,
    });

    // Create pending result records for each paper
    for (const paper of args.papers) {
      await ctx.db.insert("screeningResults", {
        jobId,
        openalexId: paper.openalexId,
        title: paper.title,
        abstract: paper.abstract,
        authors: paper.authors,
        publicationYear: paper.publicationYear,
        doi: paper.doi,
        status: "pending",
        createdAt: now,
      });
    }

    // Start workflow (Phase 77 will implement the actual workflow)
    // const workflowId = await workflow.start(ctx, ...);
    // await ctx.db.patch(jobId, { workflowId });

    return { jobId };
  },
});
```

### Test Pattern (convex-test)
```typescript
// Source: convex/credits/deduct-credits.test.ts pattern
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

async function seedUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_screening_test",
      email: "screening@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("credits", {
      userId,
      freeBalance: 100,
      paidBalance: 0,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });
    return userId;
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side screening (Zustand store) | Server-side bulk screening (Convex) | v4.0 | Screening runs in background even if browser closes |
| Per-paper credit deduction at call time | Per-batch deduction with credit-guard | v3.0 extraction | Prevents billing after cancellation |

**Key insight:** The screening domain is a simplified version of extraction. Extraction has 7 tables (jobs, questions, papers, evidenceUnits, results, reviews, stats). Screening needs only 2 tables (jobs with embedded questions, results) because there is no PDF processing, no RAG indexing, and no evidence anchoring.

## Open Questions

1. **Screening-specific workpool configuration**
   - What we know: Extraction uses `maxParallelism: 3` to avoid overwhelming external PDF services
   - What's unclear: Screening calls AI APIs (like extraction's extracting step) -- appropriate parallelism TBD
   - Recommendation: Start with `maxParallelism: 5` (screening is lighter than PDF extraction); tune based on API rate limits. This is a Phase 77 concern but workpool definition belongs in this phase.

2. **Whether to create screeningResults records upfront or lazily**
   - What we know: Extraction creates all paper records upfront in `createPaperRecords` mutation
   - What's unclear: For screening, creating 200 result records in a single mutation may be heavy
   - Recommendation: Create them upfront (same as extraction) -- 200 lightweight records is well within Convex mutation limits. This enables the progress query to show total count immediately.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest + convex-test |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run convex/screening/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| JOB-01 | createScreeningJob inserts job + result records with correct fields | unit | `npx vitest run convex/screening/mutations.test.ts -t "createScreeningJob"` | Wave 0 |
| JOB-01 | createScreeningJob rejects when papers > 200 | unit | `npx vitest run convex/screening/mutations.test.ts -t "rejects.*exceed"` | Wave 0 |
| JOB-01 | createScreeningJob rejects when active job exists | unit | `npx vitest run convex/screening/mutations.test.ts -t "active.*job"` | Wave 0 |
| JOB-04 | createScreeningJob rejects when insufficient credits | unit | `npx vitest run convex/screening/mutations.test.ts -t "insufficient.*credits"` | Wave 0 |
| JOB-04 | createScreeningJob succeeds when credits >= paperCount | unit | `npx vitest run convex/screening/mutations.test.ts -t "sufficient.*credits"` | Wave 0 |
| JOB-07 | cancelScreeningJob sets status to cancelled | unit | `npx vitest run convex/screening/mutations.test.ts -t "cancel"` | Wave 0 |
| JOB-07 | cancelScreeningJob preserves existing results | unit | `npx vitest run convex/screening/mutations.test.ts -t "preserves.*results"` | Wave 0 |
| JOB-07 | cancelScreeningJob is idempotent for already-terminal jobs | unit | `npx vitest run convex/screening/mutations.test.ts -t "idempotent"` | Wave 0 |
| PROG | getScreeningProgress returns correct counts | unit | `npx vitest run convex/screening/queries.test.ts -t "progress"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run convex/screening/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `convex/screening/mutations.test.ts` -- covers JOB-01, JOB-04, JOB-07
- [ ] `convex/screening/queries.test.ts` -- covers progress query
- [ ] `convex/screening/` directory -- new domain module (does not exist yet)

## Sources

### Primary (HIGH confidence)
- `convex/schema.ts` -- existing table patterns, validators, index conventions
- `convex/extraction/workflow.ts` -- workflow + workpool orchestration pattern
- `convex/extraction/mutations.ts` -- job creation, cancellation, status update patterns
- `convex/extraction/workpoolActions.ts:862-882` -- credit-guard pattern
- `convex/credits/internal.ts:1288+` -- deductCredits mutation with OCC documentation
- `convex/lib/errors.ts` -- createError factory, ErrorCode union type
- `convex/lib/auth.ts` -- requireAuth, getUserCredits helpers
- `convex/lib/queryBounds.ts` -- MAX constants pattern
- `convex/workpool.ts` -- workpool configuration pattern
- `convex/workflow.ts` -- WorkflowManager setup
- `lib/types/screening.types.ts` -- existing ScreeningQuestion type structure

### Secondary (MEDIUM confidence)
- `convex/credits/deduct-credits.test.ts` -- convex-test testing pattern with seed helpers
- `vitest.config.ts` -- test configuration, edge-runtime for Convex tests

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and used in project
- Architecture: HIGH -- direct mirror of proven extraction patterns
- Pitfalls: HIGH -- identified from actual codebase issues (cross-cancellation documented in extraction code)

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- internal patterns, no external dependency changes)
