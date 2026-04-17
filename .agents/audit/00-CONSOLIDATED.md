# Extraction Pipeline — Consolidated Audit

6 parallel specialized agents reviewed `convex/extraction/` (~9,600 LOC across 32 files) plus related orchestration, schema, and UI. Individual reports in `01-security.md` through `06-dataflow.md`.

**Top‑line verdict:** architecturally the pipeline is well‑shaped (Workflow + Workpool + onComplete + denormalized stats), but the **cancellation path is broken at multiple layers**, several hot paths read 250k+ docs per job, and a **user-controlled URL goes into raw `fetch()` without allowlisting** (SSRF). The same core bugs are flagged independently by 3+ agents, which makes prioritization easy.

---

## 🔴 P0 — Fix this week (security, money, correctness)

### 1. SSRF via user‑controlled `pdfUrl`
- **Files**: `convex/extraction/mutations.ts:150-162` → `lib/pdf/download.ts:73-76, 382, 423-426`
- **What**: `startExtraction` accepts `sourceManualItems[].pdfUrl`; flows into raw `fetch(url, { redirect: "follow" })` with no scheme / host / IP allowlist. Errors surface to user = network oracle.
- **Impact**: Attacker can probe internal services, AWS/GCP metadata (`169.254.169.254`), RFC1918 ranges.
- **Fix**: validate scheme (https only), resolve DNS and reject private / link‑local / loopback / metadata IPs, cap response size, do not return network errors verbatim.
- *Confirmed by:* security.

### 2. `cancelExtraction` nukes every other user's in‑flight work
- **File**: `convex/extraction/mutations.ts:278-282` calls `pdfProcessingPool.cancelAll(ctx)` globally. Code comment admits the scope.
- **Impact**: Cross‑tenant DoS. Cancel job A → all papers of other users' running jobs marked `failed` via onComplete "canceled" branch.
- **Fix**: track per‑paper workIds on `extractionPapers`; cancel individually. `convex/screening/cancel.test.ts` already demonstrates the per‑job cancel pattern — mirror it.
- *Confirmed by:* security, bugs, dataflow (P2).

### 3. Cancelled jobs get resurrected
- **File**: `convex/extraction/mutations.ts:1536-1575` (`finalizeJob`) and `:1619-1674` (`finalizeJobIfDone`). Neither guards on `job.status === "cancelled"`.
- **Impact**: Late onComplete callback flips `cancelled → completed/failed`. Compounded by `waitAndExtractAction` credit guard (`workpoolActions.ts:978-988`) returning `success: true, results: []` when credits are low — saved as a successful terminal extraction.
- **Fix**: early‑return when `job.status === "cancelled"` or `"failed"`; treat empty‑results credit‑guard response as a separate terminal state.
- *Confirmed by:* bugs (C1), dataflow (P3).

### 4. Double‑charge on workpool retry (no idempotency key)
- **Files**: `convex/extraction/workpoolActions.ts:871-896` (embedding credit deduction) and `:990` (LLM deduction inside `withUserCreditsBatch`).
- **Impact**: Transient failure after billing → workpool retry re‑embeds / re‑calls LLM and deducts again.
- **Fix**: gate embedding on `paper.isIndexed` before deducting; move LLM deduction into `saveExtractionResultsAndComplete` gated by a `paper.extractionBilled` flag.
- *Confirmed by:* dataflow (P4/P5).

### 5. Double-firing of `finalizeJobIfDone`
- **File**: `convex/extraction/mutations.ts:1979` invokes `finalizeJobIfDone` directly, then `saveExtractionResultsAndComplete:2237` invokes it again transitively. Combined with §3 and §6 → double-counted stats + wrong terminal state.
- **Fix**: single call path. Given §3 fix, let `saveExtractionResultsAndComplete` be the only caller.
- *Confirmed by:* bugs (C2), dataflow (P15).

### 6. Double-counted stats on duplicate onComplete
- **File**: `saveExtractionResultsAndComplete` uses delta‑add on `extractionJobStats` and non‑unique inserts into results. Double-fire → double-counted.
- **Fix**: idempotency — either upsert‑by‑(jobId, paperId, questionKey) for result rows, or mark paper `extractionBilled/extractionPersisted` and skip re-persist.
- *Confirmed by:* dataflow (P15), bugs.

### 7. `identity.subject` used in ownership lookup (auth guideline breach)
- **File**: `convex/extraction/queries.ts:1656` (`getCurrentUserInternal`) bypasses the active-user check.
- **Fix**: delete the function (it's a redundant wrapper per architecture audit §2j) and route callers through `lib/auth.getCurrentUser` which uses `tokenIdentifier`.
- *Confirmed by:* convex-best-practices, architecture.

### 8. Unbounded request arrays → DoS / cost bomb
- **File**: `convex/extraction/mutations.ts:123-176` accepts `questions`, `sourceManualItems`, `sourceZoteroSelection.items` with **no length caps**.
- **Impact**: Attacker or runaway script queues a 10k-question job, blows transaction limits and LLM cost.
- **Fix**: validate lengths in the `args` validator (e.g. `questions ≤ 50`, `sourceManualItems ≤ 1000`); add a plan-tier cap in `assertJobOwnership`/start path.
- *Confirmed by:* security.

---

## 🟠 P1 — Fix this sprint (scale killers, real cost)

### 9. `finalizeJobIfDone` reads all papers on every paper completion
- **File**: `convex/extraction/mutations.ts:1619`, called from 9 sites. 500-paper job → ~250k doc reads just to close.
- **Fix**: rely on the already‑maintained `extractionJobStats` counter. Early-return based on counter; only read papers when the counter says done.
- *Confirmed by:* performance (C1).

### 10. `subscribeToJobProgress` re-scans all papers on every status tick
- **File**: `convex/extraction/queries.ts:1587`. Every subscribed client tab receives the full 500-paper payload on every status transition.
- **Fix**: subscribe to `extractionJobStats` (already maintained, never read by subscribers per performance report). Wire it up.

### 11. 6 N+1 patterns in `loadJobPapersAndResults`
- **File**: `convex/extraction/queries.ts:219` and callers (insights, results, review queue).
- **Fix**: add `extractionResults.by_job` index, batch-load. Performance report lists 7 proposed indexes in an index-gap table.

### 12. Unbounded inline arrays on `extractionJobs` (1MB doc-limit risk)
- **File**: schema — `sourceZoteroSelection.items`, `sourceManualItems` (with abstracts) stored inline. Guidelines explicitly forbid this.
- **Fix**: move to a child table `extractionJobSources` with FK → jobId.
- *Confirmed by:* performance, convex-best-practices.

### 13. `backfillJobStats` triple-nested O(Q·P·R)
- **File**: `convex/extraction/mutations.ts:1271-1278`. N+1 `.collect()` inside nested question × paper loop.
- **Fix**: invert loop: pre-load all results in one indexed query, bucket in JS, then write.
- *Confirmed by:* performance, convex-best-practices.

### 14. Serial LLM calls per paper
- **File**: `convex/extraction/workpoolActions.ts:1003`. One LLM call per question sequentially.
- **Fix**: `Promise.all` across questions, bounded concurrency. Each question is independent.

### 15. `.filter` on DB query instead of `withIndex` / JS
- **File**: `convex/extraction/mutations.ts:1210` (`cleanupFailedPaperStorage`). Guidelines ban `.filter`.
- **Fix**: either index the filter field or iterate+filter in JS after bounded `.take()`.

### 16. Test/debug `internal` actions bypass auth + feature-flag + rate-limit gates
- **Files**: `testActions.ts`, `test_runner.ts`, `test_automation.ts`, `test_automation_internal.ts`, `create_test_job.ts`, `testWorkflow.ts`, plus all `debug_*.ts`.
- **Impact**: callable via Convex dashboard; bypass production gates; pollute prod metrics/billing.
- **Fix**: gate behind env check (`CONVEX_CLOUD_ENV !== "prod"`) or remove per architecture audit §3.

### 17. Cancelled paper pool items kept, but storage + embeddings never cleaned
- **File**: `cleanupOldPdfs` exists (`mutations.ts:1577`) but is **not registered** in `convex/crons.ts`. PDFs accumulate forever.
- **Fix**: register the cron (`crons.interval("cleanup old pdfs", { hours: 24 }, internal.extraction.cleanupOldPdfs, {})`).
- *Confirmed by:* bugs (HIGH), dataflow (P8).

### 18. Prompt injection via user-supplied question text
- **File**: `convex/extraction/prompts.ts:73-77`. `question.question` concatenated into system prompt with no delimiter/escape.
- **Fix**: wrap in clear delimiters, use structured / role-separated inputs, strip control tokens, and use a strict JSON-schema response format (already partly in place — tighten).

---

## 🟡 P2 — This month (DRY / modernization)

### 19. God-file splits
- `mutations.ts` 2288L → 9 files across `mutations/jobs|papers|results|templates|savedViews|reports|evidence|internal/*`.
- `queries.ts` 1659L → `queries/jobs|papers|results|insights|reviews|views|templates|reports|internal`.
- `workpoolActions.ts` 1191L → move pure helpers to `lib/extraction/evidence-policy.ts` + `lib/extraction/retrieval.ts`; leave only 2 thin actions.
- Exact function→file line-map in `05-architecture.md` §1.

### 20. DRY consolidations
- Triplicated `GENERIC_ARRAY_TERMS` (`lib/extraction/insights.ts`, `workpoolActions.ts:117`, `debug_job_citations.ts:11`) → single export.
- 8-step cascade delete (`mutations.ts:1058-1201`) → `batchDeleteByIndex` helper.
- 3× onComplete switch branches (`mutations.ts:1853, 1951, 2031`) → `handleWorkpoolResult({onSuccess,onFailed,onCanceled})`.
- Duplicate `finalizeJob` / `finalizeJobIfDone` → one `maybeFinalizeJob`.
- Inline `sourceType` validator duplicated 5× → export from `validators.ts`.
- `debug_papers.ts` is a subset of `debug_errors.ts` → delete.
- 6 near-identical test fixture files → one `tests/fixtures.ts`.

### 21. Dead code (delete)
- `guard.ts` (4-line comment stub).
- `test_helpers.ts` (unreferenced).
- `testWorkflow.ts` (`testSimpleWorkflow` not wired).
- `chunking.ts`: `extractAndChunkPdf`, `formatChunkWithMetadata`, `prepareChunksForRag` (no callers).
- `prompts.ts:118` `detectQuestionType` (no callers).
- `queries.ts:1648` `getCurrentUserInternal`.
- Legacy `sourceHistoryId` / `sourceZoteroCollection` schema fallback (`workflow.ts:65-69`) — CLAUDE.md explicitly says no legacy.
- Dead `handlePaperFetchComplete` / `getUserIdFromJob`.

### 22. Public API surface leaks internal contracts
- `convex/extraction/index.ts` re-exports `createJobDirect`, `createQuestionDirect`, `setJobWorkflowId`, `enqueuePaperProcessing`, `handle*Complete`, `updatePaperStatus`, `setPaperStorage`, etc. These are internal workflow contracts, not public API.
- Move to `convex/extraction/internal.ts` + restrict via `internalMutation`.

### 23. Unjustified `"use node"` on 4 files
- `actions.ts`, `prompts.ts`, `test_helpers.ts`, `chunking.ts` — no Node built-ins used. Remove directive so they can be imported from V8 contexts (fixes the "pure functions trapped behind `use node`" boundary leak).

### 24. ~20 internal queries missing `returns:` validators
- Batch-add `returns:` to every `internalQuery` and `internalMutation`. Convex guideline; also narrows types for callers.

### 25. 4× redundant `ctx.runQuery(getJobInternal)` per paper
- Inside `workpoolActions.ts`: `getJobInternal` called multiple times across `downloadAndIndex` + `waitAndExtract` for the same paper. Pass the job doc as an arg or cache within the action run.

### 26. Observability gaps
- Ad-hoc `console.log` scattered across actions/mutations. No structured event table (project has `convex/lib/audit.ts` — not used by extraction). No dead-letter view for permanently-failed papers.
- Fix: adopt `lib/audit.ts` for lifecycle transitions + a `getFailedPapers(jobId)` query surfaced in UI.

### 27. `chunking.ts` silently drops short pages (<80 chars)
- Equation-heavy / figure-caption-heavy papers lose content. Lower threshold or keep and flag for LLM.

### 28. State machine has illegal transitions
- No central validator for job status transitions (e.g. `cancelled → running`, `completed → running`, `failed → completed`). Several mutations patch `status` without guard.
- Fix: `assertValidJobTransition(current, next)` helper; call on every status patch.

### 29. Schema index gaps (from performance audit's table)
- Add 7 indexes listed in `03-performance.md` (`extractionResults.by_job`, etc.). Several current queries scan because the composite doesn't exist.

### 30. Modernization: `@convex-dev/aggregate` for counters
- `extractionJobStats` counter is OCC-prone (many workpool completions fight for the same job doc). Switch to `@convex-dev/aggregate` per convex-best-practices report; reduces conflicts at high fan-in.

---

## ✅ What's done well (don't change)

- Workflow + Workpool + `defineOnComplete` pattern is the right shape; workflow only orchestrates, workpool owns per-paper retries.
- `validators.ts` is exemplary — pure vocabulary, reused.
- `evidence_units.ts` clean single-responsibility, well-tested.
- `content.ts`, `dedupe.ts` — tiny single-purpose helpers to emulate elsewhere.
- Cascade-delete self-rescheduling pattern (batches + `scheduler.runAfter(0, ...)`) is the correct Convex large-delete idiom.
- Test coverage on cascade/stats/debug-internal gives a safety net for the refactors.

---

## Execution order (recommended)

**Phase 1 — this week**
1. Patch cancellation semantics (#2, #3, #5) — single commit; add regression test.
2. Idempotency flags + move billing to post-persist (#4, #6).
3. SSRF allowlist + unbounded-array caps (#1, #8).
4. Delete `getCurrentUserInternal` + route to `lib/auth` (#7).
5. Register `cleanupOldPdfs` cron (#17).

**Phase 2 — this sprint**
6. Wire `extractionJobStats` into `subscribeToJobProgress` + `finalizeJobIfDone` (#9, #10).
7. Add 7 missing indexes + fix `loadJobPapersAndResults` N+1 (#11).
8. Move inline arrays to `extractionJobSources` child table (#12).
9. Invert `backfillJobStats` loop (#13); parallelize per-question LLM (#14).
10. Gate test/debug actions behind env check (#16).

**Phase 3 — this month**
11. God-file splits per `05-architecture.md` §1.
12. DRY consolidations (#20), dead-code sweep (#21), tighten public surface (#22).
13. Add `assertValidJobTransition` + structured audit events.
14. Swap counter to `@convex-dev/aggregate`.

---

## Individual reports

| # | Report | Focus | File |
|---|--------|-------|------|
| 01 | Security | Auth, SSRF, injection, DoS | `.agents/audit/01-security.md` |
| 02 | Bugs | Races, nulls, state machine, error handling | `.agents/audit/02-bugs.md` |
| 03 | Performance | `.filter`/`.collect`, N+1, indexes, txn limits | `.agents/audit/03-performance.md` |
| 04 | Convex best practices | Guidelines compliance, modern patterns | `.agents/audit/04-convex-best-practices.md` |
| 05 | Architecture / DRY | God files, duplication, dead code, API surface | `.agents/audit/05-architecture.md` |
| 06 | Data flow | Pipeline map, idempotency, retries, billing | `.agents/audit/06-dataflow.md` |
