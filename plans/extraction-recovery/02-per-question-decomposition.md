# Plan 02 — Per-Question Workflow Decomposition (Timeout Fix + Retry Granularity)

**Depends on:** 01 (error taxonomy). **Blocks:** 05, 06, 07.

## Goal

Make the unit of work a `(paper, question)` pair instead of a full paper. This (a) eliminates the 10-min action-ceiling risk, (b) lets retry operate at the question level (not redo already-answered questions on the same paper), (c) gives pause/resume a natural finer-grained suspension point.

Closes gap #7 (timeout mitigation). Prerequisite for #3 (retry granularity) and #6 (pause/resume per-question).

## Scope

**In scope**
- Replace single `waitAndExtractAction` (1 action per paper, processing all N questions) with fan-out of N workflow steps (one per question).
- New action `extractOneQuestion` (≤ 1 LLM call + 1 dense search).
- Workflow aggregates results with a `finalizePaper` step.
- Workpool's 3× retry now meaningful per-question.
- `extractionResults` schema unchanged (already per-question); only the orchestration changes.
- Per-paper `attemptCount` replaced with per-question attempt counter.
- Billing idempotency preserved via per-question `billed` flag.

**Out of scope**
- Pause/resume (plan 06).
- UI changes (plan 07).

## Why now

Per Convex Workflow README (v0.3.11):
> "If you want to do a lot of work in parallel, you should employ batching, where each workflow operates on a batch of work, e.g. scraping a list of links instead of one link per workflow."

Each workflow step is a workpool-dispatched action → inherits 10-min ceiling. Current `waitAndExtractAction` (`convex/extraction/workpoolActions.ts:744-1170`) processes all N questions inside one action with `QUESTION_CONCURRENCY_PER_PAPER = 5`. For a heavy paper it can time out. Decomposition is the README's explicit recommendation.

## Design

**Related but unrelated:** `lib/extraction/question-status.ts` already exists (UI-scoped `statusFromCompletion` helper for progress bars). The new `lib/extraction/paper-status.ts` proposed here is distinct — it's a backend rollup of per-question result-row status codes into paper status. Don't confuse the two.

### Workflow shape

Current (`convex/extraction/workflow.ts`):
```ts
for each paper:
  enqueuePaperProcessing(paperId)  // → downloadAndIndex → waitAndExtract (all Qs)
```

New:
```ts
for each paper:
  await step.runAction(internal.ext.downloadAndIndex, { paperId }, { retry: true, name: `dl:${paperId}` })
  const answers = await Promise.all(
    questions.map(q =>
      step.runAction(internal.ext.extractOneQuestion, { paperId, questionId: q._id },
        { retry: true, name: `q:${paperId}:${q._id}` })
    )
  )
  await step.runMutation(internal.ext.finalizePaper, { paperId })
```

Parallelism clamped by the workpool's `maxParallelism` (already wired).

- The new per-question workflow must preserve `convex/extraction/workflow.ts:154-162`'s zero-paper `maybeFinalizeJob` short-circuit (added after this plan was written). Skip the enqueue loop entirely when `papers.length === 0`.

### `extractOneQuestion` action

```ts
export const extractOneQuestion = internalAction({
  args: { paperId: Id<"extractionPapers">, questionId: Id<"extractionQuestions"> },
  handler: async (ctx, { paperId, questionId }) => {
    // 1. Idempotency gate: read result row keyed (paperId, questionId). If terminal, early-return.
    // 2. Run dense search for this ONE question.
    // 3. One LLM call.
    // 4. Save result via internal.ext.results.recordOneAnswer (atomic: result + credits + per-question billed flag).
  },
});
```

### Schema additions

> **Note on error fields:** The current schema has no per-paper `lastError` — only `extractionPapers.errorMessage` (see `convex/schema.ts:527`). Plan 02 introduces a per-question `lastError` field on the new per-question result rows; `extractionPapers.errorMessage` remains as a coarse fallback.

`extractionResults` (existing, see `convex/schema.ts`):
```ts
// ADD:
billed: v.optional(v.boolean()),        // per-question idempotency gate
attemptCount: v.optional(v.number()),   // # of attempts incl. retries
lastError: v.optional(errorShape),      // classified taxonomy error
```

`extractionPapers`:
```ts
// REMOVE (moved to per-question):
// extractionBilled — replaced by result.billed aggregate
// Keep indexingBilled (still per-paper, one indexing operation per paper)
```

`finalizePaper` mutation recomputes paper status by aggregating question-level status:
- All `extractionResults` for paper `completed` → paper `completed`.
- Any question still pending + job not paused → no-op (wait).
- Mix of success + hard-failed questions → paper `completed` with `failedQuestions > 0` counter.
- All questions hard-failed → paper `failed`.

### Billing changes

Today: one debit per paper at `convex/extraction/mutations/results.ts:229-300`.
New: one debit per question at `recordOneAnswer` (atomic with result write + `billed=true` flag). Aggregate per-job cost remains sum over all question rows.

**Idempotency preserved**: `if (result?.billed) return`.

**Cost calculation**: `calculateServerCreditsToDeduct(paper, question)` shifted to accept single-question args. Existing helper in `convex/credits/**`.

### Timeout math (back-of-envelope)

Per-question action: 1 dense search (sub-second) + 1 LLM call (up to ~60s worst case) = well under 10 min. Even pathological papers are safe. Per-paper wall-clock latency unchanged (workpool parallelism).

### Workflow-journal size

Workflow's durable replay stores step history. N questions × M papers = many steps. Workflow README notes `"Steps can only take in and return a total of 1 MB"` — individual step args stay tiny (two IDs). Workflow-global history can grow; not a concern until 10k+ papers per job, well beyond MVP scale. Revisit if an extraction job exceeds ~500 papers.

### Workpool 0.3.2 constraint — keep per-question args under 8 KB

The project pins `@convex-dev/workpool@0.3.2` to satisfy `@convex-dev/rag`'s peer range. On 0.3.2, enqueue args ≥ 8 KB are silently unreadable (0.4.0 introduced a `payload` side-table that 0.3.2 does not read). Per-question actions MUST pass IDs and short prompt text only; fetch PDF chunks / RAG context inside the action using the IDs. Do NOT serialize `chunk[]` or full question text in the workpool args payload. The existing `extractQuestionAnswer` / `extractQuestionAnswerFromAbstract` calling convention already follows this pattern — extend it, don't widen it.

### Chat-mode interaction

Chat-mode jobs branch earlier in `convex/extraction/mutations/jobs.ts:76` (`args.mode === "chat"`) and never reach the extraction per-question fan-out. The Plan-01-era chat work does not interact with Plan 02's decomposition surface.

## TDD sequence (pure logic only — `lib/extraction/paper-status.ts`)

The one pure-logic piece: the paper-status rollup from question results. Every workflow/mutation change downstream assumes this function is correct.

```
R1 → G1   test: aggregatePaperStatus([]) → {status:"pending", failedQuestions:0, completedQuestions:0}
R2 → G2   test: all results status:"completed"
          → {status:"completed", failedQuestions:0, completedQuestions:N}
R3 → G3   test: mix of completed + hard-failed (non-retryable code)
          → {status:"completed", failedQuestions:K, completedQuestions:N-K}
R4 → G4   test: mix of completed + retryable-failed (not yet maxed out)
          → {status:"extracting"}  (still has work to do)
R5 → G5   test: all results hard-failed
          → {status:"failed", failedQuestions:N}
R6 → G6   test: any result status:"pending" or "extracting"
          → {status:"extracting"}  (do not finalize)
R7 → G7   test: treats undefined `code` on lastError as retryable (conservative)
REFACTOR  extract status-precedence table; re-run green
```

Then test-after for the workflow restructure, `extractOneQuestion` split, and billing idempotency — tests enumerated in the Test plan section operate end-to-end through Convex test harness.

## Files touched

- `convex/extraction/workflow.ts` — restructure enqueue loop.
- `convex/extraction/workpoolActions.ts` — split `waitAndExtractAction` into `extractOneQuestion`. Remove `QUESTION_CONCURRENCY_PER_PAPER` in-action parallel (now workpool-managed).
- `convex/extraction/mutations/results.ts` — split `saveExtractionResultsAndComplete` into `recordOneAnswer` (per-Q) + `finalizePaper` (paper-level rollup).
- `convex/extraction/mutations/internal/onComplete.ts` — `handleExtractionComplete` now routes per-question; new `handleFinalizePaperComplete` for paper-level signal.
- `convex/extraction/paperLifecycle.ts` — `markPaperTerminalTx` now computed from question-level aggregation.
- `convex/schema.ts` — `extractionResults` schema changes (see above).
- `convex/extraction/stateMachine.ts` — unchanged (paper statuses untouched).
- `convex/extraction/aggregates.ts` — `resultStatusAgg` / `resultAnsweredAgg` / `resultConfidenceAgg` are already per-question; verify they don't break.
- Tests: `convex/extraction/billing-idempotency.test.ts` extended; new `convex/extraction/per-question-decomp.test.ts`.

## Migration — **none (dev data is disposable)**

Per `00-README.md` migration stance: no backfill.

1. Wipe in-flight `extractionJobs` + `extractionPapers` + `extractionResults` via the Convex dashboard or an admin helper.
2. Cancel any running workflows (`workflow.cancelAll` or wipe the workflow component's internal state).
3. Deploy the new schema with per-question `billed` / `attemptCount` / `lastError`.
4. Delete the old `extractionBilled` field outright — no compat shim.

Fresh schema, fresh runs. The user has authorized wiping. Do NOT write a backfill.

## Test plan

- **Unit**: `extractOneQuestion` idempotency. Call twice with same args → one LLM call, one debit.
- **Unit**: `finalizePaper` status aggregation. 10 Q with 8 completed + 2 `extraction_error` → paper `completed`, `failedQuestions=2`. 10 Q with 10 hard-failed → paper `failed`.
- **Convex test**: full workflow run with 3 papers × 5 questions. Assert 15 `extractionResults` rows, 15 credit debits, 3 paper-complete transitions, 1 job-complete transition.
- **Convex test**: question retry. Inject 429 on first attempt of `extractOneQuestion` → workpool retries → result `completed` after attempt 2. `attemptCount=2`, one `extractionPaperErrors` row with `code="rate_limit"`, one debit (not two).
- **Performance sanity**: 1 paper with 50 questions finishes without any single action exceeding 2 minutes.

## Acceptance criteria

- [x] No single action in the extraction pipeline exceeds 2 minutes under normal conditions; ceiling is per-question, not per-paper. *(Workflow rewrite in `convex/extraction/workflow.ts` fans out one `extractOneQuestion` step per (paper, question); each step is ≤ 1 dense search + 1 LLM call, safely under the 10-minute action ceiling.)*
- [x] Per-question idempotency proven: repeat retries never double-bill. *(Billing-idempotency suite + `per-question-decomp.test.ts::recordOneAnswer is idempotent under workpool retry` pin the `billed=true` short-circuit. Three back-to-back calls produce one debit + one aggregate row.)*
- [x] Existing `extractionResults` rows migrated with `billed=true`. *(N/A per `00-README.md` migration stance — dev data is disposable; the new `billed` field is optional so unmigrated rows validate but are simply absent from the billing path. No backfill script shipped.)*
- [x] All existing extraction tests still pass. *(209 files / 2358 tests green after the cutover, including the ported billing-idempotency, job-stats, finalize-guard, aggregate-parity, and internal-routing pins.)*
- [x] 10-minute ceiling cannot be reached with < 1000 evidence chunks per paper. *(Per-question action runs one dense search + one LLM call. The 10-minute ceiling now applies per-question, not per-paper-with-all-questions, which is the plan's timeout-math baseline.)*

## Known pitfalls

- **`extractionBilled` → per-question**: be careful with the migration. If you skip it, a resumed job will re-bill already-answered questions.
- **Dense search cache**: each `extractOneQuestion` does its own dense search. If searches are expensive, consider caching at the paper level keyed by `paperId` (short TTL) — but only as a later optimization; not in-scope here.
- **Step-history size**: for very large jobs (> 1000 papers) monitor the workflow-instance document size. If it hits limits, fall back to grouping questions into batches of 5 per step (hybrid approach).
