# Plan 04 — Bounded Question Concurrency

**Depends on:** 01, 02, 03. **Blocks:** nothing.

## Goal

Enable bounded per-paper question concurrency using the plan-derived `questionConcurrencyPerPaper` limit, with pause/resume correctness preserved by the run epoch introduced earlier.

## Scope

**In scope**

- bounded per-paper question batching
- question worker epoch/status rechecks
- read-only internal overlap inside `extractOneQuestion`
- finalizePaper remaining correct under concurrent question completion

**Out of scope**

- changing plan values away from `5`

## Design

### 1. Batch questions within a paper

Inside the per-paper pipeline:

- chunk the paper’s question list by `resolvedQuestionConcurrencyPerPaper`
- dispatch each question batch with bounded `Promise.all`
- gate between batches for pause/cancel

Conceptually:

```ts
for (const qBatch of chunk(questionIds, resolvedQuestionConcurrency)) {
  const status = await waitWhilePausedOrCancelled(...);
  if (status === "cancelled") return;

  await Promise.all(
    qBatch.map((q) =>
      step.runAction(internal.extraction.workpoolActions.extractOneQuestion, {
        paperId,
        jobId,
        questionId: q._id,
        expectedEpoch,
      }),
    ),
  );
}

await finalizePaper(...);
```

### 2. Re-check epoch/status before billing

`extractOneQuestion` must reject stale work:

- at entry
- again immediately before persist/billing

This is required because work may start under a valid epoch and become stale while the LLM call is in flight.

### 3. Keep same-paper writes bounded

This plan assumes plan 03 has already removed the worst same-paper write hot spots.

Do not add new same-paper writes per question completion.

### 4. Add low-risk internal overlap

Inside `extractOneQuestion`, overlap read-only prep work where safe:

- `billingUser`
- `balance`
- `units`
- `getModel()`
- `fetchServerPricing()`

For PDF jobs, overlap:

- dense retrieval
- lexical scoring

Do not overlap persistence or same-paper mutations.

## Files touched

- `convex/extraction/workflow.ts`
- `convex/extraction/workpoolActions.ts`
- maybe a small batching helper if shared with plan 02
- finalization / concurrency tests

## Test plan

### Test-first

- question batching helper tests, if extracted

### Test-after

- one paper can have multiple questions in flight
- pause stops future question batches
- stale epoch questions cannot bill or persist
- finalizePaper remains correct after concurrent question completion
- billing-idempotency tests remain green

## Acceptance criteria

1. Both concurrency knobs are active in the runtime.
2. Question dispatch within a paper is bounded, not unbounded.
3. Pause/resume remains correct under question concurrency.
4. No duplicate billing occurs under retries or stale completions.

## Known pitfalls

- If Convex insights shows workflow/workpool OCC spikes after this plan, lower the infra clamp before changing product entitlements.
- Do not regress the retry path into a different concurrency model than the main path.
