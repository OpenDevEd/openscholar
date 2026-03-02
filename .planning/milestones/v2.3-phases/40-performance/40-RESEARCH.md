# Phase 40: Performance - Research

**Researched:** 2026-03-02
**Domain:** Convex query parallelization and unbounded scan capping
**Confidence:** HIGH

## Summary

Phase 40 addresses three performance requirements: resolving N+1 sequential query patterns in two extraction reporting helper functions (`loadJobDataForReporting` in mutations.ts and `loadJobPapersAndResults` in queries.ts), and bounding unbounded `.collect()` calls that could cause Convex transaction limit violations at scale.

Both N+1 functions share the same pattern: they first fetch all papers for a job (correctly using an index), then iterate over each paper in a sequential `for` loop, issuing one or more `await ctx.db.query()` calls per paper. For a 100-paper job, this produces 100-200+ sequential database reads within a single Convex transaction. The fix is to replace the sequential `for` loop with `Promise.all` over all papers, parallelizing the per-paper queries. Convex explicitly supports this pattern -- within a single transaction, multiple `ctx.db.query()` calls issued via `Promise.all` execute concurrently without network round-trip overhead.

For unbounded `.collect()`, the backfill full table scan (`backfillIsIndexed`) was already deleted in Phase 35 (DATA-05). The remaining high-risk unbounded scans are: `cleanupOldPdfs` (line 1369, `extractionPapers` by status+completedAt), `listGrantEligibleSubscriptionPointers` (lines 356-372, three separate `.collect()` calls on subscriptions by status), `expirePastDueSubscriptions` (line 77, subscriptions by status), `listActiveSubscriptions` (line 203, subscriptions by status), and `monitorFailedStripeEvents` (line 130, stripeEventLogs by status). These administrative/maintenance queries scan entire status partitions and should be bounded with `.take(N)` safety caps.

**Primary recommendation:** Use `Promise.all(papers.map(...))` to parallelize per-paper queries in both functions. Add `.take(N)` safety caps to the 5 identified unbounded maintenance/admin `.collect()` calls. Do NOT change reactive UI queries that are already bounded by per-job or per-user indexes.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PERF-01 | N+1 in `loadJobDataForReporting` resolved with `Promise.all` | Function at mutations.ts:40-77 iterates papers sequentially, issuing 2 queries per paper (results + reviews). Replace `for` loop body with `Promise.all(papers.map(...))`. Return type `{ questions, papers, resultsByPaper, reviewsByResult }` must remain identical. |
| PERF-02 | N+1 in `loadJobPapersAndResults` resolved with `Promise.all` | Function at queries.ts:145-170 iterates papers sequentially, issuing 1 query per paper (results) + calling `attachReviewMetadata` which issues another (reviews). Replace `for` loop with `Promise.all(papers.map(...))`. Return type `{ questions, papers, resultsByPaper }` must remain identical. |
| PERF-03 | Unbounded `.collect()` calls bounded with `.take(N)` or pagination | 5 specific unbounded scans identified: `cleanupOldPdfs` (mutations.ts:1369), `listGrantEligibleSubscriptionPointers` (subscriptions/internal.ts:356-372), `expirePastDueSubscriptions` (maintenance/mutations.ts:77), `listActiveSubscriptions` (subscriptions/internal.ts:203), `monitorFailedStripeEvents` (maintenance/mutations.ts:130). Add `.take(N)` caps appropriate to each use case. |
</phase_requirements>

## Standard Stack

### Core

No new libraries are needed. This phase is pure refactoring of existing Convex query patterns.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Convex | (existing) | Backend database queries | Already in use; `Promise.all` with `ctx.db.query` is the documented pattern for parallel reads |

### Supporting

None needed -- no new dependencies.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Promise.all` per-paper queries | Bulk query with `by_job` index on `extractionResults` | Would require adding a `jobId` field + index to `extractionResults` table (schema change). `Promise.all` achieves the same parallelism without schema changes and is the Convex-recommended approach. |
| `.take(N)` safety caps | `.paginate()` cursor-based pagination | Overkill for maintenance cron jobs that process small batches. `.take(N)` is simpler and sufficient for admin queries. |

**Installation:** None needed.

## Architecture Patterns

### Pattern 1: Parallel Per-Entity Queries with Promise.all

**What:** Replace sequential `for...of` loops that `await` a query per entity with `Promise.all(entities.map(async (entity) => ...))`.

**When to use:** When you need to fetch child records for multiple parent records within a single Convex transaction, and each child query uses an indexed lookup.

**Current (PERF-01) -- sequential:**
```typescript
// convex/extraction/mutations.ts:59-74
for (const paper of papers) {
  const [results, reviews] = await Promise.all([
    ctx.db.query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
      .collect(),
    ctx.db.query("extractionResultReviews")
      .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
      .collect(),
  ]);
  resultsByPaper.set(paper._id, results);
  for (const review of reviews) {
    reviewsByResult.set(review.resultId, review);
  }
}
```

**Target -- fully parallel:**
```typescript
await Promise.all(papers.map(async (paper) => {
  const [results, reviews] = await Promise.all([
    ctx.db.query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
      .collect(),
    ctx.db.query("extractionResultReviews")
      .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
      .collect(),
  ]);
  resultsByPaper.set(paper._id, results);
  for (const review of reviews) {
    reviewsByResult.set(review.resultId, review);
  }
}));
```

**Why this works in Convex:** Within a single Convex transaction (mutation or query), all `ctx.db` calls are local to the transaction engine. There is no network round-trip per call. `Promise.all` allows the Convex runtime to schedule all reads concurrently, which is strictly faster than sequential awaits.

### Pattern 2: Safety Cap with .take(N)

**What:** Add `.take(N)` before `.collect()` on queries that scan entire status partitions (not per-user or per-job bounded).

**When to use:** Administrative/maintenance queries that process batches and could grow unbounded.

**Example:**
```typescript
// Before (unbounded)
const pastDueSubs = await ctx.db
  .query("subscriptions")
  .withIndex("by_status", (q) => q.eq("status", "past_due"))
  .collect();

// After (bounded with batch reschedule)
const BATCH_SIZE = 500;
const pastDueSubs = await ctx.db
  .query("subscriptions")
  .withIndex("by_status", (q) => q.eq("status", "past_due"))
  .take(BATCH_SIZE);
```

**Key rule:** Administrative cron/maintenance functions that modify data in a loop should cap their batch size and reschedule if the batch is full. Convex enforces a hard limit of 1024 documents per `.collect()` call -- any query that could exceed this MUST use `.take()`.

### Anti-Patterns to Avoid

- **Changing reactive UI query patterns:** Queries used with `useQuery` in the frontend (e.g., `getJobDashboard`, `getJobMatrix`, `getJobPaperResults`) already use per-job indexes and should NOT be modified. Adding `.take()` to reactive queries changes which documents trigger re-renders, causing stale UI data (Pitfall 12 from project research).
- **Changing return types:** The helper functions `loadJobDataForReporting` and `loadJobPapersAndResults` are internal helpers consumed by multiple callers. Their return type and data shape must remain identical after refactoring.
- **Adding schema changes for this phase:** No new indexes or fields are needed. `Promise.all` parallelization works with existing `by_paper` indexes on `extractionResults` and `extractionResultReviews`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parallel DB reads | Custom batching/chunking logic | `Promise.all(items.map(...))` | Convex transactions are local; Promise.all is the standard pattern |
| Unbounded query safety | Custom cursor pagination for admin queries | `.take(N)` with batch-reschedule | `.take()` is simpler, sufficient for admin batches |

**Key insight:** In Convex's execution model, the parallelization gain from `Promise.all` is primarily about allowing the runtime to schedule reads concurrently rather than reducing network round-trips (there are none within a transaction). The improvement is real but bounded by the transaction's total read budget.

## Common Pitfalls

### Pitfall 1: Promise.all Changes Return Shape

**What goes wrong:** When converting a `for` loop that builds a Map to `Promise.all`, the Map construction happens inside the `.map()` callback. If the callback returns the wrong value or forgets to populate the shared Map, downstream code receives empty data.

**Why it happens:** The `for` loop populates `resultsByPaper` and `reviewsByResult` as side effects. The `Promise.all(papers.map(...))` version must maintain these same side effects within the async callback.

**How to avoid:** Keep the Map variables declared outside `Promise.all`. Inside each `papers.map()` callback, populate the Maps exactly as the original loop body did. Verify the Maps are populated after `Promise.all` resolves.

**Warning signs:** Callers receiving empty Maps or Maps with missing keys after refactoring.

### Pitfall 2: Convex Transaction Read Limits

**What goes wrong:** Parallelizing all per-paper queries means ALL results for ALL papers in the job are read within a single transaction. For very large jobs (500+ papers, 5+ questions each), this could approach Convex's 16 MiB read bandwidth or 8192 document scan limit per query.

**Why it happens:** The sequential version also reads all the same data, just more slowly. Parallelization does not increase total data volume -- it just changes timing. However, Convex's per-transaction limits (16 MiB total reads, 4096 index reads per query) still apply. These limits were already being hit by the sequential version for very large jobs.

**How to avoid:** This phase does not need to solve the large-job scaling problem (that is SCALE-01, a future requirement). The `Promise.all` refactoring does not change the total data volume, only the scheduling. For now, the existing limits are acceptable.

**Warning signs:** Convex throwing "Too many documents read" errors on very large jobs (this would also happen with the sequential version).

### Pitfall 3: .take(N) on Admin Queries Without Reschedule

**What goes wrong:** Adding `.take(500)` to a maintenance function that processes all matching records means only the first 500 are processed per invocation. If there are more than 500, the rest are silently skipped.

**Why it happens:** `.take(N)` returns at most N results. Without a follow-up check (if results.length === N, reschedule), remaining records are never processed.

**How to avoid:** For each `.take(N)` cap, add a reschedule check: if the returned count equals N, schedule another invocation to process the next batch. Some of the identified functions already follow this pattern (e.g., `cleanupDeletedUsers` in maintenance/mutations.ts:48).

**Warning signs:** Maintenance functions processing fewer records than expected; records accumulating in "past_due" or "failed" status despite the cron running.

### Pitfall 4: Touching the Wrong .collect() Calls

**What goes wrong:** The codebase has 90+ `.collect()` calls. Most are safe because they are bounded by per-user or per-job index lookups (e.g., `by_job`, `by_user`, `by_paper`). Changing these to `.take(N)` would return partial data to UI queries.

**Why it happens:** A blanket "fix all .collect()" approach does not distinguish between bounded queries (safe) and unbounded queries (dangerous).

**How to avoid:** Only modify the 5 specific unbounded `.collect()` calls identified in this research. Leave all per-user and per-job bounded `.collect()` calls unchanged.

## Code Examples

### PERF-01: loadJobDataForReporting Refactored

```typescript
// convex/extraction/mutations.ts - loadJobDataForReporting
async function loadJobDataForReporting(
  ctx: MutationCtx,
  jobId: Id<"extractionJobs">
) {
  const [questions, papers] = await Promise.all([
    ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .order("asc")
      .collect(),
    ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect(),
  ]);

  const resultsByPaper = new Map<string, Doc<"extractionResults">[]>();
  const reviewsByResult = new Map<string, Doc<"extractionResultReviews">>();

  // CHANGED: Sequential for-loop replaced with Promise.all
  await Promise.all(papers.map(async (paper) => {
    const [results, reviews] = await Promise.all([
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect(),
      ctx.db
        .query("extractionResultReviews")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect(),
    ]);
    resultsByPaper.set(paper._id, results);
    for (const review of reviews) {
      reviewsByResult.set(review.resultId, review);
    }
  }));

  return { questions, papers, resultsByPaper, reviewsByResult };
}
```

### PERF-02: loadJobPapersAndResults Refactored

```typescript
// convex/extraction/queries.ts - loadJobPapersAndResults
async function loadJobPapersAndResults(ctx: QueryCtx, jobId: Id<"extractionJobs">) {
  const questions = await ctx.db
    .query("extractionQuestions")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .order("asc")
    .collect();

  const papers = await ctx.db
    .query("extractionPapers")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .collect();

  const resultsByPaper = new Map<string, any[]>();

  // CHANGED: Sequential for-loop replaced with Promise.all
  await Promise.all(papers.map(async (paper) => {
    const results = await ctx.db
      .query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
      .collect();
    resultsByPaper.set(
      paper._id,
      await attachReviewMetadata(ctx, paper._id, results)
    );
  }));

  return { questions, papers, resultsByPaper };
}
```

### PERF-03: Unbounded .collect() Caps

**cleanupOldPdfs (mutations.ts:1364-1369):**
```typescript
const CLEANUP_BATCH = 500;
const oldPapers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_status_completedAt", (q) =>
    q.eq("status", "completed").lt("completedAt", cutoffTime)
  )
  .take(CLEANUP_BATCH);
// ... after processing loop:
if (oldPapers.length >= CLEANUP_BATCH) {
  await ctx.scheduler.runAfter(0, internal.extraction.mutations.cleanupOldPdfs, {
    maxAgeHours: args.maxAgeHours,
  });
}
```

**expirePastDueSubscriptions (maintenance/mutations.ts:74-77):**
```typescript
const BATCH_SIZE = 200;
const pastDueSubs = await ctx.db
  .query("subscriptions")
  .withIndex("by_status", (q) => q.eq("status", "past_due"))
  .take(BATCH_SIZE);
```

**listActiveSubscriptions (subscriptions/internal.ts:200-203):**
```typescript
const subs = await ctx.db
  .query("subscriptions")
  .withIndex("by_status", (q) => q.eq("status", "active"))
  .take(1000);
```

**listGrantEligibleSubscriptionPointers (subscriptions/internal.ts:356-372):**
```typescript
const CAP = 1000;
const [active, trialing, pastDue] = await Promise.all([
  ctx.db.query("subscriptions")
    .withIndex("by_status", (q) => q.eq("status", "active"))
    .order("desc").take(CAP),
  ctx.db.query("subscriptions")
    .withIndex("by_status", (q) => q.eq("status", "trialing"))
    .order("desc").take(CAP),
  ctx.db.query("subscriptions")
    .withIndex("by_status", (q) => q.eq("status", "past_due"))
    .order("desc").take(CAP),
]);
```

**monitorFailedStripeEvents (maintenance/mutations.ts:127-130):**
```typescript
const failedEvents = await ctx.db
  .query("stripeEventLogs")
  .withIndex("by_status_next_retry", (q) => q.eq("status", "failed"))
  .take(200);
```

## Specific File Change Map

| File | Function | Change | Lines |
|------|----------|--------|-------|
| `convex/extraction/mutations.ts` | `loadJobDataForReporting` | Replace sequential `for` loop (lines 59-74) with `Promise.all(papers.map(...))` | 40-77 |
| `convex/extraction/queries.ts` | `loadJobPapersAndResults` | Replace sequential `for` loop (lines 158-167) with `Promise.all(papers.map(...))` | 145-170 |
| `convex/extraction/mutations.ts` | `cleanupOldPdfs` | Replace `.collect()` with `.take(500)`, add reschedule check | 1364-1386 |
| `convex/maintenance/mutations.ts` | `expirePastDueSubscriptions` | Replace `.collect()` with `.take(200)` | 74-77 |
| `convex/maintenance/mutations.ts` | `monitorFailedStripeEvents` | Replace `.collect()` with `.take(200)` | 127-130 |
| `convex/subscriptions/internal.ts` | `listActiveSubscriptions` | Replace `.collect()` with `.take(1000)` | 200-203 |
| `convex/subscriptions/internal.ts` | `listGrantEligibleSubscriptionPointers` | Replace three `.collect()` with `.take(1000)` | 356-372 |

## Caller Analysis

### loadJobDataForReporting Callers (mutations.ts)

| Caller | Line | Usage |
|--------|------|-------|
| `createExtractionReportSnapshot` | 738 | Destructures `{ questions, papers, resultsByPaper, reviewsByResult }` |
| `createExtractionRunDiff` | 905-906 | Called twice (current + baseline), destructures same shape |

Both callers use the full return type. No caller is affected by parallelization -- only the internal scheduling changes.

### loadJobPapersAndResults Callers (queries.ts)

| Caller | Line | Usage |
|--------|------|-------|
| `getJobDashboard` | 549 | Destructures `{ questions, papers, resultsByPaper }` |
| `getQuestionInsight` | 704 | Destructures same shape |
| `getQuestionDisagreements` | 799 | Destructures same shape |
| `getReviewQueue` | 905 | Destructures same shape |

All callers destructure the same three fields. No caller is affected by parallelization.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sequential for-loop with awaits | `Promise.all(items.map(...))` | Always been the Convex recommendation | Eliminates artificial serialization of independent reads |
| Unbounded `.collect()` | `.take(N)` with batch reschedule | Convex best practices, enforced by 1024 doc collect limit | Prevents transaction limit violations at scale |

**Deprecated/outdated:**
- The `backfillIsIndexed` full table scan was deleted in Phase 35 (DATA-05). No longer a concern.

## Open Questions

1. **Appropriate cap values for subscription scans**
   - What we know: Current subscription counts are small (likely <100 active). Convex hard-limits `.collect()` at 1024 documents.
   - What's unclear: Growth trajectory of subscription table.
   - Recommendation: Use `.take(1000)` for subscription queries (well under the 1024 hard limit with room for growth) and `.take(200-500)` for maintenance queries that modify data in loops.

2. **cleanupOldPdfs reschedule pattern**
   - What we know: The function currently has no reschedule. Adding `.take(500)` requires a reschedule check.
   - What's unclear: Whether the function's return type `{ cleaned: number }` needs to account for partial batches.
   - Recommendation: Add reschedule but keep `cleaned` counting only the current batch. The cron will invoke it again on the next cycle regardless.

## Sources

### Primary (HIGH confidence)
- `convex/extraction/mutations.ts:40-77` -- Direct code inspection of `loadJobDataForReporting`
- `convex/extraction/queries.ts:145-170` -- Direct code inspection of `loadJobPapersAndResults`
- `convex/extraction/queries.ts:104-129` -- Direct code inspection of `attachReviewMetadata`
- `convex/maintenance/mutations.ts:66-110` -- Direct code inspection of `expirePastDueSubscriptions`
- `convex/maintenance/mutations.ts:120-153` -- Direct code inspection of `monitorFailedStripeEvents`
- `convex/subscriptions/internal.ts:187-218` -- Direct code inspection of `listActiveSubscriptions`
- `convex/subscriptions/internal.ts:342-403` -- Direct code inspection of `listGrantEligibleSubscriptionPointers`
- `convex/extraction/mutations.ts:1355-1386` -- Direct code inspection of `cleanupOldPdfs`
- `convex/schema.ts:386-435` -- Schema and index definitions for `extractionResults`
- `convex/schema.ts:440-463` -- Schema and index definitions for `extractionResultReviews`
- `.planning/research/PITFALLS.md` -- Pitfall 7 (N+1 contract), Pitfall 8 (unbounded collect), Pitfall 12 (reactive semantics)
- `.planning/codebase/CONCERNS.md` -- Performance Bottlenecks section

### Secondary (MEDIUM confidence)
- Convex best practices for `Promise.all` parallelization (referenced in PITFALLS.md, confirmed by code patterns already used in the codebase at `convex/extraction/queries.ts:506`, `convex/library/collections.ts:184`, etc.)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new libraries; pure refactoring of existing patterns
- Architecture: HIGH -- Both N+1 patterns directly inspected; `Promise.all` already used elsewhere in codebase
- Pitfalls: HIGH -- Pitfalls documented in project's own PITFALLS.md research; verified against actual code

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable -- no external dependencies involved)
