# Performance & Optimization Audit — Extraction Pipeline

Scope: `convex/extraction/` (32 files), `convex/schema.ts`, `convex/workflow.ts`, `convex/workpool.ts`, `convex/crons.ts`, and `components/extraction/` client subscriptions.

All findings cite `file:line`. Every violation checked against `convex/_generated/ai/guidelines.md`.

---

## Summary

The extraction pipeline has **two dominant hot-path performance bugs** that dwarf everything else:

1. **Quadratic fan-out on paper completion.** `finalizeJobIfDone` reads every paper in the job on every paper completion (9 call sites). For a 500-paper job: ~250,000 document reads just to close the job.
2. **Reactive query re-computing 500-paper scan on every status change.** `subscribeToJobProgress` (subscribed from the job-detail page) runs `.take(500)` on every status transition — multiplied by every paper moving through 5 states = hundreds of full-table scans per job, pushed to every open tab.

Both are easily fixable: the `extractionJobStats` denormalized counter table already exists and is maintained — it just isn't leveraged in these two hot paths. On top of these, there are **6 separate N+1 query patterns** in the insights/results surface (each loads all papers, then per-paper results via `Promise.all`) and one **triple-nested O(Q·P·R) loop** in `backfillJobStats`. LLM calls per paper are also serialized (one question at a time).

Nothing is currently exceeding Convex's 8192 doc-read limit in the steady-state because `MAX_PAPERS_PER_JOB = 500` bounds everything, but several code paths get within 5–10x of the ceiling and will break when the limit is raised.

---

## Critical

### C1. `finalizeJobIfDone` — quadratic reads per job (mutations.ts:1619–1674)

**File:** `convex/extraction/mutations.ts:1619–1674`

```
const papers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .take(MAX_PAPERS_PER_JOB);   // ≤ 500 paper docs

// ...then JS-counts completedCount / failedCount
```

This mutation is called on **every paper completion and every paper failure** from 9 call sites (`mutations.ts:1924, 1934, 1943, 1979, 1989, 1999, 2008, 2237` and `workflow.ts:211`). Each call reads up to 500 papers just to decide whether the job is finished.

For a 500-paper job: `500 completions × 500 reads = 250,000 doc reads` purely for job-close detection. This runs inside user-facing mutations (paper save) so every paper save is O(N).

**Fix:** Use the already-maintained `extractionJobs.processedPapers` / `extractionJobs.failedPapers` counters (read off the `extractionJobs` row, 1 doc) and `job.totalPapers`. The only reason to scan is to break the tie between `failed == total` and `failed + completed >= total`, and both numbers are already on the job record. `ctx.db.get(jobId)` → compare counters → done in 1 read. No paper fan-out.

Alternative: leverage `extractionJobStats` (already summed per question; sum across questions in a single indexed query) for cross-validation but not required.

### C2. `subscribeToJobProgress` — 500-paper scan on every reactive update (queries.ts:1587–1645)

**File:** `convex/extraction/queries.ts:1587–1645`

```
const allPapers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .take(MAX_PAPERS_PER_JOB);
// ...JS counts 8 statuses, returns .slice(-20)
```

This is a public reactive `query` subscribed from `app/extraction/[jobId]/page.tsx:137–162` and every paper status transition invalidates it. For a 500-paper job processing through 5 statuses (`pending → downloading → indexing → extracting → completed`) = ~2500 invalidations, each of which re-reads all 500 papers and re-serializes them to every connected tab.

Returning `.slice(-20)` is misleading — the server still reads 500 docs and the Convex reactivity system still diffs the full working set.

Violates `guidelines.md`: "avoid .collect/.take with an excessive maximum – use pagination, .first(), or .unique() instead" and "keep queries narrowly scoped to minimise reactive re-execution."

**Fix:** Split this into two queries:
- `subscribeToJobCounters(jobId)` → reads only the `extractionJobs` doc + optionally sums `extractionJobStats` by job. 1–N doc reads where N = question count (≤20).
- `subscribeToRecentPapers(jobId)` → paginates `extractionPapers by_job` with `order("desc").take(20)` (requires a creationTime-ordered read; if UI needs "most recently updated", add an index on `(jobId, updatedAt)`).

This collapses hundreds of thousands of doc-reads/serializations per job into O(1) per transition for the counters and O(20) for the recent list.

### C3. N+1 in `loadJobPapersAndResults` and its 6 callers (queries.ts:219–249 + callers)

**File:** `convex/extraction/queries.ts:219–249`

```
const papers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job", ...)
  .take(MAX_PAPERS_PER_JOB);

await Promise.all(papers.map(async (paper) => {
  const results = await ctx.db
    .query("extractionResults")
    .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
    .collect();   // ← N round-trips
  ...
}));
```

Even with `Promise.all`, this is still N separate index scans (500 paper-results queries per call). It's called from:
- `getJobInsights` (queries.ts:613–842)
- `getQuestionInsights` (queries.ts:844–1004)
- `getQuestionDisagreements` (queries.ts:1006–1130)
- `getReviewQueue` (queries.ts:1132–1291)
- `getJobResults` (queries.ts:481–543, same pattern via sequential for-loop — actually worse)
- `getJobResultsPaginated` (queries.ts:546–611, also fans out per-page)

Several of these are public reactive queries, so they recompute on every evidence/result mutation.

Violates `guidelines.md`: "avoid N+1 queries — batch by parent ID with a secondary index."

**Fix:** Add index `extractionResults.by_job` (or use existing parent reverse lookup). Single call:

```
const results = await ctx.db
  .query("extractionResults")
  .withIndex("by_job", (q) => q.eq("jobId", jobId))
  .collect();
```

Then group by `paperId` in JS. Requires adding `jobId` denormalized on `extractionResults` and indexing it. 1 query replaces 500. Same fix applies to `loadReviewsByJob` (it already does this correctly — use it as the template).

For `getJobInsights` / `getQuestionInsights` / `getQuestionDisagreements`: most of what they compute is already summarised in `extractionJobStats` — use that table instead of recomputing from raw results on every subscription tick.

### C4. `subscribeToJobProgress` + insights queries = reactivity storm per job

**Files:** `components/extraction/insights-overview.tsx` (subscribes `getJobInsights`), `app/extraction/[jobId]/page.tsx:137–162` (subscribes `getJobDetails`, `subscribeToJobProgress`, `getJobResultsPaginated` with `initialNumItems=200`).

While a single user watches a running 500-paper extraction, **every paper status mutation** invalidates all of these simultaneously. Each invalidation re-runs:
- `subscribeToJobProgress` (500-paper scan, C2)
- `getJobResultsPaginated` (200 papers × N+1 per-paper result fetch, C3)
- `getJobInsights` (500 papers × N+1 per-paper result fetch + 500 evidence units per paper = up to 100k reads, C3)

Compound effect: a single status transition can trigger 2500+ docs read on the server per connected client.

**Fix:** Follows from C1/C2/C3 resolution. Additionally: `getJobInsights` should never be subscribed during active extraction — gate the hook so it only runs once the job is `completed`. Use `extractionJobStats` live for anything that needs per-question counts during extraction.

---

## High

### H1. Sequential LLM calls per paper (workpoolActions.ts:918–1191)

**File:** `convex/extraction/workpoolActions.ts:1003`

```
for (const question of args.questions) {
  // ...await extractQuestionAnswerFromAbstract / extractQuestionAnswerFromEvidence
  // one network round trip per question
}
```

With 10 questions per paper, each paper's extraction is 10× as long as it needs to be. The model calls are independent and safe to parallelise.

**Fix:** `await Promise.all(args.questions.map(...))`. Guard with a small semaphore (e.g. 3 concurrent per paper) if you want to stay within per-key provider rate limits. This halves-to-tenths total extraction wall-clock and reduces total time papers occupy a workpool slot (which in turn increases effective throughput given `maxParallelism=3`).

### H2. `backfillJobStats` — triple nested loop O(Q × P × R_per_paper) (mutations.ts:1234–1326)

**File:** `convex/extraction/mutations.ts:1234–1326`

Outer loop `for (const question of questions)` (≤20), middle loop `for (const paper of papers)` (≤500), inner `ctx.db.query("extractionResults").withIndex("by_paper").collect()` on every iteration.

For a worst-case legacy job: `20 × 500 = 10,000` paper-results queries. The same `extractionResults` document is re-fetched once per question. This is O(Q·P) reads; it should be O(P).

**Fix:** Load all results once, build `Map<(paperId, questionKey), result>`:

```
const results = await ctx.db.query("extractionResults")
  .withIndex("by_job", ...).collect(); // after adding by_job index
const byKey = new Map(results.map(r => [`${r.paperId}:${r.questionKey}`, r]));
// then single pass
```

### H3. `getJobResults` sequential fan-out (queries.ts:481–543)

**File:** `convex/extraction/queries.ts:481–543`

Uses a sequential `for (const paper of papers)` — no `Promise.all`, so 500 serial round trips. Even worse than the `loadJobPapersAndResults` pattern.

**Fix:** Same as C3 (single indexed batch by `jobId`).

### H4. `getPapersByOpenAlexIds` reads 500 papers then JS-filters (queries.ts:1454–1468)

**File:** `convex/extraction/queries.ts:1454–1468`

```
const allPapers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job", ...)
  .take(MAX_PAPERS_PER_JOB);
return allPapers.filter(p => openalexIds.includes(p.openalexId));
```

Called from the workflow right after creating paper records; if the workflow inserted 300 papers you re-read all 500 by-job-filter. Schema already has `by_openalex` index.

**Fix:** `Promise.all(openalexIds.map(id => ctx.db.query("extractionPapers").withIndex("by_openalex", q => q.eq("openalexId", id)).unique()))`. O(N) targeted reads instead of a full-job scan with JS filtering.

### H5. `cleanupFailedPaperStorage` — query-builder `.filter` violation (mutations.ts:1203–1227)

**File:** `convex/extraction/mutations.ts:1210`

```
.filter((q) => q.neq(q.field("storageId"), undefined))
```

Uses the forbidden `query-builder .filter` (explicit `guidelines.md` violation). Forces a full by-job index scan that touches every paper, whether or not it has a storageId.

**Fix:** Either (a) keep reading all by-job papers and filter in JS (same work but compliant), or (b) add a composite index `by_job_storageIdPresent` or a boolean field `hasStorage` indexed as `by_job_hasStorage`. Option (b) is the right long-term fix if papers-per-job grows; for now (a) is sufficient and documented.

### H6. Job-level `extractionJobStats` table exists but is not used for live progress

**Files:** `convex/schema.ts` (extractionJobStats with `by_job`, `by_job_question` indexes), `convex/extraction/mutations.ts:2098–2242` (maintains counters on save).

The pattern is correctly implemented — counters are maintained incrementally per question on `saveExtractionResultsAndComplete`. But they are not read by `subscribeToJobProgress`, `finalizeJobIfDone`, or any client subscription. The work of maintaining them is wasted for the live UI.

**Fix:** Wire them up. `subscribeToJobProgress` should read `extractionJobStats by_job` (≤20 docs) and derive paper-level progress from the job's top-level `processedPapers/failedPapers/totalPapers`. Insights and question-level views should hydrate from `extractionJobStats` too.

---

## Medium

### M1. Unbounded inline arrays on `extractionJobs` (schema.ts)

**File:** `convex/schema.ts` — `extractionJobs` table

Inline arrays with no server-side bound:
- `sourceHistoryEntries: v.array(v.object({ historyId, searchFilters }))`
- `sourceZoteroSelection.items: v.array(v.object({ itemKey, title, doi?, year?, abstract?, authors }))` — **contains full abstracts**
- `sourceManualItems: v.array(v.object({ id, title, doi?, year?, abstract?, authors?, pdfUrl?, storageId? }))` — **contains full abstracts and pdfUrl**

Each abstract can be ~2–3KB. At ~300 items, the inline doc crosses half a megabyte before including the other job state. Convex document hard limit is 1MB; array hard limit is 8192. Once the doc trips the limit, **job creation fails at the mutation boundary** and the whole extraction never starts.

Violates `guidelines.md`: "avoid unbounded inline arrays — store child rows in a separate table with a parent-id index."

**Fix:** Move the three source arrays to sibling tables (`extractionJobSources` with `type: "history"|"zotero"|"manual"`, indexed by `jobId`) and load them in the workflow via index scan. Alternative: enforce a server-side cap of 200 items per job and strip abstracts (re-fetch on demand).

### M2. `getJobInsights` computes insights from raw data on every tick (queries.ts:613–842)

**File:** `convex/extraction/queries.ts:613–842`

Even setting aside the N+1 issue (C3), this is a **public reactive query** subscribed during extraction. Every paper completion re-aggregates over up to 500 papers × 5–20 results each.

**Fix:** Move insight computation into a materialised `extractionJobInsights` table updated incrementally (same pattern as `extractionJobStats`). The client subscribes to the materialised view.

### M3. `getQuestionInsights` / `getQuestionDisagreements` load ALL papers for one question (queries.ts:844–1130)

**File:** `convex/extraction/queries.ts:844–1004, 1006–1130`

Both load the full papers list and all results for a job, then filter by `questionKey` in JS. Each question view on the UI re-reads 500 paper docs + 500 results N+1.

**Fix:** Add index `extractionResults.by_job_question` (`jobId, questionKey`). Read results directly for the one question, then join to papers by `paperId`. Or store per-question in `extractionJobStats` — it already has `by_job_question`.

### M4. `getReviewQueue` uses `.filter(...).length` four times (queries.ts:1132–1291)

**File:** `convex/extraction/queries.ts:1132–1291`

```
const pendingCount = items.filter(i => i.reviewState === "pending").length;
const acceptedCount = items.filter(i => i.reviewState === "accepted").length;
// ...×4
```

On top of the N+1 load, then 4 linear scans over the in-memory array. For a completed 500-paper × 20-question job this is 10,000 items × 4 passes.

Violates `guidelines.md`: "use separate indexed counts / denormalised counters rather than `.collect().length` for tallies." (The collect isn't literal here but the semantic is the same.)

**Fix:** Maintain a denormalised counter table `extractionReviewCounters` keyed by `(jobId, reviewState)` updated by the review mutation. One read per counter = 4 doc reads total.

### M5. `enqueuePaperProcessing` calls `finalizeJobIfDone` for non-processable papers (workflow.ts:211)

**File:** `convex/extraction/workflow.ts:211`

In the paper loop, every paper that is skipped (no PDF + no abstract) calls `finalizeJobIfDone` once. If a job has 200 non-processable sources, that's 200 full-paper scans before the first paper is even downloaded.

**Fix:** Either (a) batch the "skip non-processable" pass before the enqueue loop and call `finalizeJobIfDone` once at the end, or (b) delete the call entirely and let the cron / paper-save path handle finalisation.

### M6. Workflow enqueues papers serially (workflow.ts:189–233)

**File:** `convex/extraction/workflow.ts:189–233`

For-loop over 500 papers, each with `await step.runMutation(enqueuePaperProcessing)`. Each round trip is ~10–30ms. For 500 papers that's 5–15s before the workpool even starts processing.

**Fix:** Batch into a single `enqueuePapersProcessing(papers[])` mutation that does the 500 inserts in one transaction (stays under the 8192 write limit). The workpool `enqueue` side can still be called per paper but from inside the single mutation.

### M7. `replacePaperEvidenceUnits` may approach txn write limits (mutations.ts:2244–2287)

**File:** `convex/extraction/mutations.ts:2244–2287`

Deletes up to `MAX_EVIDENCE_UNITS_PER_PAPER = 200` evidence units, then inserts up to 200 new ones. 400 writes per paper in a single transaction is well within Convex's 8192 write limit, but there's also the surrounding `saveExtractionResultsAndComplete` work (results writes + stats upsert + job patch) in adjacent mutations called from the same action chain.

**Fix:** Not urgent, but confirm cumulative writes by running `mcp__convex__logs` on a live extraction and grepping for "doc_writes_exceeded". If close to the limit, split evidence replacement into its own scheduled mutation with `BATCH_SIZE=100` (same pattern as `deleteExtractionInternal`).

---

## Low

### L1. `pdfProcessingPool` parallelism of 3 is extremely conservative (workpool.ts:6–14)

**File:** `convex/workpool.ts:6–14`

Comment: "Reduced to 3 to prevent database conflicts with onComplete handlers." The database conflicts are caused by `finalizeJobIfDone` writing `extractionJobs` from every completion (C1). Once C1 is fixed, parallelism can be raised.

**Fix:** After C1 lands, bump `maxParallelism` to 8–10 for PDF processing to better utilise Convex's execution tier.

### L2. `getJobInsights` reserializes huge object graphs on every subscription tick (queries.ts:613–842)

Even after C3/M2 the return payload is large (papers × results × aggregates). Convex pushes the full validated object to the client on any change.

**Fix:** After denormalising to materialised views, return only the slice the UI renders.

### L3. `getPapersByOpenAlexIds` returns full paper docs (queries.ts:1454–1468)

Callers in the workflow only need `_id`, `pdfUrl`, `storageId`, `abstract`, `title`, `processable`. Returning full docs wastes bytes.

**Fix:** Project only the needed fields. This is primarily a network-bytes issue, not reads, so low priority.

### L4. `loadReviewsByJob` correctly batches but is alone — pattern should propagate

**File:** `convex/extraction/queries.ts` (function referenced from `loadJobPapersAndResults`)

`loadReviewsByJob` demonstrates the correct pattern: one `by_job` index scan, `Map<paperId, review[]>` in memory. Results and evidence units should follow the same pattern.

**Fix:** Not a bug — an opportunity. Generalise this into a shared helper and apply to `extractionResults` and `extractionEvidenceUnits` once the `by_job` indexes are added.

### L5. `backfillJobStats` has no batching / doc-limit guard (mutations.ts:1234–1326)

After H2's fix, the single-pass scan reads at most 500 papers + ~10,000 results + 20 writes = ~10,500 docs. Within 8192 read limit this is tight. Post-fix, add a `BATCH_SIZE` guard that chunks via `scheduler.runAfter` if the total exceeds a safe threshold.

### L6. `cleanupOldPdfs` cron correctly uses scheduler chaining (mutations.ts:1578–1616)

No finding — cited here as a positive example. It uses `scheduler.runAfter(0, ...)` when a full batch is fetched. The deletion cascade in `deleteExtractionInternal` (mutations.ts:1058–1201) does the same with `BATCH_SIZE=100` across 9 steps. Propagate this pattern to other bulk ops (M6).

---

## Index gap table

All `withIndex` call sites in `convex/extraction/` were cross-referenced against `convex/schema.ts`. Every explicit index reference maps to an existing schema index — no unknown-index runtime errors. The gaps below are *missing* indexes that would enable fixes for the findings above.

| Table | Proposed Index | Fields | Why | Blocks finding |
|---|---|---|---|---|
| `extractionResults` | `by_job` | `jobId` | Batch-load all results for a job; eliminates N+1 in 6 queries | C3, H2, H3, L4 |
| `extractionResults` | `by_job_question` | `jobId, questionKey` | Per-question result scan for question insights / disagreements | M3 |
| `extractionEvidenceUnits` | `by_job` | `jobId` | Batch-load all evidence for a job's insights | C3, L4 |
| `extractionPapers` | `by_job_updatedAt` | `jobId, updatedAt` | Ordered "recent papers" pagination for live progress | C2 |
| `extractionPapers` | `by_job_hasStorage` | `jobId, hasStorage` (new bool) | Remove `.filter((q) => q.neq(...))` in cleanup | H5 |
| `extractionReviewCounters` | `by_job_state` | `jobId, reviewState` (**new table**) | O(4) counter reads instead of 10k-row JS tally | M4 |
| `extractionJobInsights` | `by_job` | `jobId` (**new table**) | Materialised insight aggregates | M2 |

To add `extractionResults.jobId` retroactively: schema migration + a one-shot backfill action. The existing `extractionJobs` → `extractionPapers` → `extractionResults` chain is traversable, and `extractionQuestions.jobId` + `extractionResults.paperId` + `extractionPapers.jobId` give you everything you need for the migration script.

---

## Positive patterns observed

- `deleteExtractionInternal` (mutations.ts:1058–1201) is exemplary: 9-step batched cascade via `scheduler.runAfter` with `BATCH_SIZE=100`. Stays well under Convex limits.
- `loadReviewsByJob` (referenced from queries.ts:233) correctly batches by `jobId` — this is the pattern C3 should adopt.
- `extractionJobStats` (schema.ts) is maintained incrementally on `saveExtractionResultsAndComplete` (mutations.ts:2098–2242). Correct denormalisation pattern — just needs wiring to subscribers.
- `crons.ts` `cleanupOldPdfs` uses scheduler self-re-enqueue for batching.
- `MAX_PAPERS_PER_JOB`, `MAX_EVIDENCE_UNITS_PER_PAPER`, `MAX_REVIEWS_PER_JOB` bounds in `convex/lib/queryBounds.ts` — single source of truth for query caps.
- Chunking constants in `convex/extraction/chunking.ts` (TARGET=700, MAX=900, OVERLAP=120) and evidence unit sizing (MIN=120, MAX=360) are reasonable and well-tuned.

---

## Recommended fix order (highest leverage first)

1. **C1** — remove paper-scan from `finalizeJobIfDone`; read counters off the job doc.
2. **C2** — split `subscribeToJobProgress` into counters-only + paginated-recent-papers.
3. **H6** — wire `extractionJobStats` into live subscribers; makes C2 trivial.
4. **C3** — add `extractionResults.by_job` index + batch-load helper; kills 6 N+1s in one change.
5. **H1** — parallelise per-question LLM calls.
6. **M1** — migrate source arrays off the job document before a 500-paper Zotero import trips the 1MB limit in production.

All other findings are incremental improvements once the quadratic hot paths are gone.
