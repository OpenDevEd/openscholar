# Technology Stack: v4.0 Bulk Screening & Auto-Rating

**Project:** OpenAlex Count
**Researched:** 2026-03-08
**Confidence:** HIGH
**Scope:** Stack additions for background bulk screening, user-defined scoring/rating rules, and progress tracking. Existing stack (Next.js, Convex ^1.31.7, @convex-dev/workflow ^0.3.4, @convex-dev/workpool ^0.3.1, ai ^6.0.62, Zustand, nuqs, sonner, 786+ tests, zero-any codebase) is validated -- NOT re-researched.

---

## Key Finding: No New Dependencies Needed

The existing stack contains every building block required for v4.0. This is an **integration milestone**, not an infrastructure milestone. The project already has durable workflow orchestration, parallel background processing, a production-proven batch screening action, complete library/collection mutation infrastructure, reactive progress queries, and a credit guard pattern for background jobs.

---

## Existing Stack (Validated - DO NOT change)

| Technology | Version | v4.0 Role |
|------------|---------|-----------|
| `@convex-dev/workflow` | ^0.3.4 | Top-level bulk screening job orchestration (same pattern as extraction workflow) |
| `@convex-dev/workpool` | ^0.3.1 | Parallel batch fan-out with retry (if needed for speed) |
| `convex` | ^1.31.7 | Mutations, queries, actions, scheduler, reactive subscriptions |
| `convex-helpers` | ^0.1.111 | Rate limiting on the new screening endpoint |
| `ai` | ^6.0.62 | LLM calls via `generateBatchScreeningResponses` action |
| `zustand` | ^5.0.5 | Client-side dialog state, optimistic UI |
| `nuqs` | ^2.6.0 | URL state for screening job filters |
| `sonner` | ^2.0.7 | Toast feedback for job creation/completion |

---

## What v4.0 Needs (All Achievable With Existing Stack)

### 1. Bulk Screening Job Orchestration

**Use:** `@convex-dev/workflow` (existing `workflow.ts` singleton)

The extraction workflow (`convex/extraction/workflow.ts`) is the exact pattern to follow. It demonstrates:
- Multi-step durable execution (`step.runQuery`, `step.runMutation`, `step.runAction`)
- Paper batching and deduplication
- Status updates at each stage
- Workpool integration for parallel processing
- Credit guard pattern for cancelled jobs

**For bulk screening:** Define a new `runBulkScreeningWorkflow` following the same pattern:
1. Create `bulkScreeningJobs` record (status: "pending")
2. Batch papers (up to 200) into chunks of 10-20 for `generateBatchScreeningResponses`
3. Process each batch via `step.runAction` (sequential within workflow, retried on failure)
4. After each batch: apply scoring rules, compute ratings, save to library, assign to collection
5. Update progress counters after each batch via `step.runMutation`

**Why sequential batches over workpool fan-out:** Start simple. The screening workload is lighter than extraction (no PDF downloads, just LLM calls on title+abstract). With 200 papers in batches of 20, that is 10 sequential batch calls. At ~20-40s per batch, total wall time is 200-400s -- acceptable for a background job. If speed becomes a concern, add a second `Workpool` instance with zero new dependencies (just another instantiation in `workpool.ts`).

**Confidence:** HIGH -- extraction workflow proves the pattern at scale.

### 2. Background Batch Processing

**Use:** `generateBatchScreeningResponses` action (existing `convex/ai/actions.ts`)

This action already:
- Accepts `papers: Array<{id, title, abstract}>` and `questions: Array<string>`
- Returns `results: Record<paperId, {responses: Record<questionKey, boolean|null>, confidence: number}>`
- Handles per-paper credit deduction via `withAuthAndCreditsBatch`
- Encodes question keys for Convex compatibility via `encodeQuestionResponseMap`

**Integration consideration:** The existing action uses `withAuthAndCreditsBatch` which requires auth context. For background workflow execution, create an internal variant that uses `withUserCreditsBatch` (already exists in `ai/helpers.ts`) accepting `userId` directly. This follows the exact pattern used by `waitAndExtractAction` in `convex/extraction/workpoolActions.ts`.

**Confidence:** HIGH -- action is production-proven.

### 3. Scoring & Rating Rules Engine

**Use:** Pure TypeScript functions (no library needed)

Scoring rules are simple arithmetic:
- Each screening question has a score weight: `yes -> +N points`, `no -> -M points`, `null -> 0`
- Total score = sum of per-question scores
- Star rating thresholds: user-defined score ranges map to 0-5 stars

This is a pure function: `(screeningResponses, scoringRules, ratingThresholds) -> { score, rating }`. No library needed. Store rules in the job configuration document.

**Schema design for scoring rules:**
```typescript
scoringRules: v.array(v.object({
  questionIndex: v.number(),
  yesScore: v.number(),     // Points when answer is true (e.g., +2)
  noScore: v.number(),      // Points when answer is false (e.g., -1)
})),
ratingThresholds: v.array(v.object({
  minScore: v.number(),     // Minimum score for this rating
  rating: v.number(),       // 0-5 stars
})),
```

**Confidence:** HIGH -- pure arithmetic, no external dependencies.

### 4. Progress Tracking

**Use:** Convex reactive queries (existing pattern)

The extraction workflow already demonstrates this exact pattern:
- `extractionJobs.processedPapers` / `totalPapers` counters updated via `updateJobStatus` mutation
- Client subscribes via `useQuery` and gets real-time updates automatically

**For bulk screening:** Same pattern. The `bulkScreeningJobs` table has `totalPapers`, `processedPapers`, `failedPapers` counters. Client uses `useQuery(api.screening.queries.getJobProgress, { jobId })` for live updates. Convex's reactive query system means the UI updates automatically when the workflow mutates progress counters -- no polling, no WebSocket setup, no SSE.

**Confidence:** HIGH -- Convex reactive queries make this trivial.

### 5. Library Save & Collection Assignment from Background Jobs

**Use:** Internal variants of existing `saveToLibrary` + `addToCollection` mutations

Both mutations exist and are production-proven. The bulk screening workflow needs **internal variants** (no auth check, accepts userId directly) because background jobs run without user auth context.

**Pattern:**
```typescript
export const internalSaveToLibrary = internalMutation({
  args: {
    userId: v.id("users"),
    // ... same fields as saveToLibrary
  },
  handler: async (ctx, args) => {
    // Same logic as saveToLibrary but uses args.userId instead of requireAuth()
  },
});
```

This follows the existing `withUserCreditsBatch` pattern in `ai/helpers.ts` which already handles background jobs without auth context. The extraction workflow uses this same approach.

**Confidence:** HIGH -- straightforward internal mutation variants.

### 6. Credit Cost Estimation

**Use:** Existing `calculateServerCreditsToDeduct` + model cost registry

Pre-screening cost estimation: multiply estimated per-paper token usage by paper count. Based on observed screening calls: ~500 input tokens (title + abstract + questions), ~100 output tokens per paper. The `calculateCreditsToDeductFromUsage` function provides the credit conversion.

**Display:** Show as range ("~X-Y credits") since actual costs vary with abstract length.

**Confidence:** MEDIUM -- estimates are approximate; actual costs vary with abstract length and question count.

---

## Recommended New Convex Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `bulkScreeningJobs` | Job state, config, progress | userId, status, totalPapers, processedPapers, failedPapers, questions, scoringRules, ratingThresholds, targetCollectionId, workflowId, estimatedCredits, createdAt, updatedAt, completedAt |
| `bulkScreeningResults` | Per-paper screening outcomes | jobId, openalexId, title, abstract, authors, publicationYear, doi, responses, score, rating, libraryItemId, status, error, processedAt |

**Index design (following existing patterns):**
```
bulkScreeningJobs:
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"])
  .index("by_workflow", ["workflowId"])

bulkScreeningResults:
  .index("by_job", ["jobId"])
  .index("by_job_status", ["jobId", "status"])
```

---

## Recommended New Functions

| Function | Type | Purpose |
|----------|------|---------|
| `screening/workflow.runBulkScreeningWorkflow` | `workflow.define` | Orchestrates full screening pipeline |
| `screening/mutations.createBulkScreeningJob` | `mutation` | Creates job record, validates config, starts workflow |
| `screening/mutations.cancelBulkScreeningJob` | `mutation` | Cancels in-progress job (follows extraction cancel pattern) |
| `screening/mutations.updateScreeningProgress` | `internalMutation` | Updates progress counters |
| `screening/mutations.saveScreeningResult` | `internalMutation` | Stores per-paper result |
| `screening/queries.getJobProgress` | `query` | Live progress for UI (reactive) |
| `screening/queries.getJobResults` | `query` | Results list for completed job |
| `screening/queries.listMyScreeningJobs` | `query` | User's screening job history |
| `screening/actions.processScreeningBatch` | `internalAction` | Calls AI screening, applies scoring, saves results |
| `library/mutations.internalSaveToLibrary` | `internalMutation` | Auth-free save for background jobs |
| `library/collections.internalAddToCollection` | `internalMutation` | Auth-free collection assignment |
| `lib/scoring.ts` | pure functions | `computeScore()` and `computeRating()` |

---

## What NOT to Add

| Anti-Addition | Why Not |
|---------------|---------|
| Redis / BullMQ / any job queue | Convex workflow + workpool already provides durable job processing with retries, progress tracking, and cancellation |
| WebSocket / SSE library | Convex reactive queries provide real-time updates out of the box via `useQuery` |
| XState / state machine library | Job status transitions are linear (pending -> screening -> scoring -> saving -> completed); a union type with `v.literal()` suffices |
| react-hook-form / formik | Configuration dialog has ~10-15 fields; local `useState` or Zustand slice is sufficient |
| New AI provider or SDK | `generateBatchScreeningResponses` uses the configured provider via Vercel AI SDK |
| Database migration tool | New tables are purely additive; Convex handles schema evolution automatically |
| Progress bar component library | A div with `width: ${(processed/total)*100}%` is sufficient; existing Radix UI provides primitives if needed |
| `@convex-dev/crons` or scheduler add-on | `ctx.scheduler.runAfter(0, ...)` and workflow's built-in retry handle all scheduling needs |
| Separate `screeningPool` workpool (initially) | Start with sequential batch processing in the workflow; add parallelism only if wall time is unacceptable |

---

## Critical Integration Points

### 1. Auth Context in Background Jobs

The existing `withUserCreditsBatch` helper in `ai/helpers.ts` solves this. It accepts `userId` directly and skips auth checks. The bulk screening workflow must:
1. Capture `userId` at job creation time (from authenticated `createBulkScreeningJob` mutation)
2. Pass `userId` through the workflow to all internal actions/mutations
3. Use `withUserCreditsBatch` for credit-aware AI calls in `processScreeningBatch`
4. Use `internalSaveToLibrary` / `internalAddToCollection` for library writes

### 2. Credit Guard Pattern

Follow the extraction workflow's credit guard (from `workpoolActions.ts:958-973`):
- Before each batch, re-read job status from DB
- If job is cancelled, skip processing and credit deduction
- Race window of 0-1 batch (~10-20 papers) is acceptable

### 3. Rate Limiting

Add a rate limit for `createBulkScreeningJob` using the existing `defineRateLimits` pattern in `lib/rateLimit.ts`. Suggested: 5 jobs per hour per user (token bucket).

### 4. Bounded Queries

Follow `queryBounds.ts` pattern. Add:
```typescript
export const MAX_SCREENING_RESULTS_PER_JOB = 200;
export const MAX_SCREENING_JOBS_PER_USER = 100;
```

---

## Installation

```bash
# No new packages to install.
# All changes use existing Convex primitives and installed libraries.
```

---

## Version Compatibility

| Package | Current Version | v4.0 Relevance |
|---------|----------------|----------------|
| `convex` | ^1.31.7 | All APIs used (mutations, queries, actions, scheduler) are stable since v1.0 |
| `@convex-dev/workflow` | ^0.3.4 | `workflow.define()` for durable orchestration -- same as extraction |
| `@convex-dev/workpool` | ^0.3.1 | Available if parallelism needed later |
| `ai` | ^6.0.62 | `generateObject` and batch processing -- already in use |
| `convex-helpers` | ^0.1.111 | `defineRateLimits` for new endpoint |

No version bumps required. All APIs used are stable and production-proven in this codebase.

---

## Sources

- Codebase analysis (HIGH confidence):
  - `convex/extraction/workflow.ts` -- proven durable workflow pattern (multi-step, progress tracking, workpool integration)
  - `convex/ai/actions.ts` -- `generateBatchScreeningResponses` action (batch AI screening with credit deduction)
  - `convex/ai/helpers.ts` -- `withUserCreditsBatch` for background job credit handling, `withAuthAndCreditsBatch` for auth-aware batch processing
  - `convex/extraction/workpoolActions.ts` -- credit guard pattern for cancelled jobs (lines 958-973)
  - `convex/workpool.ts` -- workpool configuration (maxParallelism: 3, retry behavior)
  - `convex/workflow.ts` -- workflow manager configuration
  - `convex/library/mutations.ts` -- `saveToLibrary` mutation with upsert and denormalized counter
  - `convex/library/collections.ts` -- `addToCollection` mutation with idempotent assignment and denormalized counter
  - `convex/schema.ts` -- existing table design patterns (index naming, validator patterns, field conventions)
  - `convex/lib/queryBounds.ts` -- bounded query constant pattern
  - `convex/lib/rateLimit.ts` -- rate limiting pattern with `defineRateLimits`
  - `convex/lib/constants.ts` -- plan tiers and credit configuration
  - `convex/convex.config.ts` -- 4 components registered (stripe, rag, workflow, workpool) -- no new components needed
  - `package.json` -- all required dependencies already installed

---

*Stack research for: v4.0 Bulk Screening & Auto-Rating*
*Researched: 2026-03-08*
