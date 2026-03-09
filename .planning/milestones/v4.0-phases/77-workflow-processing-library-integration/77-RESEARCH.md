# Phase 77: Workflow Processing & Library Integration - Research

**Researched:** 2026-03-09
**Domain:** Convex workflow + workpool for bulk screening, library/collection integration, credit-guard billing
**Confidence:** HIGH

## Summary

Phase 77 wires together the screening infrastructure (Phase 75 schema + mutations) and scoring engine (Phase 76 pure functions) into a working background processing pipeline. The core challenge is building a Convex workflow that processes papers through AI screening, scores results, saves qualifying papers to the library, adds them to collections, and handles credits -- all while tolerating per-paper failures and supporting cancellation.

The codebase already has a battle-tested extraction workflow+workpool pattern (`convex/extraction/workflow.ts` + `convex/extraction/workpoolActions.ts`) that this phase should closely mirror. The screening pipeline is simpler than extraction (no PDF download/indexing, no RAG retrieval -- just title+abstract AI screening), so the implementation can reuse the same architectural pattern with fewer steps. All building blocks exist: `screeningPool` (separate workpool component), `workflow` (WorkflowManager), `processScreeningBatch` (AI batch processor), `scorePaper` (scoring engine), `saveToLibrary` / `addToCollection` (library mutations with denormalized counters).

**Primary recommendation:** Build a single-step workpool action per paper (screen -> score -> save) with an onComplete handler that updates job progress and finalizes when all papers are done -- directly mirroring the extraction pattern but with a simpler single-step pipeline.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| JOB-05 | Bulk screening runs in background via Convex workflow (papers processed even if user closes browser) | Workflow+workpool pattern from extraction; `workflow.define()` starts durable execution, `screeningPool.enqueueAction()` processes papers asynchronously |
| LIB-01 | Qualifying papers are automatically saved to the user's library with the computed star rating | `saveToLibrary` mutation exists with upsert semantics + denormalized counter; scoring engine `scorePaper()` produces `{ score, stars, qualified }` |
| LIB-02 | Qualifying papers are automatically added to the user-selected collection | `addToCollection` mutation exists with idempotent junction-table check + denormalized counter; `targetCollectionId` already stored on screening job |
| LIB-03 | User selects a target collection (or creates a new one) in the configuration dialog | `targetCollectionId` field already in schema (`v.optional(v.id("collections"))`); collection picker is Phase 78 UI concern, but the backend must accept and use it |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @convex-dev/workflow | existing | Durable workflow orchestration | Already used for extraction; provides `step.runQuery/runMutation/runAction` with automatic retry |
| @convex-dev/workpool | existing | Parallel paper processing with retry + onComplete | Already configured as `screeningWorkpool` component; provides `enqueueAction`, `defineOnComplete`, `cancelAll` |
| convex/values | existing | Typed validators for all args/returns | Project standard -- zero v.any() policy |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lib/ai/core/batch | existing | `processScreeningBatch` | AI screening call for each paper |
| convex/screening/scoring | existing | `scorePaper`, `computeScore`, `computeStarRating`, `isQualified` | Score/rate/qualify each screened paper |
| convex/ai/helpers | existing | `withUserCreditsBatch`, `calculateServerCreditsToDeduct`, `getModel` | Credit deduction per batch |
| convex/library/mutations | existing | `saveToLibrary` | Save qualifying papers to library |
| convex/library/collections | existing | `addToCollection` | Add qualifying papers to collection |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-paper workpool action | Batch all papers in single action | Per-paper gives fail-soft isolation (one failure doesn't block others) and natural progress tracking |
| Direct mutation for library save | internalMutation wrapper | Must use internal mutations from workpool onComplete handlers since there's no auth context |

## Architecture Patterns

### Recommended Project Structure
```
convex/
├── screening/
│   ├── workflow.ts          # NEW: screening workflow definition
│   ├── workpoolActions.ts   # NEW: screening workpool action (AI screen per paper)
│   ├── mutations.ts         # EXTEND: add internal mutations for workflow
│   ├── queries.ts           # EXTEND: add internal queries for workflow
│   ├── validators.ts        # existing
│   └── scoring.ts           # existing (Phase 76)
```

### Pattern 1: Workflow + Workpool Pipeline (mirror extraction pattern)
**What:** Workflow orchestrates the job lifecycle, workpool processes individual papers
**When to use:** Background processing with per-item parallelism and fault isolation

```typescript
// convex/screening/workflow.ts
export const runScreeningWorkflow = workflow.define({
  args: { jobId: v.id("screeningJobs") },
  handler: async (step, { jobId }) => {
    // Step 1: Load job + pending results
    const job = await step.runQuery(internal.screening.queries.getJobInternal, { jobId });
    const pendingResults = await step.runQuery(
      internal.screening.queries.getPendingResults, { jobId }
    );

    // Step 2: Update status to processing
    await step.runMutation(internal.screening.mutations.updateJobStatus, {
      jobId, status: "processing",
    });

    // Step 3: Enqueue each paper for screening via workpool
    for (const result of pendingResults) {
      await step.runMutation(internal.screening.mutations.enqueueScreeningPaper, {
        resultId: result._id,
        jobId,
      });
    }
  },
});
```

### Pattern 2: Single-Step Workpool Action per Paper
**What:** Each paper gets one workpool action: AI screen -> score -> save to library
**When to use:** When pipeline is simple (no multi-step like extraction's download+index+extract)

```typescript
// convex/screening/workpoolActions.ts
export const screenPaperAction = internalAction({
  args: {
    resultId: v.id("screeningResults"),
    jobId: v.id("screeningJobs"),
  },
  handler: async (ctx, args) => {
    // 1. Load result + job data
    // 2. Credit guard: check job not cancelled
    // 3. Call AI screening (processScreeningBatch with single paper)
    // 4. Return screening responses + usage
  },
});
```

### Pattern 3: OnComplete Handler with Scoring + Library Save
**What:** Workpool onComplete receives AI results, runs scoring, conditionally saves to library
**When to use:** After each paper's AI screening completes

```typescript
// convex/screening/mutations.ts
export const handleScreeningComplete = screeningPool.defineOnComplete({
  context: v.object({
    resultId: v.id("screeningResults"),
    jobId: v.id("screeningJobs"),
  }),
  handler: async (ctx, { context, result }) => {
    if (result.kind === "success") {
      const data = result.returnValue;
      // 1. Score paper: scorePaper(answers, config)
      // 2. Update screeningResult with answers, score, stars, qualified
      // 3. If qualified: save to library (internal mutation)
      // 4. If qualified + targetCollectionId: add to collection (internal mutation)
      // 5. Update job progress counters
    } else {
      // Mark result as failed, update job counters
    }
    // 6. Check if all papers done -> finalize job
  },
});
```

### Pattern 4: Internal Mutations for Library Save (no auth context)
**What:** Workpool onComplete handlers run without user auth context -- need internal mutations
**When to use:** When saving to library from background job

```typescript
// convex/screening/mutations.ts (or convex/library/mutations.ts)
export const saveToLibraryInternal = internalMutation({
  args: {
    userId: v.id("users"),
    openalexId: v.string(),
    rating: v.number(),
    title: v.string(),
    // ... other fields
  },
  handler: async (ctx, args) => {
    // Same logic as saveToLibrary but accepts userId directly
    // Upsert: check by_user_openalexId, update or insert
    // Maintain denormalized libraryItemCount counter
  },
});
```

### Pattern 5: Credit-Guard in Workpool Action
**What:** Fresh DB read before AI call to skip cancelled/exhausted jobs
**When to use:** Every workpool action that costs credits

```typescript
// Credit guard pattern (from extraction workpoolActions.ts)
const freshJob = await ctx.runQuery(internal.screening.queries.getJobInternal, { jobId });
if (freshJob?.status === "cancelled" || freshJob?.status === "creditsExhausted") {
  console.log(`[creditGuard] Skipping - job ${jobId} is ${freshJob.status}`);
  return { success: false, skipped: true };
}
```

### Anti-Patterns to Avoid
- **Processing all papers in a single action:** One failure kills the whole batch. Use per-paper workpool actions for fail-soft isolation.
- **Using `requireAuth` in onComplete handlers:** Workpool onComplete handlers don't have auth context. Use `internalMutation` with explicit `userId`.
- **Calling `saveToLibrary` (public mutation) from onComplete:** Public mutations require auth. Create `saveToLibraryInternal` with userId param.
- **Forgetting denormalized counter updates:** Both `libraryItemCount` on users and `itemCount` on collections must be maintained atomically.
- **Processing 200 papers in parallel with no concurrency limit:** The screeningPool already has `maxParallelism: 5`, which prevents overwhelming the AI provider and reduces OCC conflicts on counter updates.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Durable background processing | Custom scheduler loop | `workflow.define()` + `screeningPool.enqueueAction()` | Automatic retry, cancellation, crash recovery |
| Per-paper fail-soft | try/catch in a loop | Workpool with `onComplete` handler | Each paper is an independent work item; failures don't propagate |
| Library save with upsert | Custom upsert logic | Adapt existing `saveToLibrary` pattern | Already handles by_user_openalexId uniqueness, denormalized counter |
| Collection membership idempotency | Custom duplicate check | Adapt existing `addToCollection` pattern | Already checks by_collection_item index, maintains itemCount counter |
| Credit deduction with OCC | Manual balance tracking | `internal.credits.internal.deductCredits` | Convex OCC ensures serializable isolation, free-first deduction |
| AI screening call | Raw API call | `processScreeningBatch` from lib/ai/core | Handles structured output, retries, usage tracking |
| Score computation | Manual if/else scoring | `scorePaper()` from scoring.ts | Already tested, handles all edge cases (null points, clamping, qualification) |

**Key insight:** Every component needed for Phase 77 already exists in the codebase. This phase is purely about wiring them together in the right order with the right patterns.

## Common Pitfalls

### Pitfall 1: Denormalized Counter Contention on Bulk Library Save
**What goes wrong:** Saving 200 qualifying papers to the library means 200 increments to `user.libraryItemCount` and potentially 200 increments to `collection.itemCount`. With `maxParallelism: 5`, OCC retries should handle this, but high contention is possible.
**Why it happens:** All papers for one user update the same counter document.
**How to avoid:** The workpool's `maxParallelism: 5` naturally serializes somewhat. The onComplete handler (which does the library save) runs as a mutation, so Convex OCC will retry on conflict. For 200 papers at parallelism 5, this is manageable -- Convex handles up to 32 OCC retries.
**Warning signs:** Mutation failures in logs with "contention" or OCC retry exhaustion.

### Pitfall 2: Missing Internal Mutations for Background Operations
**What goes wrong:** Workpool actions and onComplete handlers run without user auth context. Calling `requireAuth`-gated mutations will fail.
**Why it happens:** The workflow starts the job, but individual paper processing runs in background actions.
**How to avoid:** Create `internalMutation` variants of `saveToLibrary` and `addToCollection` that accept `userId` as a parameter instead of extracting it from auth.
**Warning signs:** "Authentication required" errors in workpool action logs.

### Pitfall 3: Credit Exhaustion Mid-Job
**What goes wrong:** User runs out of credits after processing some papers but before finishing all.
**Why it happens:** Credit pre-flight check at job creation ensures enough credits for the batch, but actual AI costs may vary.
**How to avoid:** Credit-guard pattern: before each paper's AI call, check job status. If credits exhaust, deductCredits throws INSUFFICIENT_CREDITS. Catch this in the action, update job status to "creditsExhausted", and let remaining papers be skipped via credit guard.
**Warning signs:** Papers stuck in "pending" status after job marked "creditsExhausted".

### Pitfall 4: Workflow ID Not Stored on Job
**What goes wrong:** Cancel mutation can't cancel the workflow because workflowId was never saved.
**Why it happens:** Workflow is started but the returned workflowId isn't patched onto the job record.
**How to avoid:** After `workflow.start()`, immediately store the workflowId on the screening job (same pattern as extraction's `setJobWorkflowId`).
**Warning signs:** Cancel button appears to work but papers continue processing.

### Pitfall 5: Job Finalization Race
**What goes wrong:** Job never transitions to "completed" because the finalization check runs before the last paper's onComplete updates counters.
**Why it happens:** onComplete handlers run asynchronously; two could race on the final count check.
**How to avoid:** Use the extraction pattern: each onComplete increments processedPapers atomically, then calls `finalizeScreeningJobIfDone` which checks if processedPapers + failedPapers >= totalPapers.
**Warning signs:** Job stuck in "processing" with all papers completed.

## Code Examples

### Starting Workflow from createScreeningJob
```typescript
// In createScreeningJob mutation, after inserting job + results:
const workflowId = await workflow.start(
  ctx,
  internal.screening.workflow.runScreeningWorkflow,
  { jobId }
);
await ctx.db.patch(jobId, { workflowId: String(workflowId) });
```

### Enqueue Paper for Screening
```typescript
// convex/screening/mutations.ts
export const enqueueScreeningPaper = internalMutation({
  args: {
    resultId: v.id("screeningResults"),
    jobId: v.id("screeningJobs"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.resultId, { status: "processing" });
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

### Internal Library Save (No Auth Context)
```typescript
// convex/screening/mutations.ts
export const saveQualifiedPaperToLibrary = internalMutation({
  args: {
    userId: v.id("users"),
    openalexId: v.string(),
    rating: v.number(), // star rating from scoring
    title: v.string(),
    authors: v.optional(v.string()),
    doi: v.optional(v.string()),
    abstract: v.optional(v.string()),
    publicationYear: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const searchableText = [args.title, args.abstract, args.authors]
      .filter(Boolean)
      .join(" ");

    // Upsert: same pattern as saveToLibrary
    const existing = await ctx.db
      .query("libraryItems")
      .withIndex("by_user_openalexId", (q) =>
        q.eq("userId", args.userId).eq("openalexId", args.openalexId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        rating: args.rating,
        searchableText,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    const id = await ctx.db.insert("libraryItems", {
      userId: args.userId,
      ...args,
      searchableText,
      savedAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Increment denormalized counter
    const user = await ctx.db.get(args.userId);
    if (user) {
      const currentCount = user.libraryItemCount ?? 0;
      await ctx.db.patch(args.userId, { libraryItemCount: currentCount + 1 });
    }

    return id;
  },
});
```

### Internal Collection Add (Idempotent, No Auth Context)
```typescript
export const addToCollectionInternal = internalMutation({
  args: {
    userId: v.id("users"),
    collectionId: v.id("collections"),
    libraryItemId: v.id("libraryItems"),
  },
  handler: async (ctx, args) => {
    // Idempotent: check for existing assignment
    const existing = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection_item", (q) =>
        q.eq("collectionId", args.collectionId)
          .eq("libraryItemId", args.libraryItemId)
      )
      .unique();

    if (existing) return; // Already assigned, no-op

    await ctx.db.insert("libraryItemCollections", {
      userId: args.userId,
      collectionId: args.collectionId,
      libraryItemId: args.libraryItemId,
      assignedAt: Date.now(),
    });

    // Increment denormalized collection counter
    const collection = await ctx.db.get(args.collectionId);
    if (collection) {
      const currentCount = collection.itemCount ?? 0;
      await ctx.db.patch(args.collectionId, { itemCount: currentCount + 1 });
    }
  },
});
```

### Finalize Job Pattern
```typescript
export const finalizeScreeningJobIfDone = internalMutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    // Don't finalize terminal jobs
    if (["completed", "cancelled", "failed", "creditsExhausted"].includes(job.status)) {
      return null;
    }

    const allDone = job.processedPapers + job.failedPapers >= job.totalPapers;
    if (!allDone) return null;

    await ctx.db.patch(args.jobId, {
      status: "completed",
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| All-in-one batch action | Per-paper workpool items | Phase 75 decision | Fail-soft isolation, natural progress tracking |
| `saveToLibrary` (auth-gated) | `saveToLibraryInternal` (userId param) | Phase 77 (new) | Background jobs can save without auth context |
| Single workpool for everything | Separate `screeningWorkpool` component | Phase 75 decision | `cancelAll()` isolation -- cancelling screening doesn't cancel extraction |

## Open Questions

1. **Credit deduction granularity: per-paper or per-batch?**
   - What we know: Extraction uses `withUserCreditsBatch` which deducts per-batch. The existing `generateBatchScreeningResponses` action uses `withAuthAndCreditsBatch` with per-paper usage breakdown.
   - What's unclear: For the workpool pattern (one action per paper), deduction should happen per-paper in the action.
   - Recommendation: Use `withUserCreditsBatch` in each per-paper action. The credit-guard checks job status before calling AI; if credits exhaust mid-job, subsequent papers catch `INSUFFICIENT_CREDITS` and mark the job as `creditsExhausted`.

2. **authors field format mismatch between screeningResults and libraryItems**
   - What we know: `screeningResults.authors` is `v.optional(v.array(v.string()))` but `libraryItems.authors` is `v.optional(v.string())` (single concatenated string).
   - What's unclear: Nothing -- this is a known schema difference.
   - Recommendation: Join the array with ", " when saving to library: `args.authors?.join(", ")`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.x + convex-test |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run convex/screening/ --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| JOB-05 | Workflow starts and enqueues papers for processing | unit | `npx vitest run convex/screening/workflow.test.ts -x` | No - Wave 0 |
| JOB-05 | Per-paper failures don't block batch (fail-soft) | unit | `npx vitest run convex/screening/workpool.test.ts -x` | No - Wave 0 |
| JOB-05 | Credit guard skips cancelled/exhausted jobs | unit | `npx vitest run convex/screening/workpool.test.ts -x` | No - Wave 0 |
| LIB-01 | Qualifying papers saved to library with star rating | unit | `npx vitest run convex/screening/mutations.test.ts -x` | Partially (mutations.test.ts exists but no library save tests) |
| LIB-01 | Non-qualifying papers NOT saved to library | unit | `npx vitest run convex/screening/mutations.test.ts -x` | No - Wave 0 |
| LIB-02 | Qualifying papers added to target collection (idempotent) | unit | `npx vitest run convex/screening/mutations.test.ts -x` | No - Wave 0 |
| LIB-03 | targetCollectionId flows from job to library save | unit | `npx vitest run convex/screening/mutations.test.ts -x` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run convex/screening/ --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `convex/screening/workflow.test.ts` -- covers JOB-05 workflow orchestration
- [ ] `convex/screening/workpool.test.ts` -- covers JOB-05 fail-soft, credit guard
- [ ] Extend `convex/screening/mutations.test.ts` -- covers LIB-01, LIB-02, LIB-03 library save + collection add

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `convex/extraction/workflow.ts` -- established workflow pattern
- Codebase analysis: `convex/extraction/workpoolActions.ts` -- established workpool action pattern with credit guard
- Codebase analysis: `convex/extraction/mutations.ts` -- established onComplete + finalizeJobIfDone pattern
- Codebase analysis: `convex/library/mutations.ts` -- saveToLibrary with upsert + denormalized counter
- Codebase analysis: `convex/library/collections.ts` -- addToCollection with idempotent junction + counter
- Codebase analysis: `convex/screening/scoring.ts` -- pure scoring engine (Phase 76)
- Codebase analysis: `convex/screening/mutations.ts` -- createScreeningJob + cancelScreeningJob (Phase 75)
- Codebase analysis: `convex/workpool.ts` -- screeningPool configuration (maxParallelism: 5)
- Codebase analysis: `convex/convex.config.ts` -- screeningWorkpool component registered

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in codebase and production-tested
- Architecture: HIGH -- directly mirrors extraction workflow pattern
- Pitfalls: HIGH -- learned from extraction implementation
- Library integration: HIGH -- existing mutations with clear patterns

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- all components are internal codebase patterns)
