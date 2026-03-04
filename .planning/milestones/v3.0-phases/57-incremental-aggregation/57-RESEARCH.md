# Phase 57: Incremental Aggregation - Research

**Researched:** 2026-03-04
**Domain:** Convex database schema design, incremental aggregation pattern, extraction pipeline optimization
**Confidence:** HIGH

## Summary

Phase 57 addresses the core performance bottleneck in extraction report generation: every report query (`getJobInsights`, `getQuestionInsights`, `getQuestionDisagreements`, `getReviewQueue`, and the `createExtractionReportSnapshot` mutation) calls `loadJobPapersAndResults` or `loadJobDataForReporting`, which fans out across all papers (up to 500) loading every `extractionResult` and `extractionResultReview` record per paper. For 500 papers x 10 questions, this is 5,000+ result documents loaded into a single query/mutation context.

The solution is a new `extractionJobStats` table that stores per-question aggregation counters, upserted incrementally as each paper completes in the workpool. Report queries then read from pre-aggregated stats (O(questions)) instead of fan-out (O(papers x questions)). Existing completed jobs that lack stats rows fall back to a lazy backfill: the first report request computes stats from the full fan-out, persists them, and subsequent requests read from the pre-computed rows.

**Primary recommendation:** Add `extractionJobStats` table, upsert stats in `saveExtractionResultsAndComplete`, modify report queries to read from stats first with fan-out fallback, and add cascade delete step for the new table.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PERF-02 | Implement incremental extraction report aggregation with `extractionJobStats` table, upsert on paper completion, lazy fallback for existing jobs | New table schema, upsert in `saveExtractionResultsAndComplete` mutation (line 1942), backfill path on first read, cascade delete inclusion |
| PERF-06 | Optimize extraction report queries to avoid loading 500 papers x N results in a single mutation context | Modified `getJobInsights` (queries.ts:597), `getQuestionInsights` (queries.ts:797), `createExtractionReportSnapshot` (mutations.ts:775) to read from `extractionJobStats` instead of full fan-out |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Convex | current | Database, mutations, queries | Already in use; OCC guarantees atomic upserts without external locking |
| convex-test | current | Unit tests with in-memory DB | Already in use for extraction tests (cascade-delete.test.ts) |

### Supporting

No new libraries required. The existing `lib/extraction/insights.ts` aggregation functions (`aggregateQuestionInsights`, `buildDisagreementClusters`, `buildArrayAnswerProfileClusters`) are reused for the lazy backfill path.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Simple upsert table | `@convex-dev/aggregate` component | Component adds a dependency and complexity; simple upsert table is sufficient for per-question counters since the question count per job is small (typically 5-15) |
| Per-question stats rows | Single denormalized stats document per job | Single-document approach creates write contention when papers complete concurrently; per-question rows allow independent upserts with no OCC conflicts |

## Architecture Patterns

### Recommended Project Structure

No new directories. Changes are confined to existing files:

```
convex/
  schema.ts                          # ADD extractionJobStats table
  extraction/
    mutations.ts                     # MODIFY saveExtractionResultsAndComplete, cascade delete, report snapshot
    queries.ts                       # MODIFY getJobInsights, getQuestionInsights, getQuestionDisagreements, getReviewQueue
```

### Pattern 1: Incremental Upsert on Paper Completion

**What:** After each paper's extraction results are saved in `saveExtractionResultsAndComplete`, upsert `extractionJobStats` rows for each question's result.

**When to use:** Every time `saveExtractionResultsAndComplete` is called (on workpool paper completion).

**Key insertion point:** `convex/extraction/mutations.ts` line 1989 (inside `saveExtractionResultsAndComplete.handler`), after the existing result-insert loop and before `finalizeJobIfDone`.

**Design:**
```typescript
// After inserting each extractionResult in saveExtractionResultsAndComplete:
for (const result of args.results.filter(Boolean)) {
  // ... existing insert ...

  // Upsert job stats for this question
  const existingStat = await ctx.db
    .query("extractionJobStats")
    .withIndex("by_job_question", (q) =>
      q.eq("jobId", paper.jobId).eq("questionKey", result.questionKey))
    .unique();

  const isAnswered = result.answer !== null && result.answer !== undefined;
  const isGrounded = result.citationStatus === "grounded";
  const isBestEffort = result.citationStatus === "best_effort";
  const isInsufficient = result.citationStatus === "insufficient_evidence";
  const isError = result.citationStatus === "extraction_error";
  const conf = typeof result.confidence === "number" ? result.confidence : 0;

  if (existingStat) {
    await ctx.db.patch(existingStat._id, {
      totalAnswered: existingStat.totalAnswered + (isAnswered ? 1 : 0),
      groundedCount: existingStat.groundedCount + (isGrounded ? 1 : 0),
      bestEffortCount: existingStat.bestEffortCount + (isBestEffort ? 1 : 0),
      insufficientEvidenceCount: existingStat.insufficientEvidenceCount + (isInsufficient ? 1 : 0),
      extractionErrorCount: existingStat.extractionErrorCount + (isError ? 1 : 0),
      confidenceSum: existingStat.confidenceSum + conf,
      confidenceCount: existingStat.confidenceCount + (typeof result.confidence === "number" ? 1 : 0),
      totalPapers: existingStat.totalPapers + 1,
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert("extractionJobStats", {
      jobId: paper.jobId,
      questionKey: result.questionKey,
      totalPapers: 1,
      totalAnswered: isAnswered ? 1 : 0,
      groundedCount: isGrounded ? 1 : 0,
      bestEffortCount: isBestEffort ? 1 : 0,
      insufficientEvidenceCount: isInsufficient ? 1 : 0,
      extractionErrorCount: isError ? 1 : 0,
      confidenceSum: conf,
      confidenceCount: typeof result.confidence === "number" ? 1 : 0,
      updatedAt: Date.now(),
    });
  }
}
```

**Why per-question rows:** Each paper completes independently via the workpool (maxParallelism: 3). Papers may complete concurrently. Per-question rows minimize OCC conflict probability: two papers completing simultaneously only conflict if they update the *same* questionKey stat row, which they will -- but Convex OCC retries automatically resolve this. A single monolithic stats document would conflict on *every* concurrent paper completion.

### Pattern 2: Fast-Path Read for Report Queries

**What:** Report queries check for pre-aggregated stats first. If stats exist, use them directly. If not (legacy jobs), fall back to the existing fan-out approach and backfill.

**When to use:** In `getJobInsights`, `getQuestionInsights`, `getQuestionDisagreements`, and `createExtractionReportSnapshot`.

**Design:**
```typescript
// In getJobInsights query:
const stats = await ctx.db
  .query("extractionJobStats")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .collect();

if (stats.length > 0) {
  // Fast path: read from pre-aggregated stats
  // Build response from stats rows without loading papers/results
} else {
  // Fallback: existing loadJobPapersAndResults fan-out
  // Optionally trigger backfill via scheduler
}
```

### Pattern 3: Lazy Backfill for Legacy Jobs

**What:** When a report is requested for a completed job without stats, compute stats from the full fan-out and persist them so subsequent requests use the fast path.

**When to use:** First report access for pre-existing completed jobs.

**Design decisions:**
- Backfill happens inside a mutation (not action) because it needs to write to the DB
- The backfill is idempotent: if stats already exist, skip
- The first request still does the full fan-out (same latency as current behavior) but writes the stats
- All subsequent requests hit the fast path

### Pattern 4: Stats Scope and Limitations

**What the stats table covers vs. what still needs fan-out.**

The `extractionJobStats` table stores per-question *scalar* aggregation counters (counts, sums) that are sufficient for:
- `getJobInsights` summary section (answeredTotal, groundedTotal, avgConfidence, rates)
- Per-question aggregate stats (total, answered, grounded, avgConfidence, confidenceBuckets, citationStatusMix)

The stats table does NOT store:
- `topAnswers` (answer distribution) -- requires knowing individual answer values
- `entityDistribution` -- requires parsing array answers
- `disagreementClusters` -- requires grouping by normalized answers
- `reviewState` breakdown (accepted/rejected/needs_followup) -- reviews happen after extraction, not at paper completion time
- `noContentPapers` diagnostic list -- requires per-paper metadata
- `abstractOnlyCount` -- requires per-paper PDF usage flags

**Consequence:** The `getJobInsights` query summary section can use the fast path (scalar counters only). The per-question detail sections (`topAnswers`, `entityDistribution`, `disagreementClusters`, review breakdown) still need the fan-out OR a richer stats structure.

**Recommended approach:** Store enough in stats for the summary-level aggregation (PERF-06 core win). For the detail sections that need answer-level distribution, keep the fan-out but scope it to *one question at a time* in `getQuestionInsights` (which already takes a `questionKey` arg), avoiding the full N-question fan-out. The `createExtractionReportSnapshot` mutation is the hardest case -- it builds per-question insights for ALL questions. For this, use stats for summary metrics and still fan out for the rich detail sections but acknowledge the mutation context is bounded by `MAX_PAPERS_PER_JOB = 500`.

### Anti-Patterns to Avoid

- **Storing topAnswers in the stats table:** Answer distribution requires knowing every individual answer value, which changes the stats table from simple counters to a complex nested structure. Keep it simple; counters for summary, fan-out for distribution.
- **Backfilling in a query:** Queries in Convex are read-only. Backfill must happen in a mutation. Use `ctx.scheduler.runAfter` to trigger an async backfill mutation from the query if stats are missing, and return the fan-out result for the current request.
- **Removing the 500-paper cap in this phase:** The requirements document explicitly states the cap lift is deferred to v3.1. This phase enables it but must not remove it.
- **Forgetting cascade delete:** The `deleteExtractionInternal` mutation must include a new step to delete `extractionJobStats` rows for the job.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Concurrent upsert safety | Custom locking mechanism | Convex OCC (automatic retries) | Convex mutations are atomic; OCC handles concurrent paper completions writing to the same stats row |
| Complex aggregation library | Custom MapReduce framework | Simple upsert + existing `aggregateQuestionInsights` for backfill | The aggregation logic already exists in `lib/extraction/insights.ts`; reuse it for backfill |

**Key insight:** The `aggregateQuestionInsights` function in `lib/extraction/insights.ts` already computes the full insight aggregate from `InsightEntry[]`. For the backfill path, reuse this function directly and extract the scalar counters from its output to populate stats rows.

## Common Pitfalls

### Pitfall 1: OCC Contention Under High Parallelism

**What goes wrong:** With `maxParallelism: 3` in the workpool, three papers can complete simultaneously. Each triggers `saveExtractionResultsAndComplete`, which upserts stats rows. If all three papers have the same question keys, the three mutations contend on the same stats rows.

**Why it happens:** Convex OCC retries the entire mutation on conflict, including the result inserts and the stats upserts.

**How to avoid:** This is expected behavior and Convex OCC handles it correctly. With maxParallelism=3, the retry overhead is minimal. No special handling needed. Document that stats upserts are safe under OCC.

**Warning signs:** Excessive mutation retries in Convex dashboard logs. Monitor after deployment.

### Pitfall 2: Stale Stats After Review Changes

**What goes wrong:** A user reviews an extraction result (accepted/rejected/corrected answer) after the job completes. The stats were computed at extraction time and do not reflect review corrections.

**Why it happens:** Stats are upserted when `saveExtractionResultsAndComplete` runs, but `setResultReviewState` does not update stats.

**How to avoid:** This is by design. The stats table stores extraction-time aggregation (confidence, citation status, answered counts). Review state is a post-hoc overlay. Report queries that include review breakdown (accepted/rejected counts) must still query reviews. The stats optimization targets the extraction-time scalar counters. Document this limitation clearly.

**Warning signs:** Users expect review changes to immediately update summary stats. The fast-path stats will be accurate for extraction-time metrics but not for review-adjusted metrics.

### Pitfall 3: Backfill Race Condition

**What goes wrong:** Two concurrent requests for insights on a legacy job both detect missing stats and both trigger backfill. The second backfill overwrites the first with potentially slightly different data (if a review changed between the two runs).

**Why it happens:** No locking on the backfill path.

**How to avoid:** Make backfill idempotent: check if stats already exist before writing. The first backfill writes rows; the second detects existing rows and skips. Use a flag on the job record (`statsBackfilled: boolean`) to avoid repeated fan-out on every request.

**Warning signs:** Duplicate stats rows for the same job+question combination. The `by_job_question` unique index prevents this at the database level.

### Pitfall 4: Missing Cascade Delete Step

**What goes wrong:** `extractionJobStats` rows become orphaned when a job is deleted because `deleteExtractionInternal` does not include a step for the new table.

**Why it happens:** Developer adds the table to the schema but forgets to update the cascade delete mutation.

**How to avoid:** Add a cascade delete step in `deleteExtractionInternal` (mutations.ts, between step 7 and step 8) that queries and deletes `extractionJobStats` by `jobId` index. Also update the `cascade-delete.test.ts` to seed and verify stats row deletion.

### Pitfall 5: Schema Deployment Ordering

**What goes wrong:** Deploying mutations that reference `extractionJobStats` before the schema is deployed causes runtime errors.

**Why it happens:** Convex schema deploys atomically with code, so this is actually not a risk with `npx convex deploy`. However, if code is split across multiple deploys (e.g., schema first, then mutations), references to the new table in queries/mutations will fail.

**How to avoid:** Deploy schema and code changes together in a single `npx convex deploy`. This is the standard Convex pattern.

## Code Examples

### Schema Definition for extractionJobStats

```typescript
// convex/schema.ts -- new table between extractionReportSnapshots and extractionRunDiffs
extractionJobStats: defineTable({
  jobId: v.id("extractionJobs"),
  questionKey: v.string(),

  // Running scalar counters
  totalPapers: v.number(),        // Papers processed for this question
  totalAnswered: v.number(),      // Papers with non-null answer
  groundedCount: v.number(),      // citationStatus === "grounded"
  bestEffortCount: v.number(),    // citationStatus === "best_effort"
  insufficientEvidenceCount: v.number(), // citationStatus === "insufficient_evidence"
  extractionErrorCount: v.number(),      // citationStatus === "extraction_error"

  // Running confidence aggregation
  confidenceSum: v.number(),      // Sum of all confidence values (for computing average)
  confidenceCount: v.number(),    // Count of papers with a numeric confidence value

  // Confidence bucket counts
  highConfidenceCount: v.number(),    // confidence >= 0.8
  mediumConfidenceCount: v.number(),  // 0.5 <= confidence < 0.8
  lowConfidenceCount: v.number(),     // confidence < 0.5
  unknownConfidenceCount: v.number(), // confidence is null/undefined

  updatedAt: v.number(),
})
  .index("by_job", ["jobId"])
  .index("by_job_question", ["jobId", "questionKey"]),
```

### Upsert in saveExtractionResultsAndComplete

```typescript
// Inside saveExtractionResultsAndComplete handler, after the result insert loop:
const paper = await ctx.db.get(args.paperId);
if (!paper) return;

for (const result of args.results.filter(Boolean)) {
  const existingStat = await ctx.db
    .query("extractionJobStats")
    .withIndex("by_job_question", (q) =>
      q.eq("jobId", paper.jobId).eq("questionKey", result.questionKey))
    .unique();

  const isAnswered = result.answer !== null && result.answer !== undefined;
  const conf = typeof result.confidence === "number" ? result.confidence : undefined;
  const confBucket = conf === undefined ? "unknown"
    : conf >= 0.8 ? "high"
    : conf >= 0.5 ? "medium"
    : "low";

  const delta = {
    totalPapers: 1,
    totalAnswered: isAnswered ? 1 : 0,
    groundedCount: result.citationStatus === "grounded" ? 1 : 0,
    bestEffortCount: result.citationStatus === "best_effort" ? 1 : 0,
    insufficientEvidenceCount: result.citationStatus === "insufficient_evidence" ? 1 : 0,
    extractionErrorCount: result.citationStatus === "extraction_error" ? 1 : 0,
    confidenceSum: conf ?? 0,
    confidenceCount: conf !== undefined ? 1 : 0,
    highConfidenceCount: confBucket === "high" ? 1 : 0,
    mediumConfidenceCount: confBucket === "medium" ? 1 : 0,
    lowConfidenceCount: confBucket === "low" ? 1 : 0,
    unknownConfidenceCount: confBucket === "unknown" ? 1 : 0,
  };

  if (existingStat) {
    await ctx.db.patch(existingStat._id, {
      totalPapers: existingStat.totalPapers + delta.totalPapers,
      totalAnswered: existingStat.totalAnswered + delta.totalAnswered,
      groundedCount: existingStat.groundedCount + delta.groundedCount,
      bestEffortCount: existingStat.bestEffortCount + delta.bestEffortCount,
      insufficientEvidenceCount: existingStat.insufficientEvidenceCount + delta.insufficientEvidenceCount,
      extractionErrorCount: existingStat.extractionErrorCount + delta.extractionErrorCount,
      confidenceSum: existingStat.confidenceSum + delta.confidenceSum,
      confidenceCount: existingStat.confidenceCount + delta.confidenceCount,
      highConfidenceCount: existingStat.highConfidenceCount + delta.highConfidenceCount,
      mediumConfidenceCount: existingStat.mediumConfidenceCount + delta.mediumConfidenceCount,
      lowConfidenceCount: existingStat.lowConfidenceCount + delta.lowConfidenceCount,
      unknownConfidenceCount: existingStat.unknownConfidenceCount + delta.unknownConfidenceCount,
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert("extractionJobStats", {
      jobId: paper.jobId,
      questionKey: result.questionKey,
      ...delta,
      updatedAt: Date.now(),
    });
  }
}
```

### Fast-Path Read in getJobInsights

```typescript
// At the top of getJobInsights handler:
const stats = await ctx.db
  .query("extractionJobStats")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .collect();

const questions = await ctx.db
  .query("extractionQuestions")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .order("asc")
  .collect();

if (stats.length > 0 && stats.length === questions.length) {
  // Fast path: build summary from pre-aggregated stats
  const statByQuestion = new Map(stats.map(s => [s.questionKey, s]));

  let answeredTotal = 0;
  let groundedTotal = 0;
  let bestEffortTotal = 0;
  let confidenceSumTotal = 0;
  let confidenceCountTotal = 0;

  const questionInsights = questions.map(question => {
    const stat = statByQuestion.get(question.key);
    if (!stat) { /* ... fallback ... */ }
    answeredTotal += stat.totalAnswered;
    groundedTotal += stat.groundedCount;
    bestEffortTotal += stat.bestEffortCount;
    confidenceSumTotal += stat.confidenceSum;
    confidenceCountTotal += stat.confidenceCount;

    return {
      key: question.key,
      question: question.question,
      type: question.type,
      description: question.description,
      total: stat.totalPapers,
      answered: stat.totalAnswered,
      grounded: stat.groundedCount,
      avgConfidence: stat.confidenceCount > 0 ? stat.confidenceSum / stat.confidenceCount : 0,
      // ... build remaining fields from stat counters
    };
  });

  // Build summary from totals
  // ... return ok({ job, summary, questions: questionInsights, diagnostics })
}

// Fallback: existing loadJobPapersAndResults fan-out (unchanged current behavior)
```

### Cascade Delete Step

```typescript
// In deleteExtractionInternal, add after Step 7 (extractionReportSnapshots):

// Step 7b: Delete extractionJobStats
const jobStats = await ctx.db
  .query("extractionJobStats")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .take(BATCH_SIZE);
if (jobStats.length > 0) {
  for (const s of jobStats) await ctx.db.delete(s._id);
  await ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId });
  return null;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full fan-out on every report request | Pre-aggregated stats with lazy backfill | Phase 57 (this phase) | Report summary queries become O(questions) instead of O(papers x questions) |
| N+1 sequential paper queries | Promise.all parallel queries | Phase 40 (v2.3) | Fixed sequential overhead but not total document count |
| Unbounded .collect() | .take(MAX_PAPERS_PER_JOB) | Phase 51 (v2.5) | Bounded memory but still loads all 500 x N result documents |

## Open Questions

1. **Should `getQuestionInsights` use stats or fan-out?**
   - What we know: `getQuestionInsights` takes a single `questionKey` and builds answer distribution, disagreement clusters, and entity profiles. Stats counters alone cannot provide these -- they need individual answer values.
   - What's unclear: Is the per-question fan-out (500 results for one question) acceptable, or should we also store answer distribution in the stats table?
   - Recommendation: Keep per-question fan-out for `getQuestionInsights` (500 documents is manageable for one question). Only optimize the all-questions summary path (`getJobInsights`). This keeps the stats table simple and the implementation focused.

2. **Should `createExtractionReportSnapshot` use stats?**
   - What we know: This mutation builds rich per-question insights (including topAnswers, disagreements) for ALL questions. It calls `loadJobDataForReporting` which loads all papers + results + reviews.
   - What's unclear: Whether the stats fast path is sufficient for the report snapshot, or whether the full fan-out is still needed for the rich sections.
   - Recommendation: Use stats for the `metrics` section of the snapshot (totalPapers, answeredRate, groundedRate, bestEffortRate). Keep the fan-out for the `sections` array (key findings, disagreements, evidence highlights) which require individual answer values. This is an incremental win -- the metrics no longer need the full fan-out. The sections still do, but report snapshots are generated on-demand (user-triggered), not on every page load.

3. **Should review changes invalidate stats?**
   - What we know: Stats are computed at extraction time. Reviews happen post-extraction and can change the "effective" answer (correctedAnswer).
   - What's unclear: Whether users expect summary stats to reflect review corrections.
   - Recommendation: Do NOT invalidate stats on review changes. The stats represent extraction-quality metrics (confidence, citation status). Review state is a separate overlay. The `reviewed` breakdown (accepted/rejected counts) is already computed from the `extractionResultReviews` table, not from stats. Document this design decision.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `convex/extraction/mutations.ts` -- `loadJobDataForReporting` (line 48-85), `saveExtractionResultsAndComplete` (line 1942-2030), `deleteExtractionInternal` (line 1022-1151), `createExtractionReportSnapshot` (line 775-930)
- Codebase analysis: `convex/extraction/queries.ts` -- `loadJobPapersAndResults` (line 214-242), `getJobInsights` (line 597-795), `getQuestionInsights` (line 797-956)
- Codebase analysis: `lib/extraction/insights.ts` -- `aggregateQuestionInsights` (line 287-423), type definitions
- Codebase analysis: `convex/schema.ts` -- extraction table definitions (line 216-655)
- Codebase analysis: `convex/workpool.ts` -- maxParallelism: 3 configuration
- `.planning/research/ARCHITECTURE.md` -- prior research on incremental aggregation pattern (line 260-333, 880-966)

### Secondary (MEDIUM confidence)
- `.planning/research/SUMMARY.md` -- notes on avoidance patterns for upsert atomicity and cascade delete
- `.planning/REQUIREMENTS.md` -- PERF-02 and PERF-06 definitions, out-of-scope section confirming 500-paper cap lift deferred to v3.1

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies; uses existing Convex patterns
- Architecture: HIGH - upsert pattern is well-established; prior architecture research already validated this approach; all integration points verified in codebase
- Pitfalls: HIGH - OCC behavior, cascade delete, and backfill race conditions are well-understood Convex patterns

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable domain, no external dependency version sensitivity)
