# Extraction Fanout Chunking — README

## Motivation

`internal.extraction.mutations.internal.fanout.launchPaperWorkflowsForJob`
processes every non-terminal paper of an extraction job in a single
internalMutation invocation. For a 454-paper job, the mutation performs

  - 454 × `ctx.db.get(paper)` to build plans
  - 454 × `ctx.db.get(paper)` inside the reserve loop
  - up-to-454 × `reserveCreditsTransaction(...)` (each itself ~5 ops)
  - up-to-454 × `ctx.db.patch(paper, { reservationId })`
  - 454 × `workflow.start(..., { startAsync: true })`

in one transaction. That blows past the Convex per-mutation wall-clock
ceiling (~1 minute) on jobs of even a few hundred papers. The
mutation times out, Convex retries it, the retry sees the same shape
and times out again — the job's papers stay in `pending` forever and
the convex error log fills with `worker:runMutationWrapper` retry
chatter.

The user observed this with extraction job
`kd72vgc421hqnk8n54cecsyq3586prz5` — 454 papers, all `pending`, zero
reservations, zero `questionsBilled`, job stuck in `extracting` with
the setup workflow alive but parked on the timed-out step.

## Locked design decisions (2026-05-14)

1. **Chunked, scheduler-chained fanout.** `launchPaperWorkflowsForJob`
   becomes a self-paginating mutation. Each invocation processes a
   `CHUNK_SIZE = 25` slice of the supplied `paperIds` and, when more
   remain, calls `ctx.scheduler.runAfter(0, … same mutation, offset += CHUNK_SIZE)`.
   The single-mutation budget is therefore bounded regardless of job
   size. Mirrors the existing `cleanupOldPdfs` pagination pattern in
   `convex/extraction/mutations/internal/admin.ts`.

2. **Launch idempotency via `paper.paperWorkflowId` + `paper.paperWorkflowEpoch`.**
   `workflow.start` is gated by
   `paper.paperWorkflowId !== undefined && paper.paperWorkflowEpoch === expectedEpoch`.
   When a chunk-level Convex retry re-runs the mutation, papers whose
   workflow was already started (and committed) in a prior pass are
   skipped. Resume across epochs invalidates the gate (the epoch field
   no longer matches), so a fresh workflow is started under the new
   epoch — the stale workflow self-terminates via the existing
   `expectedEpoch` check in `getWorkerSkipReason`.

3. **Reservation idempotency preserved.** The existing
   `paper.reservationId !== undefined` gate stays. Reservations are
   epoch-agnostic — a reservation placed in epoch 0 is still valid in
   epoch 1, so the resume path does NOT re-reserve.

4. **Pre-flight balance check on `offset === 0` only.** The
   total-budget vs balance comparison runs once, on the first chunk.
   Subsequent chunks skip the pre-flight — they would otherwise read
   a balance that has already been debited by the prior chunks'
   reservations and flip the job to `creditsExhausted` mid-stream.

5. **No retry-path change in this plan.**
   `launchRetryPaperWorkflowsForJob` is left intact. Retry batches are
   typically <10 papers and have no reservation step, so the same
   timeout pressure does not apply. If retry batches ever grow, a
   sibling plan can apply the same chunking pattern.

6. **No `paperWorkflowEpoch` clearing on resume.** Resume bumps
   `runEpoch`; the fanout's gate compares against the bumped value and
   correctly treats prior-epoch launches as stale. Resume only needs
   to schedule the chunked fanout — the existing per-paper-filter
   logic in `resume.ts` does not change.

## Plan files

- `01-chunked-fanout.md` — single execution slice. No internal
  dependencies between sub-plans; the work is one coherent refactor.

## Dependency graph

```
01-chunked-fanout (terminal)
```

## Reuse / DRY

- `chunk(items, size)` from `convex/extraction/batching.ts` — already
  used by the workflow's question batcher. Reuse directly; do not
  re-implement slicing.
- `reserveCreditsTransaction` from `convex/credits/reservation.ts` —
  unchanged. Already idempotent on `paper.reservationId`.
- `readBalance` from `convex/credits/balanceCounter.ts` — unchanged.
  Pre-flight reads the sharded counter total.
- The `cleanupOldPdfs` pagination pattern in
  `convex/extraction/mutations/internal/admin.ts:254` — copy its
  `scheduler.runAfter(0, internal.<self>, { … bumped })` cadence.
- The `@convex-dev/workflow/test` `register(t)` helper — registers the
  workflow component (and its nested workpool) into convex-test so
  `workflow.start` does not throw in unit tests. New test-support
  file `convex/extraction/workflow.test-support.ts`.

## Testing doctrine

- TDD. Red → green → refactor → commit per behavior.
- Tests assert on DB-side observable behavior (paper fields, scheduler
  state, `creditTransactions` rows), not on internal call counts.
- Workflow component is registered in tests via the new helper so
  `workflow.start` succeeds and writes the `workflows` row; the test
  asserts on `paper.paperWorkflowId !== undefined`.
- `vi.useFakeTimers()` + `t.finishAllScheduledFunctions(vi.runAllTimersAsync)`
  runs the scheduled next-chunk recursion synchronously so the test
  can observe full-job completion in O(chunks) iterations.

## Migration stance

Dev data is disposable. The two new fields (`paperWorkflowId`,
`paperWorkflowEpoch`) are `v.optional` — existing rows that never
visit the chunked launcher remain valid. **No backfill.** The schema
change is additive and safe across active dev rows. No
`@convex-dev/migrations` script. No widen-then-narrow.

## Delegation policy

The plan is single-slice and tightly scoped. Subagents are not
required for the implementation but should be used for:

- Mapping any caller I may have missed (Explore agent, "very thorough").
- Reading the `@convex-dev/workflow` component internals if a test
  registration question surfaces.

## Grounding sources

- `convex/extraction/mutations/internal/fanout.ts` — current (untracked) source
- `convex/extraction/workflow.ts:566-587` — setup-workflow caller
- `convex/extraction/mutations/resume.ts:241-253` — resume caller
- `convex/extraction/validators.ts:362-405` — `extractionPaperFields`
- `convex/extraction/batching.ts:18-27` — `chunk()` helper
- `convex/extraction/mutations/internal/admin.ts:254-294` —
  `cleanupOldPdfs` pagination prior art
- `node_modules/@convex-dev/workflow/src/test.ts` — workflow component
  test registration entry point
- `node_modules/@convex-dev/workflow/README.md` — batching guidance
  ("avoid >100 active workflows" — argues for chunked launch even
  past the timeout fix)
- `convex/_generated/ai/guidelines.md` — Convex API rules
- pm2 deployability gate per project doctrine
