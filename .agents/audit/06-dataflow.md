# Data Flow / Workflow Audit — Extraction

Scope: `convex/extraction/*`, `convex/workflow.ts`, `convex/workpool.ts`, `convex/convex.config.ts`, `convex/crons.ts`, `convex/http.ts`.

Libraries in use (from `package.json`):
- `@convex-dev/workflow` 0.3.11
- `@convex-dev/workpool` 0.4.6
- `@convex-dev/rag` 0.7.2
- `convex` 1.35.1

Components wired in `convex/convex.config.ts`:
- `workflow`, `workpool` (default pool used for extraction), `screeningWorkpool` (separate pool for screening), `rag`, `stripe`

## Pipeline map

### Entry & orchestration

```
Client (mutation `api.extraction.mutations.startExtraction`)
  └─ requireFeature + requireAuth + rateLimit("start-extraction")
  └─ ctx.db.insert("extractionJobs", {status:"pending"})
  └─ ctx.db.insert("extractionQuestions") [loop]
  └─ workflow.start(internal.extraction.workflow.runExtractionWorkflow, {jobId})
  └─ ctx.db.patch(jobId, {workflowId})
          ▼
Workflow (durable): runExtractionWorkflow (convex/extraction/workflow.ts)
  Step A  getJobInternal + getQuestionsInternal
  Step B  updateJobStatus("downloading_pdfs" | "indexing", totalPapers=0)
  Step C  For each historyEntry: runAction fetchPapersFromHistory → PaperData[]
          Append zotero items (no PDF fetch here — pdfUrl is a zotero:// URI)
          Append manual items (optionally with storageId from upload)
  Step D  Dedupe papers (openalex→doi→title+year fallback)
  Step E  createPaperRecords (insert rows with processable flag)
  Step F  getPapersByOpenAlexIds (read back with Convex ids)
  Step G  getPdfExtractionEnabledInternal  +  updateJobStatus (with totalPapers=processableCount)
  Step H  For each paper:
            • If not processable → updatePaperStatus("download_failed") + finalizeJobIfDone + continue
            • enqueuePaperProcessing
  Step I  updateJobStatus("extracting")
          ◇ Workflow ends here; work continues asynchronously in workpool.

                                         ▼
enqueuePaperProcessing (mutation)
  patch paper.status = "downloading"
  pdfProcessingPool.enqueueAction(downloadAndIndexPdfAction, ctx=paper/job/questions, onComplete=handleDownloadAndIndexComplete, retry{3, 2000ms, base2})
                                         ▼
┌───── downloadAndIndexPdfAction (Node action) ─────┐
│  • resolvePdfBlob                                 │
│      - if storageId → ctx.storage.get             │
│      - else downloadPdf(pdfUrl, doi, zotero...)   │
│      - on download: ctx.storage.store + patch     │
│                                                   │
│  • extractPdfJsTextPages (pdfjs-dist, Node)       │
│  • buildChunkedEvidenceUnitsFromPdfPages          │
│  • replacePaperEvidenceUnits (mutation)           │
│  • rag.add(namespace=`extraction:${jobId}`, key=`${paperId}:evidence-v3`,…) │
│  • credit-guard: skip deduct if job.status=cancelled │
│  • credits.internal.deductCredits (embedding)     │
│  • markPaperIndexed                               │
│  return {success, chunksCount, storageId}         │
└───────────────────────────────────────────────────┘
                                         ▼
handleDownloadAndIndexComplete (onComplete; internalMutation)
  result.kind === success & data.success:
    patch paper.status="indexing"
    IF chunksCount===0: patch isIndexed=false
    pdfProcessingPool.enqueueAction(waitAndExtractAction, onComplete=handleExtractionComplete, retry{3,2000ms,base2})
  result.kind in {failed, canceled}  OR  data.success===false:
    patch paper.status in {failed, download_failed}, errorMessage, completedAt
    runMutation(finalizeJobIfDone, jobId)

                                         ▼
┌───── waitAndExtractAction (Node action) ─────┐
│  • getPaperInternal / getJobInternal         │
│  • getPdfExtractionEnabledInternal           │
│  • getEvidenceUnitsInternal                  │
│  • credit-guard pre-check (returns success:true, results=[] if cancelled) │
│  • withUserCreditsBatch:                     │
│      for each question:                       │
│        • abstract-only branch if units empty │
│        • else dense (RAG) + lexical → RRF    │
│        • generateText(Output.object(schema)) │
│        • validateSupportEvidenceIds / policy │
│  • deductCredits at end                      │
│  return {success, results, creditsUsed, pdfContentUsed} │
└──────────────────────────────────────────────┘
                                         ▼
handleExtractionComplete (onComplete; internalMutation)
  on success+results:
    saveExtractionResultsAndComplete(paperId, results, creditsUsed, pdfContentUsed)
      • insert extractionResults rows (one per question)
      • upsert extractionJobStats (one row per (jobId, questionKey))
      • patch paper.status="completed", completedAt, creditsUsed
      • finalizeJobIfDone(jobId)
  on failed/canceled/data.success=false:
    patch paper.status="failed" + finalizeJobIfDone

                                         ▼
finalizeJobIfDone (mutation, runs once per completing paper)
  If processablePapers.length==0 → status="failed"
  completed+failed == processable.length → status=completed|failed
  else → just bump updatedAt
```

### Who calls what

- `startExtraction` → `workflow.start(runExtractionWorkflow)`
- `runExtractionWorkflow` → `internal.extraction.actions.fetchPapersFromHistory` (node), several `queries.*Internal`, `mutations.createPaperRecords`, `mutations.updateJobStatus`, `mutations.updatePaperStatus`, `mutations.enqueuePaperProcessing`, `mutations.finalizeJobIfDone`
- `enqueuePaperProcessing` → `pdfProcessingPool.enqueueAction(downloadAndIndexPdfAction)` with `onComplete=handleDownloadAndIndexComplete`
- `handleDownloadAndIndexComplete` → `pdfProcessingPool.enqueueAction(waitAndExtractAction)` with `onComplete=handleExtractionComplete`
- `handleExtractionComplete` → `saveExtractionResultsAndComplete` → `finalizeJobIfDone`
- `downloadAndIndexPdfAction` → `rag.add`, `credits.internal.deductCredits`, `mutations.replacePaperEvidenceUnits`, `mutations.setPaperStorage`, `mutations.markPaperIndexed`, `zotero.internal.getConnection`, `lib.audit.writeAuditLog`
- `waitAndExtractAction` → `withUserCreditsBatch` (which calls `credits.internal.deductCredits` at the end)
- `cancelExtraction` → `workflow.cancel` + `pdfProcessingPool.cancelAll(ctx)` (affects **all** jobs using the pool)
- `deleteExtraction` → `scheduler.runAfter(0, deleteExtractionInternal)` (re-schedules itself per batch)

### Cron jobs touching extraction (convex/crons.ts)

**None.** The only crons are `cleanupDeletedUsers`, subscription/stripe maintenance, Zotero OAuth cleanup, OpenRouter model sync, env-var validation. There is **no cron that reclaims stuck extraction jobs, retries orphaned papers, or triggers `cleanupOldPdfs`** (which exists as a mutation but is never scheduled).

### HTTP webhooks touching extraction

**None.** Extraction is entirely internal; only Clerk, Stripe, Zotero OAuth callback, and the AI wallet gateway are on HTTP. No external service calls back into the pipeline.

## Stage-by-stage audit

### Stage 1: `startExtraction` (mutations.ts:112)
- **What it does**: inserts `extractionJobs` + `extractionQuestions`, calls `workflow.start`, patches `workflowId` back onto the job.
- **Idempotency**: not idempotent; each client call inserts a new row. Rate-limited via `rateLimit("start-extraction")`.
- **Failure handling**: if `workflow.start` throws, job is left with `status:"pending"` and no `workflowId`. There is no cleanup — job is a tombstone forever.
- **Issues**:
  - mutations.ts:192-234 — If `workflow.start` throws after the job+questions rows are inserted, those rows are **rolled back** (single transaction), so this is actually fine. But the question is whether `workflow.start` is a scheduling call (runs at commit) — in workflow 0.3.x it *is* a scheduling call, which means the job and the workflow are committed atomically. Good.
  - No validation that `args.questions` is non-empty — zero-question jobs pass validation and cost API/LLM round-trips producing no rows.
  - No input bound on `args.questions.length` or source size; nothing prevents a 10,000-question job.

### Stage 2: `runExtractionWorkflow` (workflow.ts:23)
- **What it does**: fetches papers from multiple sources, dedupes, creates paper records, then **fan-outs** enqueues through the workpool.
- **Idempotency**: Convex workflow promises step-level durability. Each `step.run*` call is memoised. Retries of the workflow itself are safe per workflow semantics.
- **Failure handling**: if the whole workflow throws, the job remains in the last status set (either `downloading_pdfs`, `indexing`, or `extracting`). The workflow manager doesn't patch the job to "failed". The user-facing code therefore shows an "in progress" job indefinitely.
- **Issues**:
  - workflow.ts:54-62 — Status is set to `downloading_pdfs | indexing` **before** papers are fetched; `totalPapers: 0` is intentional. Fine.
  - workflow.ts:66-117 — Papers are accumulated in memory inside the workflow handler. Workflow handler args are persisted; the intermediate `papers` array is not durable across replays. A replay re-runs each `step.runAction(fetchPapersFromHistory,...)` whose *result* is memoised, so this is fine — but if OpenAlex returns different data on replay (very possible), the workflow uses the memoised result. Good.
  - workflow.ts:136-138 — `if (papers.length === 0) throw createError("VALIDATION_ERROR", ...)` terminates the workflow, **leaving the job in `downloading_pdfs` forever**. There is no catch that patches `status:"failed"`.
  - workflow.ts:140-151 — Dedupe by `openalex:id`/`doi:normalized`/`title+year`. Same title across different years is kept, but a zotero-only item with `openalexId="zotero:..."` and a history item with a real `openalexId` are **not** deduped against each other even if they have the same DOI — because the zotero openalexId short-circuits the DOI check. BUG.
  - workflow.ts:157-163 — `createPaperRecords` is a single mutation insert loop. If `dedupedPapers.length` is large (200+) this can hit transaction limits.
  - workflow.ts:192-233 — The per-paper loop calls `enqueuePaperProcessing` and `finalizeJobIfDone` in sequence. `finalizeJobIfDone` is called **only on the non-processable branch** (ln 211) — meaning after enqueueing processable papers, we never call `finalize`. That's fine since completion paths trigger finalize later. But the call at ln 211 inside the non-processable branch runs once per unprocessable paper, which is `O(n)` redundant.
  - workflow.ts:243 — After the loop the workflow sets status to `extracting` unconditionally. If the number of processable papers is 0 (all had no PDF/abstract), status is still set to `extracting` even though the workflow already marked each paper `download_failed` and triggered `finalizeJobIfDone` which patched it to `failed`. That last `updateJobStatus("extracting")` **overwrites `failed` back to `extracting`** — the job is stuck. BUG.

### Stage 3: Paper ingestion

- **Source A — history (OpenAlex)**: `fetchPapersFromHistory` (actions.ts:15). Single HTTP call with `per-page=200` fixed cap. No pagination. Uses `OPENALEX_CONTACT_EMAIL`. Fails loudly if env var missing.
  - **Issue**: actions.ts:127 — hardcoded `per-page=200`. Searches with >200 results are silently truncated with no warning to the user.
  - No retry on OpenAlex transient failures (one-shot fetch). The action may be retried by workpool, but 429/5xx are indistinguishable from 4xx so every retry re-hits the API.
- **Source B — Zotero**: items passed in via `sourceZoteroSelection`. The `pdfUrl` is set to a `zotero://select/…` URI which later only works in `downloadPdf` if a Zotero connection is configured.
- **Source C — Manual**: items passed in via `sourceManualItems`, optionally with a pre-uploaded `storageId`.

### Stage 4: PDF download → storage (`resolvePdfBlob`, workpoolActions.ts:697)

- **What it does**: if `storageId` exists and resolves, use it. Else downloads from `pdfUrl` (optionally with Zotero credentials) then stores via `ctx.storage.store`.
- **Idempotency**: Not idempotent for downloads — each retry re-downloads and creates a **new** storage blob (workpoolActions.ts:756). The previous blob is orphaned.
- **Issues**:
  - workpoolActions.ts:756 — On retry (workpool `maxAttempts:3`), every retry creates a new `_storage` blob. Only the last `setPaperStorage` survives; prior blobs leak storage quota.
  - workpoolActions.ts:757 — `setPaperStorage` is called **before** we know the PDF is valid / evidence extraction will succeed. If the subsequent extraction fails, the blob persists on the paper row forever (cleanup relies on `cleanupOldPdfs` cron — but no cron is registered!).

### Stage 5: Text extraction (pdfjs_extract.ts)

- **Runtime**: Node (`"use node";` at top of workpoolActions.ts). pdfjs-dist legacy build imported dynamically.
- **Idempotency**: pure function, deterministic.
- **Issues**:
  - pdfjs_extract.ts:67-69 — `pdf.destroy?.()` runs in a `finally` but if `pdf.getPage` throws mid-iteration the partial pages are discarded and the whole action fails. Fine.
  - No size/time bound. A 500-page PDF processed synchronously can breach Convex action's 10-minute limit.

### Stage 6: Chunking (evidence_units.ts)

- `buildChunkedEvidenceUnitsFromPdfPages` produces chunks with 650 target / 900 max / 120 overlap chars.
- The code paths `chunking.ts` (`extractAndChunkPdf`) and `evidence_units.ts` (`buildChunkedEvidenceUnitsFromPdfPages`) are **both** exported and both do similar work. Only evidence_units is used by workpoolActions; chunking.ts is dead code.

### Stage 7: LLM calls (`waitAndExtractAction`, workpoolActions.ts:918)

- Per paper: **one LLM call per question**, sequential inside a single `for` loop (workpoolActions.ts:1003). For `N` questions this is `N` round-trips. No batching / no per-question parallelism.
- Parallelism: set by `pdfProcessingPool` `maxParallelism: 3` (convex/workpool.ts:7). So at most 3 papers' worth of LLM calls run concurrently.
- `temperature: 0`, `STANDARD_PROVIDER_OPTIONS`, Zod schema via `Output.object(buildAnswerSchema)`.
- **Issues**:
  - LLM calls are sequential per question inside the action; a 10-question job takes 10× longer per paper than necessary. `Promise.all` would be a clean win if the model can handle parallel requests under our parallelism budget.
  - Retries: if any question throws, the error is caught and a single "extraction_error" result is produced for that question only (workpoolActions.ts:558). The action still returns `success:true`. Good for partial resilience, but the workpool `retry{maxAttempts:3}` on the wrapping action **never re-runs** because the action doesn't throw.
  - workpoolActions.ts:973-988 — If the job was cancelled, the action returns `{success:true, results:[], creditsUsed:0}`. Then `handleExtractionComplete` treats this as a successful empty extraction and marks the paper `completed` with **no results and 0 credits**. That's technically correct, but `saveExtractionResultsAndComplete` still upserts 0 rows into `extractionJobStats`, and the paper looks "completed" with zero output — misleading to the user.

### Stage 8: Evidence unit persistence (`replacePaperEvidenceUnits`, mutations.ts:2244)

- Deletes all existing units for the paper, then inserts new ones. Uses `MAX_EVIDENCE_UNITS_PER_PAPER` bound.
- **Idempotency**: full-replace so safe on retry.
- **Issue**: The delete loop at ln 2267 is unbounded in practice: `.take(MAX_EVIDENCE_UNITS_PER_PAPER)` then iterates the result. If a paper accumulates more than `MAX_EVIDENCE_UNITS_PER_PAPER` (say, because of a prior bug), only the first batch is deleted, leaving a ghost set.

### Stage 9: Finalization (`finalizeJobIfDone`, mutations.ts:1619)

- Counts `processablePapers` vs `completed + failed/download_failed/indexing_failed`.
- When all processable papers are in a terminal state, patches the job to `completed` (or `failed` if 100% failed).
- **Issues** (see PROBLEMS section for details):
  - Race condition when N papers complete concurrently: each paper triggers `finalizeJobIfDone`. Two concurrent transactions both read `completed=N, failed=0` and both write the same terminal status — OCC resolves this, so the outcome is correct, **but** `completedAt` is set every time, shifting.
  - **The status check does not re-read `job.status`** so a `cancelled` job will be overwritten to `completed`/`failed` by a late paper finishing. BUG.
  - After workflow.ts:243 sets `extracting`, `finalizeJobIfDone` can only transition to `completed` or `failed`. The intermediate statuses (`downloading_pdfs`, `indexing`, `extracting`) are never advanced once any paper completes. Users see a bouncing status.
  - mutations.ts:1635-1645 — if `processablePapers.length === 0`, status is forced to `failed`. But this races with workflow step I (ln 243 `extracting`). Whichever lands last wins.

### Stage 10: Failure paths

- Permanent failures: paper.status ∈ {`failed`, `download_failed`, `indexing_failed`}; errorMessage populated. No retry.
- Transient failures: `retry{maxAttempts:3, initialBackoffMs:2000, base:2}` is configured in `enqueuePaperProcessing` and at the second-stage `enqueueAction` inside `handleDownloadAndIndexComplete`. This means download retries 3×, then extract retries 3×. There is no circuit-breaker; a bad LLM key produces 3 retries × all papers.
- There is **no dead-letter queue**. A permanently failing paper just sits with `status:"failed"`; no visibility in UI beyond `subscribeToJobProgress.statusCounts.failed`.

## Cross-cutting concerns

### Cancellation semantics

`cancelExtraction` (mutations.ts:241) does three things:
1. Patch job to `status:"cancelled"`.
2. `workflow.cancel(ctx, workflowId)` — stops new workflow steps.
3. `pdfProcessingPool.cancelAll(ctx)` — **cancels pending items across ALL jobs** using `pdfProcessingPool` (not just this one). A code comment at ln 275-277 acknowledges this: "cancelAll() cancels ALL pending items across all jobs, not just this job's."

Concerns:
- **Cross-job blast radius**: cancelling job A cancels pending workpool items for jobs B, C, D. Those jobs' papers get `handle*Complete` calls with `result.kind === "canceled"`, which patches each paper to `status:"failed"` (mutations.ts:1938, 2003). BUG — **cancelling any job effectively fails every other running job**.
- The screening workflow paid the cost to avoid this (separate `screeningWorkpool` in convex.config.ts), but **did not add a per-job pool for extraction**. Only one shared `pdfProcessingPool`.
- In-flight actions keep running even after `cancelAll`; only queued items are cancelled. So an extracting paper finishes, burns LLM credits, then `handleExtractionComplete` sees `job.status:"cancelled"` (via credit-guard at workpoolActions.ts:978) and skips credit deduction. But the LLM call already consumed provider-side tokens, **we don't bill the user for them** — the cost is absorbed by us.
- Already-deducted credits (embeddings at workpoolActions.ts:884) are **not refunded** when a job is cancelled.
- Orphaned `_storage` blobs from `resolvePdfBlob` are not cleaned on cancellation.

### Retries & backoff

- Workflow: `maxParallelism:10, retryActionsByDefault:true, defaultRetryBehavior:{maxAttempts:3, initialBackoffMs:1000, base:2}` (workflow.ts).
- Workpool (pdfProcessingPool): `maxParallelism:3, retryActionsByDefault:true, defaultRetryBehavior:{maxAttempts:3, initialBackoffMs:2000, base:2}` (workpool.ts). Enqueue sites also override with same values (mutations.ts:1840).
- Retries do not distinguish transient from permanent errors. A 404 from OpenAlex, an invalid PDF URL, or a schema validation error from the LLM all cause 3 retries.
- No jitter mentioned on workflow retries (workpool has jitter by default per 0.4.x).

### Finalization race

See Stage 9 and CONCRETE PROBLEMS below. Short version: every completing paper triggers a `finalizeJobIfDone`. OCC ensures they don't double-write, but **`finalizeJobIfDone` does not check the current `job.status`**, so a cancelled job can be resurrected to `completed` by a late completion.

### Credit/billing integration

- Embedding cost: calculated from `ragResult.usage.tokens` and converted to credits; deducted inside `downloadAndIndexPdfAction` (workpoolActions.ts:871-896).
- LLM cost: sum of input/output tokens per question; `calculateServerCreditsToDeduct` → `deductCredits` inside `withUserCreditsBatch` (ai/helpers.ts:320).
- **Credit guard**: before deducting, `ctx.runQuery(getJobInternal)` to check `job.status === "cancelled"`. If so, skip deduction.
- **Double-charge risk on retry**: a workpool retry of `downloadAndIndexPdfAction` re-embeds and calls `deductCredits` again. There is no idempotency key, no `extractionPapers.embeddingDeducted` flag. **Each retry bills again.** BUG.
- **Double-charge on LLM**: same pattern in `waitAndExtractAction`. If a retry fires after a partial success (imaginable if the action throws post-LLM-call), the user is billed twice for the same LLM tokens.
- **No refund on cancel**: credits already deducted before the cancel-check are not returned.

### Observability

- Heavy `console.log`/`console.info`/`console.warn` usage throughout. Key events: `[Workflow]`, `[enqueuePaperProcessing]`, `[handle*Complete]`, `[waitAndExtractAction] question diagnostics`.
- No structured events / no `audit` table writes for extraction-specific events (the only `audit.writeAuditLog` call is for Zotero key decryption, workpoolActions.ts:735).
- No metrics counter table, no error aggregation.
- User-facing observability: `subscribeToJobProgress` returns `statusCounts` + last 20 papers. Failure cause is only surfaced per-paper via `errorMessage`.
- `retrievalDiagnostics` is saved per result — good for post-hoc analysis.

### Resource limits

- `MAX_PAPERS_PER_JOB = 500` (mutations.ts:35) — enforced with `.take()` on reads. But *insertion* in `createPaperRecords` is not bounded. OpenAlex returns up to 200 per query (hardcoded), and the workflow fetches one page per history entry. So N history entries × 200 = potential insert storm.
- `MAX_EVIDENCE_UNITS_PER_PAPER` defined in `lib/queryBounds` — bounds reads.
- `ARRAY_ANSWER_MAX_ITEMS=8` for array-type answers.
- No explicit max questions per job. No max job size cost estimate shown to user.
- Max attempts = 3 at each stage.

## Concrete problems (file:line)

### P1: Workflow final `updateJobStatus("extracting")` clobbers earlier `failed`
- **File:line**: `convex/extraction/workflow.ts:238-241`
- **What's wrong**: At end of the fan-out loop, the workflow unconditionally sets `status:"extracting"`. If all papers were non-processable, each was set to `download_failed` and `finalizeJobIfDone` flipped the job to `failed` during the loop. The final `updateJobStatus("extracting")` then **overwrites `failed` → `extracting`**, leaving the job stuck in `extracting` forever with no papers to complete it.
- **Scenario**: Start a job on a search that yields 5 papers but all have no `oa_url` and no abstract. Each paper is marked `download_failed`; job flips to `failed` via `finalizeJobIfDone`; workflow finishes with `status:"extracting"`.
- **Fix**: Read fresh job status before calling `updateJobStatus`, or move the status update to happen only if any enqueues actually succeeded. Better: drop the unconditional call and let `finalizeJobIfDone` own the terminal state.

### P2: `cancelExtraction` cancels workpool items for every other running job
- **File:line**: `convex/extraction/mutations.ts:278-282`
- **What's wrong**: `pdfProcessingPool.cancelAll(ctx)` cancels pending items for **all** jobs, not just the one being cancelled. The on-complete handlers of cascaded papers then patch their paper to `status:"failed"` and trigger `finalizeJobIfDone` for their job, turning every unrelated in-flight job into a partial-failure state.
- **Scenario**: User A cancels job X while user B has job Y running. Half of user B's papers become `failed` with `errorMessage:"…was canceled"`. Finalize then marks job Y `failed` (or leaves it running with missing papers).
- **Fix**: Add a `jobId` filter (workpool 0.4.6 exposes `cancel(id)` per work id; the correct pattern is to track enqueued workIds per job in `extractionPapers.workId` and cancel them individually). Alternative: spin up a per-job workpool, or at minimum a per-owner workpool (mirroring `screeningWorkpool`).

### P3: `finalizeJobIfDone` resurrects cancelled jobs
- **File:line**: `convex/extraction/mutations.ts:1619-1673`
- **What's wrong**: Does not check `job.status === "cancelled"` before overwriting. When a cancelled job has in-flight actions that later complete, `handleExtractionComplete` → `finalizeJobIfDone` patches `status` to `completed` or `failed`, replacing the `cancelled` status.
- **Scenario**: Cancel a job with 10 papers; 3 are already running inside actions. They finish later, their on-complete handler calls `saveExtractionResultsAndComplete` → `finalizeJobIfDone`, which computes `completedCount + failedCount == processablePapers.length` (because cancel-set the other 7 to `failed`) and flips the job to `completed`.
- **Fix**: In `finalizeJobIfDone`, early-return if `job.status === "cancelled"`. Same for `finalizeJob`.

### P4: Double-charge on workpool retry of `downloadAndIndexPdfAction`
- **File:line**: `convex/extraction/workpoolActions.ts:871-896`
- **What's wrong**: If the embedding step succeeds (with `deductCredits`) but a later step in the same action throws (e.g. `markPaperIndexed` fails), the workpool retries the entire action. Re-running `rag.add` re-embeds and re-deducts. There is no idempotency key on the deduction.
- **Scenario**: Transient DB error after embedding success; retry fires; user billed twice for the same embedding tokens.
- **Fix**: Either make the action idempotent (check `paper.isIndexed` before `rag.add`) or write a ledger entry keyed by `(paperId, kind="embedding")` and skip on replay. Cleanest: gate embedding on `!paper.isIndexed`.

### P5: Double-charge for extraction LLM calls on retry
- **File:line**: `convex/extraction/workpoolActions.ts:990-1183`
- **What's wrong**: `withUserCreditsBatch` deducts at the end. If the action throws *after* the LLM calls complete but *before* the credit deduction, the retry re-runs the LLM calls and deducts again. Even more problematic: the retry could succeed where the first failed, so the user pays for both runs.
- **Scenario**: LLM call succeeds for all questions; `deductCredits` throws due to OCC conflict; action retries; LLM runs again.
- **Fix**: Track a `paper.extractionBilled: boolean` flag checked inside the action. Or move credit deduction to `saveExtractionResultsAndComplete` and gate on a `paper.completedBilling` field.

### P6: `workflow.ts:136-138` leaks job on empty result set
- **File:line**: `convex/extraction/workflow.ts:136-138`
- **What's wrong**: `throw createError("VALIDATION_ERROR", "No sources selected")` terminates the workflow without patching the job. The job remains in `status:"downloading_pdfs"` (set at ln 60). Workflow.cancel won't be called because nobody knows.
- **Scenario**: Zotero selection with 0 items + no history entries + no manual items. Although validated upstream, any upstream bug leaves the job stranded.
- **Fix**: Wrap the workflow handler in try/catch that patches `status:"failed"` on any terminal error.

### P7: Orphaned `_storage` blobs on retry
- **File:line**: `convex/extraction/workpoolActions.ts:756-763`
- **What's wrong**: Every invocation of `resolvePdfBlob` that reaches the `downloadPdf` branch creates a new blob and stores it. Retries create additional blobs; only the final `setPaperStorage` call wins. Previous blobs are unreferenced forever.
- **Fix**: Check `paper.storageId` first (already done at ln 704-709), but also skip the `ctx.storage.store` path on retry of a partially-succeeded action by inspecting the `_storage` returned from an earlier attempt (harder). Simplest: persist a storageId on first successful download and on retry reuse it.

### P8: `cleanupOldPdfs` is orphaned — no cron registers it
- **File:line**: `convex/extraction/mutations.ts:1578-1616`, and `convex/crons.ts` (no entry)
- **What's wrong**: `cleanupOldPdfs` self-schedules via `ctx.scheduler.runAfter` **only when it's already running** and the batch is full. Nothing initiates the first run. So PDF blobs persist past the intended `maxAgeHours` window indefinitely.
- **Fix**: Add `crons.interval("cleanup extraction pdfs", {hours:24}, internal.extraction.mutations.cleanupOldPdfs, {maxAgeHours: 168})` to `crons.ts`.

### P9: OpenAlex pagination limit hardcoded at 200
- **File:line**: `convex/extraction/actions.ts:127`
- **What's wrong**: `per-page=200` is the OpenAlex max per page. Searches with 10,000 matches silently use only the top 200. No `cursor` or `page` iteration.
- **Scenario**: A broad search query returns only the first 200 papers; user has no indication.
- **Fix**: Either document the cap explicitly to the user, or iterate with cursor pagination up to a configured job size limit (say `MAX_PAPERS_PER_JOB=500`).

### P10: Dedupe bypasses DOI check when `openalexId` present
- **File:line**: `convex/extraction/dedupe.ts:20-22`
- **What's wrong**: Two papers with the same DOI but different `openalexId` values (e.g. `"zotero:user:xxx"` vs `"W1234"`) produce two different dedupe keys and both are kept. Similarly, a Zotero item and a history item that are the **same DOI** are not deduped.
- **Fix**: Always try DOI key first; fall back to openalexId only if DOI is missing.

### P11: `handleExtractionComplete` treats cancelled-success (empty results) as "completed"
- **File:line**: `convex/extraction/mutations.ts:1969-1982` + `convex/extraction/workpoolActions.ts:978-988`
- **What's wrong**: When `waitAndExtractAction` short-circuits on cancel (returns `success:true, results:[]`), `saveExtractionResultsAndComplete` is called with an empty array. The paper is marked `completed` with no rows inserted. `finalizeJobIfDone` counts this as completion. The paper appears successful to the user but has no answers.
- **Fix**: In the credit-guard branch, return `success:false, error:"cancelled"` instead, so the on-complete handler marks the paper `failed`. Or add a dedicated `status:"cancelled"` for papers.

### P12: `saveExtractionResultsAndComplete` is missing `saveExtractionResultsAndComplete` validator return type and mixes `creditsUsed` default with 0 on cancel
- **File:line**: `convex/extraction/mutations.ts:2098-2242`
- **What's wrong**: No `returns` validator. Not a correctness bug, but inconsistent with the rest of the codebase (Convex style rule: always set `returns`).

### P13: Embedding cost env var evaluated at module-load — changes require redeploy
- **File:line**: `convex/extraction/workpoolActions.ts:145-153`
- **What's wrong**: `EXTRACTION_EMBEDDING_USD_PER_1M_TOKENS` is parsed once at module load. Runtime updates via the Convex dashboard require a deploy to take effect.
- **Fix**: Read `process.env` inside `estimateEmbeddingCostDollars` each call, or accept a live override via a feature flag.

### P14: `handlePaperFetchComplete` is registered but never enqueued
- **File:line**: `convex/extraction/mutations.ts:2031-2095`
- **What's wrong**: A `defineOnComplete` handler exists (`handlePaperFetchComplete`) for an outdated paper-fetch workpool flow. Nothing enqueues an action wired to this handler (paper fetch moved into the workflow via `step.runAction`). Dead code.
- **Fix**: Delete it.

### P15: Non-idempotent stats upsert on workflow replay
- **File:line**: `convex/extraction/mutations.ts:2181-2234`
- **What's wrong**: `extractionJobStats` is updated by additive delta (`existingStat.totalPapers + 1`). If `saveExtractionResultsAndComplete` is called twice for the same paper (e.g., two on-complete events for the same workId, or a workflow replay), stats are doubled. The paper-level insert of `extractionResults` also creates duplicate rows.
- **Fix**: Make `saveExtractionResultsAndComplete` idempotent by keying on `(paperId, questionKey)` with a unique index and using `patch` on existing. For stats, recompute from source instead of delta-add, or gate on a `paper.statsApplied` flag.

### P16: Workflow `Convex function size` concern — large `questions` blob stored per enqueue
- **File:line**: `convex/extraction/mutations.ts:1786-1850`
- **What's wrong**: Each `enqueuePaperProcessing` passes the full `questions` array as workpool args and as `context` on the onComplete. For 200 papers × 20 questions this duplicates the questions blob 200× in the workpool's internal state.
- **Fix**: Store `questions` once on the job and re-fetch inside the action. Already possible via `getQuestionsInternal`.

### P17: `cancelAll` silently does nothing if job has no enqueued items yet
- **File:line**: `convex/extraction/mutations.ts:278-282`
- **What's wrong**: Cancelling a newly-created job (within the brief window between `startExtraction` and workflow scheduling) doesn't abort the workflow. `workflow.cancel` is called, which should handle this — but the flag to skip work inside `runExtractionWorkflow` steps is missing. The workflow keeps fetching from OpenAlex etc. until it naturally completes or hits `workflow.cancel` propagation boundary.
- **Fix**: At each workflow step, early-return if the job's status is `cancelled`. Currently only the per-paper credit-guard branches check.

## Strengths

- **Clear separation**: durable workflow orchestration in `workflow.ts`, per-paper action work in `workpoolActions.ts`, state mutations in `mutations.ts`.
- **Credit guards in actions** (workpoolActions.ts:881, 978): do check job status before billing — a genuine defence against the happy-cancel path.
- **`extractionJobStats` denormalized counter** (mutations.ts:2180): avoids the `.collect().length` anti-pattern for aggregated reporting.
- **Retry semantics are explicit** at each enqueue site, and workpool retries are properly configured with exponential backoff.
- **Evidence policy** (workpoolActions.ts:312-387): grounded/best_effort/insufficient_evidence/extraction_error is a thoughtful model; confidence caps are enforced server-side.
- **Dedupe at ingestion** (workflow.ts:140-151, dedupe.ts): catches the common openalex/doi case.
- **Cascade delete is batched** (mutations.ts:1058-1200): avoids transaction limits via self-rescheduling.
- **Snapshot reporting** (mutations.ts:764): uses pre-aggregated stats when available, falls back to fan-out, schedules lazy backfill.
- **Bounded reads**: `MAX_PAPERS_PER_JOB`, `MAX_EVIDENCE_UNITS_PER_PAPER`, `FUSED_TOP_N`, `EVIDENCE_POOL_N`, `ARRAY_ANSWER_MAX_ITEMS` — consistent use of safety caps.
- **Separate screeningWorkpool** already exists (convex.config.ts:6, 13) — the pattern for per-feature pools is established, just not applied to extraction yet.
