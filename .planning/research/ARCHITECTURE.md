# Architecture Patterns

**Domain:** Bulk screening jobs, scoring engine, and auto-rating for academic search platform
**Researched:** 2026-03-08
**Confidence:** HIGH (based on direct codebase analysis of existing patterns)

## Executive Summary

The bulk screening feature integrates with 3 existing subsystems: the AI screening pipeline (`generateBatchScreeningResponses`), the library/collections system (`saveToLibrary` + `addToCollection`), and the credit billing system (`withAuthAndCreditsBatch` / `withUserCreditsBatch`). The core architectural challenge is bridging client-side per-page screening (currently synchronous, max ~10 papers at a time) with a background job that processes up to 200 papers asynchronously, computes scores from screening responses, maps scores to star ratings, and saves results to the library -- all while tracking progress and deducting credits correctly.

The recommended approach reuses the existing **Workflow + Workpool** pattern from the extraction system rather than inventing new background job infrastructure. This keeps the codebase consistent and leverages proven patterns for progress tracking, cancellation, credit guards, and error handling.

## Recommended Architecture

### High-Level Data Flow

```
User clicks "Screen All"
    |
    v
[Configuration Dialog] -- user sets scoring rules, rating thresholds, target collection
    |
    v
[startBulkScreening mutation] -- validates, creates screeningJob record, starts workflow
    |
    v
[runBulkScreeningWorkflow] (Workflow)
    |-- Step 1: Fetch all papers from current search results (up to 200)
    |-- Step 2: Batch papers into groups of ~10 for AI screening
    |-- Step 3: For each batch, enqueue via workpool
    |
    v
[screenBatchAction] (Workpool internalAction)
    |-- Calls generateBatchScreeningResponses logic (processScreeningBatch)
    |-- Returns screening responses per paper
    |
    v
[handleScreeningBatchComplete] (Workpool onComplete mutation)
    |-- Computes score per paper using scoring rules
    |-- Maps score to star rating using thresholds
    |-- Calls saveToLibrary (upsert) for each paper
    |-- Calls addToCollection if collection specified
    |-- Updates job progress counters
    |-- Calls finalizeScreeningJobIfDone
```

### Component Boundaries

| Component | Responsibility | Communicates With | New vs Modified |
|-----------|---------------|-------------------|-----------------|
| `screeningJobs` table | Stores bulk screening job state, config, progress | Schema, queries, mutations | **NEW** |
| `screeningJobConfig` (embedded) | Scoring rules + rating thresholds per job | Stored in screeningJobs | **NEW** |
| `startBulkScreening` mutation | Validates input, creates job, starts workflow | workflow, screeningJobs table | **NEW** |
| `runBulkScreeningWorkflow` | Orchestrates batched screening pipeline | workpool, AI actions, mutations | **NEW** |
| `screenBatchAction` | Processes one batch of papers through AI screening | processScreeningBatch, credit system | **NEW** |
| `handleScreeningBatchComplete` | Scores, rates, saves to library/collection | saveToLibrary, addToCollection | **NEW** |
| `finalizeScreeningJobIfDone` | Checks if all batches done, marks job complete | screeningJobs table | **NEW** |
| `cancelBulkScreening` mutation | Cancels running job, stops workpool | workflow, workpool.cancelAll() | **NEW** |
| `getScreeningJobStatus` query | Returns progress for UI polling | screeningJobs table | **NEW** |
| `saveToLibrary` mutation | Upserts paper to library | libraryItems table | **REUSED (via internalMutation variant)** |
| `addToCollection` mutation | Assigns library item to collection | libraryItemCollections table | **REUSED (via internalMutation variant)** |
| `withUserCreditsBatch` helper | Credit check + deduction for background jobs | credits table | **REUSED** |
| `pdfProcessingPool` workpool | Batched action execution with retries | workpool component | **REUSED** |
| `workflow` manager | Durable workflow orchestration | workflow component | **REUSED** |

### New Schema: `screeningJobs` Table

```typescript
screeningJobs: defineTable({
  userId: v.id("users"),

  // Source: search parameters to reproduce the result set
  searchFilters: searchFiltersValidator,

  // Screening questions (captured at creation time)
  questions: v.array(v.string()),

  // Configuration: scoring rules
  scoringRules: v.array(v.object({
    questionIndex: v.number(),    // which screening question (0-based)
    question: v.string(),         // the question text (denormalized for display)
    yesPoints: v.number(),        // points awarded for "yes" (can be negative)
    noPoints: v.number(),         // points awarded for "no" (can be negative)
    nullPoints: v.optional(v.number()), // points for inconclusive (default: 0)
  })),

  // Configuration: rating thresholds (sorted ascending by minScore)
  ratingThresholds: v.array(v.object({
    minScore: v.number(),         // inclusive lower bound
    maxScore: v.number(),         // inclusive upper bound
    rating: v.number(),           // 0-5 stars
  })),

  // Configuration: target collection (optional)
  targetCollectionId: v.optional(v.id("collections")),

  // Job status
  status: v.union(
    v.literal("pending"),
    v.literal("screening"),
    v.literal("saving"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled")
  ),

  // Progress tracking
  totalPapers: v.number(),
  screenedPapers: v.number(),
  savedPapers: v.number(),
  failedPapers: v.number(),

  // Workflow tracking
  workflowId: v.optional(v.string()),

  // Cost tracking
  estimatedCredits: v.optional(v.number()),
  actualCreditsUsed: v.optional(v.number()),

  // Timestamps
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"])
  .index("by_workflow", ["workflowId"]),
```

### New Schema: `screeningResults` Table

```typescript
// Individual paper screening results (for progress tracking and retry)
screeningResults: defineTable({
  jobId: v.id("screeningJobs"),
  openalexId: v.string(),

  // Paper metadata (denormalized for display without joins)
  title: v.string(),
  authors: v.optional(v.string()),
  doi: v.optional(v.string()),
  abstract: v.optional(v.string()),
  publicationYear: v.optional(v.number()),
  journal: v.optional(v.string()),
  citedByCount: v.optional(v.number()),
  isOpenAccess: v.optional(v.boolean()),
  oaStatus: v.optional(v.string()),

  // Screening responses (question index -> true/false/null)
  responses: v.optional(v.record(v.string(), v.union(v.boolean(), v.null()))),
  confidence: v.optional(v.number()),

  // Computed score and rating
  score: v.optional(v.number()),
  rating: v.optional(v.number()),       // 0-5 stars

  // Status
  status: v.union(
    v.literal("pending"),
    v.literal("screened"),    // AI responses received
    v.literal("scored"),      // score computed
    v.literal("saved"),       // saved to library + collection
    v.literal("failed")
  ),

  // Library link (set after save)
  libraryItemId: v.optional(v.id("libraryItems")),

  errorMessage: v.optional(v.string()),
  processedAt: v.optional(v.number()),
})
  .index("by_job", ["jobId"])
  .index("by_job_status", ["jobId", "status"])
  .index("by_job_openalexId", ["jobId", "openalexId"]),
```

## Integration Points with Existing Architecture

### 1. AI Screening Pipeline (REUSE, not duplicate)

The existing `processScreeningBatch` from `lib/ai/core` is the core screening logic. The bulk screening job reuses this directly.

**Current flow (client-initiated):**
```
Client -> generateBatchScreeningResponses action -> processScreeningBatch -> credit deduction
```

**New flow (background job):**
```
Workflow -> screenBatchAction (internalAction) -> processScreeningBatch -> withUserCreditsBatch
```

Key difference: The background action uses `withUserCreditsBatch` (userId-based, no auth context) instead of `withAuthAndCreditsBatch` (auth-context-based). This pattern already exists in `workpoolActions.ts` for extraction.

### 2. Library Save Pipeline (REUSE via internalMutation)

The existing `saveToLibrary` mutation requires `requireAuth(ctx)` which is unavailable in background jobs. Create an `internalSaveToLibrary` variant that accepts `userId` directly.

**Pattern from extraction system (already established):**
```typescript
// Public mutation with auth
export const saveToLibrary = mutation({ ... requireAuth(ctx) ... });

// Internal variant for background jobs (NEW)
export const internalSaveToLibrary = internalMutation({
  args: {
    userId: v.id("users"),
    openalexId: v.string(),
    rating: v.number(),
    // ... same fields as saveToLibrary
  },
  handler: async (ctx, args) => {
    // Same upsert logic as saveToLibrary but using args.userId instead of requireAuth
  },
});
```

### 3. Collection Assignment (REUSE via internalMutation)

Same pattern: `addToCollection` needs an `internalAddToCollection` that takes userId directly and skips `requireAuth`.

### 4. Credit System

Credits are checked before each batch (not upfront for all 200 papers) using the existing credit-guard pattern:

```
Before each batch:
1. Fresh credit balance read (prevents negative balance)
2. Process batch through AI
3. Deduct credits for actual usage
```

This matches the extraction workpool pattern where `withUserCreditsBatch` handles the check-process-deduct cycle per batch.

**Credit estimation** (for the config dialog) can be computed client-side using `calculateServerCreditsToDeduct` with estimated token counts based on average abstract length.

### 5. Workpool Configuration

Reuse the existing `pdfProcessingPool` workpool instance. Screening batches are lightweight (no PDF processing) so they can share the pool without contention issues. The pool's `maxParallelism: 3` prevents overwhelming external AI providers.

Alternatively, define a dedicated `screeningPool` if workload isolation is desired:

```typescript
export const screeningPool = new Workpool(components.workpool, {
  maxParallelism: 5,  // Higher than PDF pool since no I/O bottleneck
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2,
  },
});
```

**Recommendation:** Start by reusing `pdfProcessingPool`. Add a dedicated pool only if contention becomes an issue. Simpler is better.

### 6. Rate Limiting

Add a new rate limit for bulk screening:

```typescript
"start-bulk-screening": {
  kind: "token bucket",
  rate: 3,
  period: HOUR,
  capacity: 2,
},
```

### 7. Progress Tracking

The UI subscribes to `getScreeningJobStatus` query, which is reactive via Convex's subscription model. Each `handleScreeningBatchComplete` mutation updates `screenedPapers` / `savedPapers` counters, triggering re-renders automatically.

## Patterns to Follow

### Pattern 1: Scoring Rules Engine

The scoring engine is a pure function -- no database access needed. Compute score from screening responses + rules in the `handleScreeningBatchComplete` mutation.

**What:** Map screening responses (yes/no/null per question) to a numeric score, then map score to a star rating.
**When:** After each batch of papers receives AI screening responses.
**Example:**

```typescript
function computeScore(
  responses: Record<string, boolean | null>,
  rules: ScoringRule[]
): number {
  let score = 0;
  for (const rule of rules) {
    const key = String(rule.questionIndex);
    const answer = responses[key];
    if (answer === true) score += rule.yesPoints;
    else if (answer === false) score += rule.noPoints;
    else score += rule.nullPoints ?? 0;
  }
  return score;
}

function computeRating(
  score: number,
  thresholds: RatingThreshold[]
): number {
  // Thresholds sorted ascending by minScore
  for (const t of thresholds) {
    if (score >= t.minScore && score <= t.maxScore) {
      return t.rating;
    }
  }
  return 0; // Default: 0 stars if no threshold matches
}
```

### Pattern 2: Batch-then-Save Pipeline

**What:** Process screening in AI batches of ~10, then immediately save results to library.
**Why:** Keeps memory bounded, provides incremental progress, and matches the existing workpool onComplete pattern.

```typescript
// In workflow:
const BATCH_SIZE = 10;
for (let i = 0; i < papers.length; i += BATCH_SIZE) {
  const batch = papers.slice(i, i + BATCH_SIZE);
  await pdfProcessingPool.enqueueAction(ctx, screenBatchAction, {
    jobId, batch, questions, scoringRules, ratingThresholds, collectionId
  }, {
    onComplete: handleScreeningBatchComplete,
    context: { jobId, batchIndex: i / BATCH_SIZE },
  });
}
```

### Pattern 3: Internal Mutation Variants for Background Jobs

**What:** For every public mutation that uses `requireAuth`, create an `internalMutation` variant that accepts `userId` directly.
**Why:** Background workflows/workpool actions don't have auth context. The extraction system already does this (e.g., `internal.users.internal.getUserById`).
**When:** Whenever a background job needs to call a mutation that normally requires authentication.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Upfront Credit Reservation

**What:** Pre-deducting credits for all 200 papers before screening starts.
**Why bad:** If the job is cancelled mid-way, you need complex refund logic. If credit costs vary per paper (different abstract lengths), the estimate may be wrong.
**Instead:** Check + deduct credits per batch, using the existing credit-guard pattern. If credits run out mid-job, the remaining batches fail gracefully and the job reports partial completion.

### Anti-Pattern 2: Storing Scoring Rules Separately from the Job

**What:** Creating a `scoringRules` table with foreign key to `screeningJobs`.
**Why bad:** Scoring rules are job-scoped configuration, not a separate entity. They don't change after job creation. Normalizing them adds joins without benefit.
**Instead:** Embed scoring rules and rating thresholds directly in the `screeningJobs` document as nested objects.

### Anti-Pattern 3: Re-implementing Batch Screening Logic

**What:** Writing new AI screening code instead of reusing `processScreeningBatch`.
**Why bad:** Duplicates prompt engineering, error handling, response parsing, and usage tracking.
**Instead:** Call the existing `processScreeningBatch` from `lib/ai/core` directly. It handles batching, retries, and usage aggregation.

### Anti-Pattern 4: Processing All 200 Papers in One Action

**What:** A single action that loops through all 200 papers sequentially.
**Why bad:** Convex actions have a 10-minute timeout. 200 papers x ~2s per paper = ~400s, which is close to the limit and fragile. No progress reporting until completion.
**Instead:** Use the workpool pattern to process batches of 10, with progress updates after each batch completes.

### Anti-Pattern 5: Calling Public Mutations from Background Jobs

**What:** Having the workflow call `api.library.mutations.saveToLibrary` (public endpoint with auth).
**Why bad:** Background jobs don't have a user session. `requireAuth(ctx)` will throw.
**Instead:** Create `internal.library.mutations.internalSaveToLibrary` that accepts userId as a parameter.

## Detailed Data Flow

### Phase 1: Configuration (Client-side)

```
1. User clicks "Screen All" on results page
2. Configuration dialog opens:
   - Shows current screening questions
   - User assigns points per question (yes/no)
   - User defines rating thresholds (e.g., score 3-5 -> 5 stars, 0-2 -> 3 stars)
   - User optionally selects a target collection
   - UI shows estimated credit cost based on paper count
3. User clicks "Start Screening"
4. Client calls startBulkScreening mutation
```

### Phase 2: Job Initialization (Mutation -> Workflow)

```
startBulkScreening mutation:
  1. requireAuth(ctx)
  2. rateLimit(ctx, "start-bulk-screening", userId)
  3. Validate scoring rules (at least 1 rule, valid point values)
  4. Validate rating thresholds (cover full score range, no gaps)
  5. Create screeningJob record (status: "pending")
  6. Start workflow: runBulkScreeningWorkflow({ jobId })
  7. Return { jobId } to client
```

### Phase 3: Paper Fetching (Workflow Step 1)

```
runBulkScreeningWorkflow:
  Step 1: Fetch papers
    - Call internal action to query OpenAlex API with searchFilters
    - Cap at 200 papers
    - Create screeningResult records (status: "pending")
    - Update job: totalPapers, status: "screening"
```

### Phase 4: Batched Screening (Workflow Steps 2-N)

```
  Step 2-N: For each batch of 10 papers:
    - Enqueue screenBatchAction via workpool
    - screenBatchAction:
      1. Credit guard: check job status (skip if cancelled)
      2. withUserCreditsBatch: check credits, run processScreeningBatch, deduct
      3. Return responses per paper
    - handleScreeningBatchComplete (onComplete):
      1. For each paper in batch:
         a. Compute score from responses + scoringRules
         b. Compute rating from score + ratingThresholds
         c. Update screeningResult: responses, score, rating, status: "scored"
         d. Call internalSaveToLibrary (upsert with computed rating)
         e. If targetCollectionId: call internalAddToCollection
         f. Update screeningResult: libraryItemId, status: "saved"
      2. Increment job.screenedPapers and job.savedPapers
      3. Call finalizeScreeningJobIfDone
```

### Phase 5: Completion

```
finalizeScreeningJobIfDone:
  - Count screeningResults by status
  - If all saved or failed: mark job "completed" or "failed"
  - Update actualCreditsUsed from credit transaction sum
```

## Key Integration Decisions

| Decision | Rationale |
|----------|-----------|
| Reuse Workflow + Workpool (not scheduler-only) | Matches extraction pattern, provides durable execution, retries, cancellation |
| Batch size of 10 papers | Matches existing `generateBatchScreeningResponses` expectations, stays well under action timeout |
| Store screeningResults as separate table | Enables per-paper progress tracking, retry of failed papers, and job result inspection |
| Embed scoring config in screeningJobs | Job-scoped config, immutable after creation, no join overhead |
| Internal mutation variants for save/collection | Background jobs lack auth context -- established pattern from extraction system |
| Credit deduction per batch (not upfront) | Avoids refund complexity, handles cancellation naturally, matches extraction credit-guard |
| Reuse pdfProcessingPool | Simpler than creating new pool, screening batches are lightweight |
| Screening questions passed at job creation | Captures the exact questions at screening time, immutable for consistency |

## Build Order (Dependency-Aware)

1. **Schema + internal mutations first** -- `screeningJobs` table, `screeningResults` table, `internalSaveToLibrary`, `internalAddToCollection`
2. **Scoring engine (pure functions)** -- `computeScore`, `computeRating`, can be tested independently
3. **Workflow + workpool actions** -- `screenBatchAction`, `handleScreeningBatchComplete`, `runBulkScreeningWorkflow`
4. **Public mutations + queries** -- `startBulkScreening`, `cancelBulkScreening`, `getScreeningJobStatus`
5. **Configuration dialog UI** -- scoring rules editor, rating thresholds editor, collection picker, cost estimation
6. **Progress UI** -- job status indicator, paper count progress bar

## Scalability Considerations

| Concern | At 50 papers | At 200 papers | At 500+ papers (future) |
|---------|-------------|---------------|------------------------|
| Batch count | 5 batches | 20 batches | 50+ batches |
| Action runtime | ~10s total | ~40s total | Would need higher parallelism |
| Credit check frequency | 5 DB reads | 20 DB reads | Acceptable, OCC handles contention |
| screeningResults size | Small | Moderate, .take(500) bound | Need pagination for results view |
| Workpool queue depth | Trivial | Manageable | May need dedicated pool |

## Sources

- Direct codebase analysis of:
  - `convex/extraction/workflow.ts` -- existing workflow pattern
  - `convex/extraction/workpoolActions.ts` -- existing workpool action pattern
  - `convex/extraction/mutations.ts` -- existing onComplete, finalizeJobIfDone patterns
  - `convex/ai/actions.ts` -- existing `generateBatchScreeningResponses`
  - `convex/ai/helpers.ts` -- `withUserCreditsBatch` for background credit handling
  - `convex/library/mutations.ts` -- `saveToLibrary` upsert pattern
  - `convex/library/collections.ts` -- `addToCollection` idempotent pattern
  - `convex/workpool.ts` -- workpool configuration
  - `convex/workflow.ts` -- workflow manager configuration
  - `convex/schema.ts` -- full schema for integration context
  - `convex/lib/rateLimit.ts` -- rate limiting configuration
  - `convex/extraction/guard.ts` -- plan tier enforcement pattern
