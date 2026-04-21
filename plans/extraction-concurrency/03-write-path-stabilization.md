# Plan 03 — Stabilize The Per-Question Write Path

**Depends on:** 01. **Blocks:** 04.

## Goal

Reduce same-paper write amplification so bounded question-level concurrency is safe to enable.

This plan does not add more concurrency on its own. It removes the main reasons question fan-out would immediately create OCC churn.

## Scope

**In scope**

- reduce same-paper writes in `recordOneAnswer`
- remove full paper projection recompute from the per-question hot path
- tighten overly broad extraction control reads where practical

**Out of scope**

- changing billing semantics
- enabling question-level fan-out

## Design

### 1. Shrink `recordOneAnswer`

Today `recordOneAnswer` performs, in one mutation:

- result upsert
- paper `creditsUsed` patch
- credit deduction
- credit aggregate update
- result aggregate update
- full projection recompute

That is too much same-paper work for future question parallelism.

Keep:

- result persistence
- billing idempotency
- credit deduction
- aggregate writes

Reduce or move:

- per-paper total patching where possible
- full projection recompute

### 2. Remove full projection recompute from question completion

`recomputePaperListProjection` currently rereads all results/reviews for the paper on every answer completion.

Replace that with one of:

- narrower incremental projection maintenance
- finalize-time projection recompute
- hybrid cheap eager fields + finalize-time expensive fields

The exact mechanism should be chosen during execution based on the smallest correct diff, but the constraint is fixed:

- no full projection recompute per answered question

### 3. Review scan-heavy control paths

Before enabling question concurrency, tighten the current 50k-scale control reads:

- `resumeExtraction`
- `retryFailedQuestions`
- any related internal query that currently does `.collect()` then filters in JS over the whole job

At minimum, these flows must stop depending on a potential 50,000-row scan.

### 4. Preserve current correctness boundaries

Do not move side effects ahead of:

- `indexingBilled`
- `existingResult?.billed`

Those remain the non-negotiable correctness boundaries for retries and stale work.

## Files touched

- `convex/extraction/mutations/results.ts`
- `convex/extraction/listProjection.ts`
- `convex/extraction/paperLifecycle.ts`
- `convex/extraction/mutations/retry.ts`
- `convex/extraction/mutations/resume.ts`
- `convex/extraction/queries/internal.ts`
- supporting tests

## Test plan

### Test-first

- pure projection/update helper tests if a helper is extracted

### Test-after

- same-paper concurrent question completions do not repeatedly trigger full projection rebuilds
- retry/resume no longer rely on oversized by-job scans
- existing billing-idempotency tests remain green
- paper list semantics remain correct

## Acceptance criteria

1. `recordOneAnswer` no longer recomputes the full paper projection on every completion.
2. Same-paper write amplification is materially reduced.
3. Resume/retry control flows no longer rely on 50k-scale scans.
4. Billing idempotency remains unchanged.

## Known pitfalls

- Do not “fix” projection churn by deferring correctness entirely to the client.
- If a finalize-time recompute path is chosen, make sure partially-complete paper UI remains truthful.
