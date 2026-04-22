# Plan 03 — Row-Local Completion And Deferred Side Effects

**Depends on:** 02. **Blocks:** 04.

## Goal

Make per-paper completion row-local, move secondary side effects out of `handleScreeningComplete`, and finalize jobs from scheduled follow-ups instead of patching shared counters inline.

## Scope

**In scope**

- Rewrite `handleScreeningComplete` to patch only the target result row plus aggregate state.
- Schedule qualified-paper persistence in an internal follow-up mutation.
- Schedule job terminalization in an internal follow-up mutation.
- Normalize canceled / exhausted jobs to terminal result rows without side effects.
- Remove inline library / collection persistence and inline finalization from the hot path.

**Out of scope**

- final deletion of obsolete schema fields and dead APIs
- extra UX redesigns

## Design

### 1. `handleScreeningComplete` becomes row-local

For `result.kind === "success"`:

- load the current job row once
- if the job is `cancelled` or `creditsExhausted`, mark the result row `skipped` and stop
- otherwise decode responses, score, patch the single `screeningResults` row, and record aggregate state

For `result.kind !== "success"`:

- patch the single `screeningResults` row to `failed`
- record terminal aggregate state

It must no longer:

- patch `screeningJobs` counters
- call `saveQualifiedPaperToLibrary` inline
- call `addToCollectionInternal` inline
- call `finalizeScreeningJobIfDone`

### 2. Defer qualified-paper side effects per result

Add a scheduled internal mutation, e.g. `persistQualifiedScreeningResult`, that:

1. loads the result row and job row
2. exits unless the row is completed, qualified, and not yet linked to a library item
3. calls existing internal helpers:
   - `saveQualifiedPaperToLibrary`
   - `addToCollectionInternal`
4. patches `screeningResults.libraryItemId` and `savedToLibrary`

This follow-up is safe to retry because:

- `saveQualifiedPaperToLibrary` is upsert-like by `(userId, openalexId)`
- `addToCollectionInternal` is idempotent by `(collectionId, libraryItemId)`

### 3. Defer job terminalization per job

Add a scheduled internal mutation, e.g. `finalizeScreeningJobFromAggregates`, that:

1. reads the job row
2. exits for terminal job statuses
3. reads aggregate-backed counts
4. if handled count is below `totalPapers`, exits with no write
5. if handled count reaches `totalPapers`, patches the job row once to terminal `completed` with `completedAt`
6. emits the analytics event after completion as it does today

This moves job-level writes from “once per paper” to “once per job completion.”

### 4. Schedule follow-ups from `onComplete`

After patching the result row:

- if the row is qualified, `await ctx.scheduler.runAfter(0, internal.screening.mutations.persistQualifiedScreeningResult, { resultId })`
- always `await ctx.scheduler.runAfter(0, internal.screening.mutations.finalizeScreeningJobFromAggregates, { jobId })`

This matches Convex guidance to move non-critical or secondary work to scheduled functions.

### 5. Preserve rare terminal job writes in the worker action

The worker action’s credits-exhausted job patch is a rare stop-the-world path and can remain if necessary. The refactor target here is the hot completion mutation, not every exceptional write in the whole screening stack.

## TDD sequence

### Phase A — pure logic first

1. Add a pure helper for completion transition decisions.
2. Write tests for:
   - success + active job => completed row with qualification metadata
   - success + cancelled job => skipped row, no side effects
   - failure => failed row
   - follow-up scheduling decisions for qualified vs non-qualified rows

### Phase B — mutation and scheduler wiring

1. Rewrite `handleScreeningComplete`.
2. Add scheduled internal follow-up mutations.
3. Remove inline side effects and inline finalization.
4. Add or extend tests around completion behavior and idempotency.

## Files touched

- `convex/screening/mutations.ts`
- `convex/screening/workpoolActions.ts` if small status-handling adjustments are needed
- screening tests for completion / cancellation / finalization
- pure helper + tests if warranted

## Migration stance

Destructive to the old execution model.

- remove inline side-effect behavior
- do not keep `finalizeScreeningJobIfDone` as a parallel path
- do not preserve shared job counter writes “for safety”

## Test plan

### Test-first

- completion transition helper tests

### Test-after

- qualified completed rows schedule persistence follow-up
- cancelled jobs do not save to library or collections
- failed rows remain row-local
- job completion is patched by the scheduled finalizer, not inline
- analytics still fire on terminal completion

## Acceptance criteria

1. `handleScreeningComplete` no longer patches `screeningJobs` counters.
2. Library and collection persistence no longer happen inline in `onComplete`.
3. Job completion no longer depends on `finalizeScreeningJobIfDone`.
4. Cancelled or credits-exhausted jobs produce terminal result rows without side effects.
5. Completion and cancellation regression tests are green.

## Known pitfalls

- Do not leave result rows stranded in `processing` after cancel or credits exhaustion.
- Always await `ctx.scheduler.runAfter(...)` calls.
- Keep follow-up mutations idempotent by re-reading row state before writing.
- Do not accidentally double-record aggregate state on retries; use row-state guards carefully.
