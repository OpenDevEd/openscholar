# Plan 01 — Park on Soft Skip

## Goal

Stop orphaning the extraction workflow when `extractOneQuestion` or `downloadAndIndexPdfAction` returns a skip whose reason is `paused`, `credits_exhausted`, or `stale_epoch`. Route those reasons through the existing `waitWhilePausedOrCancelled` gate and retry the parked items, while keeping `cancelled` / `job_terminal` as terminal halts and `already_billed` as a no-op success.

## Scope

- File: `convex/extraction/workflow.ts`.
- Tests: `convex/extraction/workflow.test.ts` (extend the existing batching-helper test file).
- No other files. No schema changes. No mutation/action changes.

Out of scope:

- Adding a watchdog cron for stranded jobs.
- Re-spawning the workflow from `resumeExtraction`.
- Reworking `pause.ts` / `resume.ts` mutations.
- Changing worker actions or the `getWorkerSkipReason` helper.

## Design

### New sentinel

```ts
type StepResult = "completed" | "halted" | "park";
type PaperPipelineResult = StepResult;
```

`"park"` means: the item could not finish because the job is in a non-terminal pause state (`paused`, `creditsExhausted`) or its epoch has rolled forward (`stale_epoch`). The caller is expected to re-enter the cooperative gate and rerun the parked items.

### `runBoundedBatches` extension

Extend the existing helper to retry parked items in place. The current per-batch loop becomes a per-batch `while` loop over `pendingItems`:

```ts
for (const batch of chunk(items, batchSize)) {
  let pendingItems: ReadonlyArray<TItem> = batch;
  while (pendingItems.length > 0) {
    const control = await waitForNextBatch();
    if (control === null) {
      return "halted";
    }
    const results = await Promise.all(
      pendingItems.map((item) => runItem(item, control)),
    );
    if (results.some((r) => r === "halted")) {
      return "halted";
    }
    pendingItems = pendingItems.filter((_, i) => results[i] === "park");
  }
}
return "completed";
```

Behavioral guarantees:

- Items that returned `"completed"` are never re-run.
- Items that returned `"halted"` short-circuit the entire helper.
- Items that returned `"park"` are re-run after the next `waitForNextBatch()` call returns a non-null control.
- A single `awaitEvent` lives inside `waitForNextBatch` (via `waitWhilePausedOrCancelled`). Park-retry naturally re-enters the same gate without duplicating it elsewhere.

### Question step (`runQuestionStep`) skip routing

```ts
if (questionResult.status === "skipped") {
  if (questionResult.reason === "already_billed") {
    return "completed";
  }
  if (
    questionResult.reason === "cancelled" ||
    questionResult.reason === "job_terminal"
  ) {
    console.log(
      `[${logPrefix}] Halting ${paperId}:${questionKey}; worker skipped with ${questionResult.reason}`,
    );
    return "halted";
  }
  // paused | credits_exhausted | stale_epoch
  console.log(
    `[${logPrefix}] Parking ${paperId}:${questionKey}; worker skipped with ${questionResult.reason}`,
  );
  return "park";
}
```

### Indexing step inside `runPaperPipeline`

Same routing applied to the `downloadAndIndexPdfAction` skip arm:

```ts
if (indexed.status === "skipped") {
  if (
    indexed.reason === "cancelled" ||
    indexed.reason === "job_terminal"
  ) {
    console.log(`[Workflow] Halting paper ${paper._id}; worker skipped with ${indexed.reason}`);
    return "halted";
  }
  console.log(`[Workflow] Parking paper ${paper._id}; worker skipped with ${indexed.reason}`);
  return "park";
}
```

`downloadAndIndexPdfAction` does not emit `already_billed` (its idempotency gate returns `{status: "completed"}`), so the routing collapses to halt vs park.

### Park propagation through `runPaperPipeline` and `runQuestionBatches`

Both must propagate `"park"` upward without finalizing the paper:

```ts
const questionBatchResult = await runQuestionBatches(...);
if (questionBatchResult === "halted" || questionBatchResult === "park") {
  return questionBatchResult;
}
// only on "completed":
await step.runMutation(internal.extraction.mutations.results.finalizePaper, ...);
return "completed";
```

The outer paper-level `runBoundedBatches` gets retry-of-parked-papers behavior automatically from the helper extension above. After resume, parked papers re-enter the pipeline; idempotency gates in the worker actions (`existingPaper?.isIndexed || indexingBilled`, `existingResult?.billed`) keep already-completed work from being re-charged.

### Why this design respects the 1:1 event contract

`@convex-dev/workflow`'s event model (`node_modules/@convex-dev/workflow/src/component/event.ts`) treats each `awaitEvent` as creating its own event doc and consumes exactly one per `sendEvent`. The fix keeps `waitWhilePausedOrCancelled` as the only `awaitEvent` site. Both inner question batching and outer paper batching feed into the same single-park-at-a-time pattern by propagating `"park"` upward instead of parking inside `Promise.all` branches.

## TDD Sequence

Phase A — pure logic (`runBoundedBatches`):

- **R1.** Test: a `runItem` returning `"park"` causes `runBoundedBatches` to call `waitForNextBatch` again, re-run only the parked items with the fresh control, and never re-run completed items. Make pass by adding the `pendingItems` while-loop and the `"park"` sentinel.
- **R2.** Test: a `runItem` returning `"halted"` short-circuits the batch even when sibling items return `"park"`. Pass should already hold from R1; tighten if needed.
- **R3.** Test: when `waitForNextBatch` returns `null` during a park-retry attempt, the helper returns `"halted"` and does not re-invoke `runItem`. Pass should already hold; tighten if needed.

Phase B — workflow wiring (test-after, one logical commit per slice):

- **B1.** Skip-reason routing in `runQuestionStep`: factor a small pure helper `classifyWorkerSkip(reason): "completed" | "halted" | "park"` (or inline routing — pick the shape that survives `tsc`), wire `runQuestionStep` to use it, and add a focused vitest case using a stubbed `step` that returns each reason. Commit per logical unit (helper, question step, indexing step).
- **B2.** Apply the same routing to the indexing skip arm in `runPaperPipeline`. Test by injecting a stubbed `step.runAction` that returns each `downloadAndIndexPdfAction` skip reason; assert `runPaperPipeline` returns the right sentinel and that `finalizePaper` is **not** called on park or halt.
- **B3.** Propagate `"park"` through `runQuestionBatches` and `runPaperPipeline` types; ensure `runRetryPaperPipeline` propagates as well (it shares `runQuestionBatches`). Behavior-test that `runRetryWorkflow` halts vs parks consistently with `runExtractionWorkflow` by using the existing `runBoundedBatches` mock pattern.

Each green test is its own commit. The plan-edit deviation protocol applies if the helper signature ends up differing from this section.

## Files Touched

- `convex/extraction/workflow.ts` — type extension, `runBoundedBatches` retry loop, skip-reason routing in `runQuestionStep` and `runPaperPipeline`, park propagation through `runQuestionBatches` / `runPaperPipeline` / `runRetryPaperPipeline`.
- `convex/extraction/workflow.test.ts` — new R1–R3 cases plus B1/B2 routing cases.

No other source files or schema files are touched.

## Migration Stance

None. Pure logic change.

## Test Plan

- `vitest run convex/extraction/workflow.test.ts` — must include R1, R2, R3, plus skip-reason routing for question step (B1) and indexing step (B2) and park propagation for paper pipeline (B3).
- `vitest run` (full suite) — must remain green; no other tests should regress.
- `tsc --noEmit` (or the project's typecheck script) — must be clean.
- `pm2 logs convex --lines 50` after the change lands — must show the updated `convex/extraction/workflow.ts` module loading without errors.

End-to-end pause/resume coverage with a real Convex deployment is intentionally **out of scope** for this plan. The reviewer-flagged bug is resolvable with unit-level coverage of the sentinel routing and batch-retry behavior. A dedicated integration smoke remains the responsibility of the long-deferred "task #12" referenced in `mutations/resume.test.ts:6-9`.

## Acceptance Criteria

1. `runBoundedBatches` returns `"park"` only when explicitly returned by `runItem` and there is no fresh control to retry against; otherwise it loops on parked items until they all complete or one halts.
2. `runQuestionStep` returns `"completed"` for `already_billed`, `"halted"` for `cancelled` / `job_terminal`, and `"park"` for `paused` / `credits_exhausted` / `stale_epoch`.
3. The indexing arm in `runPaperPipeline` follows the same halt-vs-park routing.
4. `runPaperPipeline` does not call `finalizePaper` when the question batch returns `"park"` or when indexing returns `"park"`/`"halted"`.
5. `runExtractionWorkflow` and `runRetryWorkflow` continue to early-`return` on `"halted"` from the outer paper batch (cancellation behavior unchanged).
6. Tests added in this plan pass; full vitest suite remains green; `tsc` clean; Convex dev server still loads the module.
7. No new `awaitEvent` call sites are introduced. The only `awaitEvent` remains inside `waitWhilePausedOrCancelled`.

## Known Pitfalls

- **Don't add `awaitEvent` inside `Promise.all` branches.** The library's 1:1 producer-consumer event contract turns parallel parks into orphaned waiters. The plan's single-park-point design is non-negotiable.
- **Don't move the `expectedEpoch` capture inside the parked-retry path** beyond what the existing helper already does. The fresh `control.runEpoch` from the next `waitForNextBatch` call must be the only source of `expectedEpoch` for parked retries.
- **Don't make parked retries depend on per-item state outside the helper.** If a future caller wants to "skip already-completed items" without relying on the worker idempotency gate, that's a separate plan; here we lean on the existing `existingResult?.billed` and `existingPaper?.isIndexed || indexingBilled` gates.
- **`finalizePaper` is the trap.** Triple-check that `runPaperPipeline` does not call it on `"park"` or `"halted"`. The function flips the paper terminal; calling it during park would break the resume retry.
- **Logs are non-load-bearing.** Avoid asserting on log strings in tests; assert on returned sentinels and call counts only.
