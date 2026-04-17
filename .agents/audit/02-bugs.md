# Bug Audit — Extraction Process

Scope: `convex/extraction/` (32 files, ~9,600 lines), plus touchpoints in `convex/crons.ts`, `convex/workpool.ts`, `convex/_generated/ai/guidelines.md`, and `convex/schema.ts`.
Method: read every file under `convex/extraction/`, traced each workpool onComplete handler and workflow step against the actual state machine defined in `schema.ts`.
Every finding cites file:line from the HEAD of `dev` as of 2026-04-17.

---

## Summary

The extraction pipeline has two classes of serious defects:

1. **Cancellation is not respected by onComplete handlers.** After a user clicks cancel, in-flight workpool items continue to write paper/job status without guarding against `job.status === "cancelled"`. The terminal mutations (`finalizeJob`, `finalizeJobIfDone`) unconditionally `patch({status: "completed" | "failed"})`, so a late callback flips "cancelled" back to a success/failure terminal state and re-writes `completedAt`. The credit guard in `waitAndExtractAction` protects billing but returns `success: true, results: []`, which the completion handler happily saves and finalizes — guaranteeing this status flip on every cancelled run that had at least one in-flight extraction.
2. **`handleExtractionComplete` calls `finalizeJobIfDone` twice per paper.** Once transitively via `saveExtractionResultsAndComplete` (line 2237–2239), then again directly (line 1979–1981). Under contention this can also race with other papers' completions.

Secondary issues: `cancelExtraction` calls `pdfProcessingPool.cancelAll(ctx)` which cancels *every* user's pending work in that pool; `createPaperRecords` silently drops papers when the PDF flag is off, so `job.totalPapers` (set by the workflow to the pre-insert count) does not match the papers that exist; `cleanupOldPdfs` is defined but never registered in `crons.ts`; two `internal` functions in `mutations.ts` (`handlePaperFetchComplete`, `getUserIdFromJob`) are dead code. Test-only internal actions bypass auth/feature-flag/rate-limit gates and are callable from the Convex dashboard.

---

## Critical

### C1. Cancelled jobs get silently overwritten to `completed`/`failed`
**File:line**
- `convex/extraction/mutations.ts:1619-1674` (`finalizeJobIfDone`)
- `convex/extraction/mutations.ts:1536-1575` (`finalizeJob`)
- `convex/extraction/workpoolActions.ts:978-988` (credit guard returning empty success on cancelled job)
- `convex/extraction/mutations.ts:1969-1981` (`handleExtractionComplete` success branch)

**Symptom**
User clicks cancel → `extractionJobs.status` briefly becomes `"cancelled"` → a few seconds later a workpool onComplete fires for an in-flight paper → job status flips to `"completed"` or `"failed"` and `completedAt` is overwritten. All UI and history views believe the job ran to completion.

**Root cause**
`finalizeJobIfDone` reads the job (`ctx.db.get` at 1625), but *never* compares `job.status` to `"cancelled"` before patching. Both the "all processable failed" branch (1636–1645) and the normal terminal branch (1662–1671) unconditionally `db.patch({ status, …, completedAt: Date.now() })`. `finalizeJob` has the same bug (1559–1572). Callers in `handleDownloadAndIndexComplete` (1924, 1934, 1943), `handleExtractionComplete` (1979, 1989, 1999, 2008), and `saveExtractionResultsAndComplete` (2237) all invoke finalize regardless of job state.

Downstream, the credit guard in `waitAndExtractAction` at `workpoolActions.ts:973-988` returns `{ success: true, results: [] }` when the job is cancelled. The onComplete branch at `mutations.ts:1969` treats `data.success && data.results` as truthy (`[]` is truthy), so it calls `saveExtractionResultsAndComplete` with 0 results → paper is patched to `status: "completed"` at 2163–2167 → `finalizeJobIfDone` is triggered → status flip.

**Repro**
1. Start an extraction job with ≥ 2 processable papers.
2. As soon as the first `downloadAndIndexPdfAction` succeeds and `waitAndExtractAction` is enqueued, click Cancel in the UI.
3. The cancel mutation patches job to `"cancelled"` and calls `pdfProcessingPool.cancelAll`.
4. Any in-flight `waitAndExtractAction` that has already started reading `units` proceeds to its credit guard, returns empty success, and triggers the save+finalize chain.
5. Query `extractionJobs` — status is now `"completed"` (or `"failed"` if all papers failed); `cancelledAt` is absent from schema so cancellation is effectively erased.

**Fix**
- In `finalizeJobIfDone` and `finalizeJob`, early-return when `job.status === "cancelled"`:
  ```ts
  if (job.status === "cancelled") return null;
  ```
- In every `pdfProcessingPool.defineOnComplete` handler (`handleDownloadAndIndexComplete`, `handleExtractionComplete`), fetch `job` first and skip the terminal patch + re-enqueue when `job.status === "cancelled"`. For the download-success branch (1883–1915) this means *not* enqueueing `waitAndExtractAction` when the job is already cancelled.
- In the `waitAndExtractAction` credit-guard cancelled branch (`workpoolActions.ts:978-988`), return `{ success: false, error: "job_cancelled" }` instead of `success: true, results: []` so the onComplete handler does not write a `"completed"` paper row.

---

### C2. `handleExtractionComplete` double-finalizes
**File:line** `convex/extraction/mutations.ts:1969-1982` (direct call) and `convex/extraction/mutations.ts:2237-2239` (transitive call inside `saveExtractionResultsAndComplete`).

**Symptom**
`finalizeJobIfDone` runs twice back-to-back for every successful paper. Each call scans all papers (`MAX_PAPERS_PER_JOB` take) and writes a patch to `extractionJobs`. Under contention with another paper's onComplete firing, the two runs can produce different `processedPapers` counts because they do not share a snapshot — the second patch clobbers the first. For cancelled jobs this doubles the chance of the C1 race.

**Root cause**
`saveExtractionResultsAndComplete` already calls `finalizeJobIfDone` at line 2237-2239. `handleExtractionComplete` then calls it again at line 1979-1981.

**Repro**
Any successful paper. Add `console.log` in `finalizeJobIfDone` — it prints twice per paper.

**Fix**
Remove the direct `finalizeJobIfDone` call at `mutations.ts:1979-1981`. Keep the transitive one inside `saveExtractionResultsAndComplete`.

---

### C3. `cancelExtraction` cancels every user's workpool items
**File:line** `convex/extraction/mutations.ts:278-282`

**Symptom**
User A cancels job A → `pdfProcessingPool.cancelAll(ctx)` is called → pending items for jobs belonging to users B, C, … that happen to share the `pdfProcessingPool` (maxParallelism = 3, so the queue almost always has other users' items) are all cancelled. Those other papers flow into the `"canceled"` branch of `handleDownloadAndIndexComplete`/`handleExtractionComplete` (lines 1937-1946, 2002-2011) and are marked `status: "failed"`. The victim users see "Extraction was canceled" without ever having cancelled.

**Root cause**
The comment at lines 275-277 acknowledges the behavior but the code still calls `pdfProcessingPool.cancelAll(ctx)`. The documented mitigation ("credit-guard checks") only prevents wrong billing, not wrong status writes — so foreign papers still become `"failed"`.

**Repro**
1. Start two extraction jobs from two users at the same time (or one user with two concurrent jobs).
2. Cancel job A.
3. Observe papers of job B transitioning to `status: "failed"` with `errorMessage: "Download/index was canceled"` or `"Extraction was canceled"`.

**Fix**
Workpool does not expose per-key cancel. Either:
- Track `workId`s per job (return value of `pdfProcessingPool.enqueueAction`) in a new table `extractionWorkIds` keyed by `jobId`, and call `pdfProcessingPool.cancel(ctx, workId)` for each one on cancel; or
- Keep `cancelAll` only when the pool is empty; otherwise rely on the per-handler cancellation check from C1/C2 (each onComplete inspects `job.status === "cancelled"` and early-returns without patching).

Option 2 is the minimal correct fix and drops `cancelAll` entirely — the job-status guard already prevents work from mutating cancelled jobs, and the actions themselves exit early via the credit-guard path.

---

## High

### H1. `handleDownloadAndIndexComplete` enqueues Step 2 for already-cancelled jobs
**File:line** `convex/extraction/mutations.ts:1883-1915`

**Symptom**
After cancel, a download that was already in-flight completes successfully → this handler patches paper.status to `"indexing"` (1887-1889) and enqueues `waitAndExtractAction` (1898-1915). The new work runs, hits the cancelled-job credit guard, and produces the C1 status-flip chain.

**Root cause**
The handler never re-reads the job to check `status`. It unconditionally progresses the state machine.

**Repro** Same as C1; the first paper was at the download stage when cancel fired.

**Fix**
At the top of the `result.kind === "success" && data.success` branch, fetch the job via `ctx.db.get("extractionJobs", jobId)` and early-return (patching paper to `"failed"` with `errorMessage: "Job cancelled"`, no re-enqueue) when `job?.status === "cancelled"`.

---

### H2. `cleanupOldPdfs` is defined but never scheduled
**File:line** `convex/extraction/mutations.ts:1577-1616` (definition); `convex/crons.ts:1-56` (no registration).

**Symptom**
PDFs are never auto-deleted. `extractionPapers.storageId` accumulates indefinitely even for completed jobs older than any intended retention window, driving up Convex storage cost.

**Root cause**
Grep of the entire repo shows `cleanupOldPdfs` is referenced only from within its own recursive self-schedule (`mutations.ts:1609`) — no external caller and no entry in `crons.ts`.

**Repro**
Inspect `convex/crons.ts` and the scheduler logs — there is no cron running `cleanupOldPdfs`.

**Fix**
Add to `convex/crons.ts`:
```ts
crons.interval(
  "cleanup old extraction pdfs",
  { hours: 24 },
  internal.extraction.mutations.cleanupOldPdfs,
  { maxAgeHours: 24 * 7 },
);
```
(Choose the retention window with product.)

---

### H3. Dead code: `handlePaperFetchComplete` and `getUserIdFromJob`
**File:line**
- `convex/extraction/mutations.ts:2031-2095` (`handlePaperFetchComplete`)
- `convex/extraction/mutations.ts:2016-2028` (`getUserIdFromJob`)
- `convex/extraction/index.ts:44,48` (re-exports only)

**Symptom**
Two internal functions are exported but have no live caller. Both still appear in generated types. `handlePaperFetchComplete` defines a `pdfProcessingPool.defineOnComplete` schema that includes paper fetching behavior no longer used (paper records are now created directly in the workflow at `workflow.ts:157-163`).

**Root cause**
Leftovers from the pre-workflow architecture.

**Repro**
`grep -rn "handlePaperFetchComplete\|getUserIdFromJob" .` returns only the definitions and the index re-exports.

**Fix**
Delete both functions from `mutations.ts` and remove the re-exports from `index.ts:44,48`. Per project rules (no legacy compatibility), purge them.

---

### H4. `saveExtractionResultsAndComplete` is missing `returns:` validator
**File:line** `convex/extraction/mutations.ts:2098-2144`

**Symptom**
Violates the Convex guideline mandating `returns:` on every public and internal function (`convex/_generated/ai/guidelines.md`). Runtime behavior is correct, but the contract is untyped and regressions in return shape go undetected.

**Root cause**
Missing `returns: v.null()` (or equivalent) property on the `internalMutation({ args: … })` call. All other internal mutations in this file declare returns.

**Fix**
Add `returns: v.null()` and ensure the handler returns `null`.

---

### H5. `totalPapers` mismatch: workflow sets it to pre-insert count, `createPaperRecords` silently drops rows
**File:line**
- `convex/extraction/workflow.ts:174-187` (writes `totalPapers: processableCount` based on `paperIds`, but `paperIds` is fetched at 166-172 from `getPapersByOpenAlexIds` which only sees rows `createPaperRecords` actually inserted)
- `convex/extraction/mutations.ts:1352-1367` (`createPaperRecords` silently `continue`s for non-processable papers when `pdfEnabled === false`)

**Symptom**
When `extraction.pdf` feature flag is off, papers without abstracts are dropped entirely — no `extractionPapers` row exists. The workflow then counts `processableCount` from whatever rows exist, so `totalPapers` appears consistent with the DB, but it does not reflect what the *user* submitted. The UI shows "0 papers" for a submission with 20 papers when no abstracts are present.

**Root cause**
`createPaperRecords` makes an opaque filtering decision (1365-1367) that the workflow is not aware of. There is no audit row, no user-visible explanation, and no counter for "skipped at insert time".

**Fix**
Always insert the `extractionPapers` row with `processable: false` and `status: "download_failed"` (or a new `"skipped"` literal if schema permits), and let the UI render them as skipped. This preserves user visibility and makes the totals line up without a special case.

---

### H6. Test-only internal actions bypass auth / feature flags / rate limits
**File:line** (internal-only, but callable from Convex dashboard)
- `convex/extraction/testActions.ts` (entire file — e.g., `createTestJob`)
- `convex/extraction/test_runner.ts` (entire file — `createAndRunTestJob`)
- `convex/extraction/testWorkflow.ts`
- `convex/extraction/test_automation.ts`, `test_automation_internal.ts`
- `convex/extraction/test_helpers.ts`
- `convex/extraction/create_test_job.ts`

**Symptom**
All of these declare `internalMutation`/`internalAction`. A developer or anyone with Convex dashboard access can trigger extraction jobs that skip `requireAuth`, `requireFeature("extraction.enabled")`, `rateLimit("start-extraction")`, and the paid-plan check. In production the dashboard is typically limited to the team, but since the code path also skips user credit checks, any invocation charges nothing and runs real LLM extractions.

**Root cause**
These are development artifacts shipping to production.

**Fix**
- Move them to `convex/tests/` and gate by a runtime env var (`CONVEX_ENV === "dev"`) or
- Delete them and use a proper Vitest-based test harness per the guidelines (`convex/_generated/ai/guidelines.md` recommends `convex-test`).

Given project rule #3 (no legacy tolerance), deletion is the preferred outcome.

---

### H7. `backfillJobStats` does not match `saveExtractionResultsAndComplete` totals
**File:line** `convex/extraction/mutations.ts:1275-1326`

**Symptom**
`backfillJobStats` counts only papers with `processable !== false`, but `saveExtractionResultsAndComplete` at line 2210-2232 increments `totalPapers` for every paper regardless of the `processable` flag. Running the backfill produces different stats than the live counter.

**Root cause**
Two separate accounting paths with divergent definitions of "total papers".

**Fix**
Pick one definition. If `totalPapers` in stats should reflect only processable papers, filter at line 2182 (check `paper.processable !== false` before incrementing). Otherwise remove the filter at line 1289.

---

## Medium

### M1. O(N^2) finalization in workflow non-processable branch
**File:line** `convex/extraction/workflow.ts:211-213` (inside the per-paper `for` loop at 193-233)

**Symptom**
For each non-processable paper, the workflow calls `finalizeJobIfDone` synchronously. `finalizeJobIfDone` does a `take(MAX_PAPERS_PER_JOB)` on `extractionPapers` (line 1628-1631). With N non-processable papers, this is N full scans during workflow enqueue.

**Fix**
Move the single `finalizeJobIfDone` call to *after* the loop (line 233), so it runs once per workflow invocation.

---

### M2. Workflow's `runMutation(updatePaperStatus)` inside the loop also scales poorly
**File:line** `convex/extraction/workflow.ts:202-214`

**Symptom**
For each non-processable paper, two mutations (`updatePaperStatus`, `finalizeJobIfDone`) run. With thousands of papers and a full scan of `extractionPapers` in finalize (M1), this dominates the workflow runtime and occupies workflow step slots unnecessarily.

**Fix**
Batch the `updatePaperStatus` calls using an `updatePaperStatusBatch` internal mutation, then call `finalizeJobIfDone` once after the loop (fixes M1 together).

---

### M3. `handleDownloadAndIndexComplete` does not mark `completedAt` on success
**File:line** `convex/extraction/mutations.ts:1887-1895`

**Symptom**
On success, the handler only patches `status: "indexing"` (and maybe `isIndexed: false`). On failed/cancelled branches it sets `completedAt`. This means successful papers never get a `completedAt` from this step — the field is only written by `saveExtractionResultsAndComplete` at line 2165 after Step 2 finishes.

That's actually consistent (the "terminal" timestamp should be set at the true terminal step), *but* `cleanupOldPdfs` queries `by_status_completedAt` on status `"completed"` with a `completedAt` filter (`mutations.ts:1589-1592`). Papers that fail during Step 2 but went through Step 1 still have an `indexing`-stage row with no `completedAt`, so they never show up in any "completed older than X" scan — they only accumulate if cleanup is extended later.

**Fix**
When (H2) is addressed, also add cleanup for failed states with an `updatedAt` filter, or explicitly set `completedAt` on the Step-1 failed/cancelled branches (already done at 1922, 1932, 1941) — the only gap is confirming the schema index `by_status_completedAt` is defined for every terminal state the cleanup job checks.

---

### M4. `handleDownloadAndIndexComplete` trusts `data.chunksCount === 0` but leaves status = "indexing"
**File:line** `convex/extraction/mutations.ts:1891-1895`

**Symptom**
When indexing produces zero chunks (empty PDF, text extraction fails, all chunks below `MIN_CHUNK_SIZE`), the handler writes `isIndexed: false` but still patches `status: "indexing"` and enqueues `waitAndExtractAction` (1898-1915). Step 2 then spends credits running the extraction prompt with zero evidence, ending up in the "no_content" branch at `workpoolActions.ts:1041-1073`. Cost is zero for the abstract-only path, but embedding credits (if any) were already deducted at 883-895 for zero chunks.

**Fix**
If `data.chunksCount === 0` and the paper has no usable abstract (`isUsableAbstract` returns false), short-circuit to `status: "indexing_failed"`, skip Step 2 enqueue, and call `finalizeJobIfDone`. This saves an entire Step-2 invocation per empty-index paper.

---

### M5. `chunking.ts` silently drops texts shorter than `MIN_CHUNK_SIZE`
**File:line** `convex/extraction/chunking.ts:128` (`if (endTrimmed - startTrimmed >= MIN_CHUNK_SIZE)`, with `MIN_CHUNK_SIZE = 80`)

**Symptom**
A page with fewer than 80 characters of extractable text produces zero chunks. The page is effectively invisible to the retriever. Figure captions, chapter dividers, and some abstracts under 80 chars are silently dropped.

**Fix**
For short pages, emit a single chunk equal to the whole page regardless of length (or lower `MIN_CHUNK_SIZE`). Add a logger when a page yields zero chunks.

---

### M6. `evidence_units.ts` `findFuzzyOffsets` requires ≥ 6 tokens
**File:line** (call site in) `convex/extraction/evidence_units.ts` — `findFuzzyOffsets` short-circuits to `null` for candidates under 6 tokens.

**Symptom**
Short but meaningful citations (e.g., "n = 124", "p < 0.05", "GDP") cannot be anchored, so they end up as "best_effort" or "insufficient_evidence" even when they literally appear on the page.

**Fix**
Drop the lower bound or reduce it to 2-3 tokens, and rely on similarity thresholds instead.

---

### M7. `deleteExtractionInternal` reuses a stale `papers` list across scheduler steps
**File:line** `convex/extraction/mutations.ts:1058-1200`

**Symptom**
The multi-step cascade fetches the `papers` list once at the top, then `scheduler.runAfter(0, …)` is used between steps. Between steps, new `extractionPapers` rows could be inserted by a late workpool callback (especially on a cancelled job per C1), so subsequent steps do not clean them up and orphan rows remain.

**Fix**
Re-query `extractionPapers` at the start of each `scheduler.runAfter` step or run the whole delete inside a single transaction that loops `.take(BATCH)` until empty.

---

## Low / Nitpicks

### L1. `.collect()` without bounds in test helpers
**File:line** `convex/extraction/test_helpers.ts:51, 58, 71` (and other test files)

Convex guidelines mandate `.take(N)` over `.collect()` unless the query has a hard upper bound from an index filter. Low severity because these files should be deleted per H6.

### L2. Non-null assertion on `zoteroConnection`
**File:line** `convex/extraction/workpoolActions.ts:745`

`zoteroConnection!` after only checking `zoteroApiKey`. The branch is race-safe (the connection was fetched in the same transactional read), but the assertion is a type escape hatch. Replace with an explicit `if (!zoteroConnection) throw` or restructure the conditional.

### L3. `handleExtractionComplete` uses truthiness of empty array
**File:line** `convex/extraction/mutations.ts:1969` (`if (data.success && data.results)`)

`[]` is truthy, so the success-with-empty-results branch is taken even when there is nothing to save. This is what makes the C1 cancelled-job flip happen via the "successful save" path. Change to `data.success && data.results && data.results.length > 0`, and route the empty case to a no-op or explicit error.

### L4. `cancelExtraction` does not patch `completedAt`
**File:line** `convex/extraction/mutations.ts:259-262`

The mutation sets `status: "cancelled"` but never writes a cancel timestamp. Schema has only `completedAt` — if the cancel is honored and no later finalize runs, `completedAt` stays `undefined`. UI ordering by completion date omits the cancelled job.

**Fix** Write `completedAt: Date.now()` when cancelling, and re-enable the C1 guard so it is not overwritten.

### L5. `job.totalPapers` is written twice before extraction starts
**File:line**
- `convex/extraction/workflow.ts:58-62` (writes `totalPapers: 0`)
- `convex/extraction/workflow.ts:183-187` (writes `totalPapers: processableCount`)

Two adjacent mutations on the same job row. Consolidate by only writing once at line 183-187, and handle the early `status: "downloading_pdfs"` patch as a separate statusOnly mutation.

### L6. `pdfProcessingPool.maxParallelism = 3` comment says "Reduced to 3 to prevent database conflicts with onComplete handlers"
**File:line** `convex/workpool.ts:5-6`

That mitigation is fragile — increasing parallelism in the future will re-expose the onComplete races documented in C1 and C2. Fix the underlying races per C1/C2 so this cap can be lifted based on external-API rate limits alone.

### L7. `screeningPool` is defined but audit scope was extraction only
**File:line** `convex/workpool.ts:17-25`

No bug, just note: screening uses a separate pool (`components.screeningWorkpool`) so H-level fixes to C3 should parallel any `cancelAll` usage in screening code (not checked here).

---

## What I explicitly verified, not just assumed

- Searched the entire repo for `cleanupOldPdfs` — only self-reference inside `mutations.ts` and no registration in any cron file.
- Searched for `handlePaperFetchComplete` and `getUserIdFromJob` — only their definition site and `convex/extraction/index.ts` re-exports.
- Read the `saveExtractionResultsAndComplete` end-to-end (2098-2242) to confirm the `finalizeJobIfDone` call at 2237-2239 is unconditional, proving C2.
- Read the job status enum in `schema.ts:377-385` — `"cancelled"` is a valid state that finalize unconditionally overwrites.
- Read paper status enum in `schema.ts:443-452` — no `"cancelled"` state, so cancelled jobs' papers end up as `"failed"` in both the explicit canceled branch and the empty-results success flip.
