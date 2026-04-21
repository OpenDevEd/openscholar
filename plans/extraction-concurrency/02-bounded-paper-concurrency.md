# Plan 02 — Bounded Paper Concurrency

**Depends on:** 01. **Blocks:** 04. **Independent of:** 03, except that 03 will refine the write path after this lands.

## Goal

Reintroduce bounded paper-level parallelism in the main extraction flow and the retry flow, using the new plan-derived execution limits, while keeping questions within each paper serial.

This is the first real throughput win and the lowest-risk concurrency shape once plan 01’s control-plane work is complete.

## Scope

**In scope**

- main workflow paper batching
- retry workflow paper batching
- infra safety clamp separate from plan entitlement
- preserving current pause/resume semantics between batches

**Out of scope**

- question-level parallelism
- per-question write-path redesign

## Design

### 1. Batch papers in the main workflow

In `convex/extraction/workflow.ts`, replace the current outer serial paper loop with bounded batched dispatch.

Conceptually:

```ts
for (const batch of chunk(papers, resolvedPaperConcurrency)) {
  const status = await waitWhilePausedOrCancelled(...);
  if (status === "cancelled") return;

  await Promise.all(batch.map((paper) => runPaperPipeline(step, paper, expectedEpoch)));
}
```

Within `runPaperPipeline`:

- keep the current per-paper sequencing
- keep the current per-question serial loop
- pass expected epoch into downstream actions

### 2. Separate entitlement from safety clamp

Even though every plan currently resolves to `5`, do not assume the workflow should always run `5` papers concurrently forever.

Use:

- plan-derived value from plan 01
- local infra safety clamp
- effective runtime value = `min(entitlement, clamp)`

This keeps operational control separate from billing/product entitlement.

### 3. Update retry workflow

`runRetryWorkflow` currently uses nested raw `Promise.all`.

Change it so:

- papers are processed in bounded batches
- questions for a paper remain serial

This keeps retry behavior aligned with the main path and avoids leaving a parallelism bypass in the system.

### 4. Pause behavior

Pause remains cooperative:

- no new paper batch should start while paused
- already-started paper tasks rely on status + epoch guards downstream

Do not add pool-level pause.

## Files touched

- `convex/extraction/workflow.ts`
- maybe a small batching helper module if that keeps the workflow readable
- retry workflow tests
- pause/resume integration tests

## Test plan

### Test-first

- batching helper:
  - `chunk([1,2,3,4,5], 2) -> [[1,2],[3,4],[5]]`
  - `chunk([], 5) -> []`
  - clamp of `0` or negative never produces invalid dispatch size

### Test-after

- main workflow can have multiple papers in flight
- pause blocks the next paper batch from starting
- resume continues from a new epoch
- retry workflow respects the same paper concurrency bound

## Acceptance criteria

1. Main extraction can process multiple papers concurrently.
2. Questions within a paper remain serial.
3. Retry no longer bypasses the bounded concurrency model.
4. Pause/resume remains correct under paper batching.

## Known pitfalls

- Paper-level concurrency still increases scheduler/workflow pressure; check Convex insights after rollout.
- Do not accidentally gate only the main workflow and leave retry as the old nested `Promise.all` path.
- If pause/resume semantics are not proven by tests after plan 01, do not start this plan.
